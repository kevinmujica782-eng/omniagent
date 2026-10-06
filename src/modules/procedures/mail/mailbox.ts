import "server-only";
import type { UserDocument } from "@/generated/prisma/client";
import { decryptSecret } from "@/lib/crypto";
import { prisma } from "@/lib/db";
import { AppError, Errors } from "@/lib/errors";
import { isUuid } from "@/lib/validation";
import { deleteDocument, storeDocument } from "../documents/documents.service";
import { MAX_DOCUMENT_BYTES } from "../documents/storage";
import { getMailProvider } from "./providers";
import type { MailFlavor, MailProvider, MailProviderName } from "./providers/types";

// Acceso de bajo nivel a las bandejas conectadas: token, proveedor y descarga de adjuntos.
// Lo usan el plan de trámites, la sincronización y el envío (sin dependencias circulares).

/** MAIL_DEMO: bandeja de prueba (sandbox). MAIL_IMAP: correo real por IMAP/SMTP. */
export const MAIL_PROVIDERS = ["MAIL_DEMO", "MAIL_IMAP"] as const;

export type MailboxMeta = {
  provider: MailProviderName;
  flavor: MailFlavor;
  address: string;
  cursor: string | null;
  /** Correo real: gmail, yahoo, icloud… o custom. */
  service?: string;
};

export function readMailboxMeta(value: unknown): MailboxMeta {
  const meta = (value ?? {}) as Partial<MailboxMeta>;
  return {
    provider: meta.provider === "imap" ? "imap" : "sandbox",
    flavor: meta.flavor === "outlook" ? "outlook" : "gmail",
    address: meta.address ?? "",
    cursor: meta.cursor ?? null,
    ...(typeof meta.service === "string" ? { service: meta.service } : {}),
  };
}

export interface OpenMailbox {
  id: string;
  userId: string;
  address: string;
  displayName: string;
  meta: MailboxMeta;
  provider: MailProvider;
  token: string;
}

export async function openMailbox(userId: string, connectionId: string): Promise<OpenMailbox> {
  if (!isUuid(connectionId)) throw Errors.notFound("La bandeja");
  const connection = await prisma.integrationConnection.findFirst({
    where: { id: connectionId, userId, provider: { in: [...MAIL_PROVIDERS] } },
  });
  if (!connection?.accessTokenEncrypted) throw Errors.notFound("La bandeja");
  if (connection.status === "REVOKED") throw Errors.badRequest("Esta bandeja está desconectada. Vuelve a conectarla.");
  const meta = readMailboxMeta(connection.metadata);
  return {
    id: connection.id,
    userId,
    address: meta.address || connection.externalAccountId || "",
    displayName: connection.displayName ?? "Correo",
    meta,
    provider: getMailProvider(meta.provider),
    token: decryptSecret(connection.accessTokenEncrypted),
  };
}

/** Bandeja para enviar respuestas: el correo real si hay uno activo; si no, la de prueba. */
export async function defaultMailbox(userId: string): Promise<OpenMailbox | null> {
  const connections = await prisma.integrationConnection.findMany({
    where: { userId, provider: { in: [...MAIL_PROVIDERS] }, status: "ACTIVE" },
    orderBy: { createdAt: "asc" },
    select: { id: true, provider: true },
  });
  const connection = connections.find((c) => c.provider === "MAIL_IMAP") ?? connections[0];
  return connection ? openMailbox(userId, connection.id) : null;
}

/** Marca la bandeja como vencida si el proveedor rechaza el token. */
export async function flagExpired(connectionId: string, error: unknown) {
  if (error instanceof AppError && error.status === 401) {
    await prisma.integrationConnection.update({ where: { id: connectionId }, data: { status: "EXPIRED" } }).catch(() => undefined);
  }
}

const isPdf = (a: { fileName: string; mimeType: string }) => a.mimeType === "application/pdf" || /\.pdf$/i.test(a.fileName);

/**
 * Descarga un adjunto y lo guarda como documento (una sola vez: si ya se descargó, devuelve el mismo).
 * Los PDF quedan como FORM_TEMPLATE para leer sus campos.
 */
export async function downloadAttachment(userId: string, attachmentId: string, opts: { taskId?: string | null } = {}): Promise<UserDocument> {
  if (!isUuid(attachmentId)) throw Errors.notFound("El adjunto");
  const attachment = await prisma.mailAttachment.findFirst({
    where: { id: attachmentId, userId },
    include: { message: { select: { externalId: true, connectionId: true } }, document: true },
  });
  if (!attachment) throw Errors.notFound("El adjunto");

  if (attachment.document) {
    if (opts.taskId && !attachment.document.taskId) {
      return prisma.userDocument.update({ where: { id: attachment.document.id }, data: { taskId: opts.taskId } });
    }
    return attachment.document;
  }
  if (attachment.sizeBytes > MAX_DOCUMENT_BYTES) throw Errors.badRequest("El adjunto pesa más de 10 MB.");

  const mailbox = await openMailbox(userId, attachment.message.connectionId);
  let file: { bytes: Uint8Array; mimeType: string; fileName: string };
  try {
    file = await mailbox.provider.getAttachment(mailbox.token, attachment.message.externalId, attachment.externalId);
  } catch (error) {
    await flagExpired(mailbox.id, error);
    throw error;
  }
  if (file.bytes.byteLength > MAX_DOCUMENT_BYTES) throw Errors.badRequest("El adjunto pesa más de 10 MB.");

  const doc = await storeDocument(userId, {
    fileName: attachment.fileName,
    mimeType: isPdf(attachment) ? "application/pdf" : file.mimeType,
    bytes: file.bytes,
    kind: isPdf(attachment) ? "FORM_TEMPLATE" : "OTHER",
    source: "email",
    taskId: opts.taskId ?? null,
  });
  // Si otra petición lo descargó al mismo tiempo, gana la primera y se borra la copia.
  const linked = await prisma.mailAttachment.updateMany({ where: { id: attachment.id, documentId: null }, data: { documentId: doc.id } });
  if (linked.count === 0) {
    await deleteDocument(userId, doc.id).catch(() => undefined);
    const current = await prisma.mailAttachment.findUnique({ where: { id: attachment.id }, include: { document: true } });
    if (current?.document) return current.document;
  }
  return doc;
}
