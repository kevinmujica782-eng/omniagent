import "server-only";
import { randomUUID } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import { audit } from "@/lib/audit";
import { encryptSecret } from "@/lib/crypto";
import { prisma } from "@/lib/db";
import { AppError, Errors } from "@/lib/errors";
import { firstName } from "@/lib/format";
import { isUuid } from "@/lib/validation";
import type { MailboxView, MailCategoryKind, MailMessageView } from "@/types/cards";
import { parseIcs } from "../calendar/ics";
import { getDocumentFile } from "../documents/documents.service";
import { seedDemoPersonalData } from "../documents/personal-data.service";
import { safeTimeZone } from "../time/tz";
import { MAIL_PROVIDERS, defaultMailbox, flagExpired, openMailbox, readMailboxMeta, type MailboxMeta, type OpenMailbox } from "./mailbox";
import { getMailProvider } from "./providers";
import {
  EMAIL_PATTERN,
  MICROSOFT_NOTICE,
  detectMailService,
  mailService,
  normalizeAppPassword,
  type MailServer,
  type MailServiceId,
} from "./providers/imap-presets";
import { mailServerProblem, normalizeMailHost, type ImapCredentials } from "./providers/imap-rules";
import type { MailFlavor, MailMessageData } from "./providers/types";
import { toStoredIcs, triageInbox, type MailExtracted } from "./triage/triage.service";

// Bandejas de correo: conectar, sincronizar (incremental, con cursor), clasificar, listar, buscar y enviar.
// Correo real por IMAP/SMTP o bandeja de prueba (sandbox); el envío solo ocurre después de que el usuario aprueba.

const MAX_PAGES = 10;
const MAX_ICS_BYTES = 256 * 1024;
const MAX_BODY = 20_000;

export interface MailSyncResult {
  fetched: number;
  created: number;
  removed: number;
  triaged: number;
  suggested: number;
  source: "AI" | "RULES" | null;
}

const isIcs = (a: { fileName: string; mimeType: string }) => a.mimeType === "text/calendar" || /\.ics$/i.test(a.fileName);

function snippetOf(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > 160 ? `${flat.slice(0, 159).trimEnd()}…` : flat;
}

/** Conecta la bandeja de prueba (estilo Gmail u Outlook), carga datos de ejemplo y la sincroniza. */
export async function connectMailbox(userId: string, input: { flavor: MailFlavor; withDemoData?: boolean }) {
  const profile = await prisma.profile.findUnique({
    where: { id: userId },
    select: { fullName: true, email: true, timezone: true },
  });
  const timeZone = safeTimeZone(profile?.timezone);
  const provider = getMailProvider("sandbox");
  const { accessToken, account } = await provider.connect({
    userId,
    flavor: input.flavor,
    firstName: firstName(profile?.fullName),
    timeZone,
  });
  // Una sola bandeja de prueba a la vez (dos repetirían los mismos correos y trámites).
  const other = await prisma.integrationConnection.findFirst({
    where: { userId, provider: "MAIL_DEMO", NOT: { externalAccountId: account.address } },
    select: { id: true },
  });
  if (other) throw Errors.conflict("Ya tienes una bandeja de prueba conectada. Desconéctala para cambiarla.");
  const meta: MailboxMeta = { provider: provider.name, flavor: account.flavor, address: account.address, cursor: null };
  const connection = await prisma.integrationConnection.upsert({
    where: { userId_provider_externalAccountId: { userId, provider: "MAIL_DEMO", externalAccountId: account.address } },
    create: {
      userId,
      provider: "MAIL_DEMO",
      externalAccountId: account.address,
      displayName: account.displayName,
      scopes: ["mail.read", "mail.send", "calendar.read", "calendar.write"],
      accessTokenEncrypted: encryptSecret(accessToken),
      status: "ACTIVE",
      metadata: meta as unknown as Prisma.InputJsonValue,
    },
    update: {
      displayName: account.displayName,
      accessTokenEncrypted: encryptSecret(accessToken),
      status: "ACTIVE",
      // Se conserva el cursor: los correos ya guardados no se duplican.
    },
  });

  if (input.withDemoData !== false) {
    await seedDemoPersonalData(userId, profile?.fullName ?? null, profile?.email ?? null);
  }
  await audit({
    userId,
    actor: "user",
    action: "mail.connected",
    entity: "integration_connection",
    entityId: connection.id,
    metadata: { provider: provider.name, flavor: input.flavor },
  });
  const sync = await syncMailbox(userId, connection.id);
  const mailbox = (await listMailboxes(userId)).find((m) => m.id === connection.id)!;
  return { mailbox, sync };
}

export interface RealMailboxInput {
  email: string;
  /** Contraseña de aplicación (Gmail, Yahoo, iCloud…) o la del servidor propio. */
  password: string;
  service: MailServiceId;
  /** Solo con service = "custom". */
  imap?: MailServer;
  smtp?: MailServer;
}

const MAX_REAL_MAILBOXES = 3;
const EMPTY_SYNC: MailSyncResult = { fetched: 0, created: 0, removed: 0, triaged: 0, suggested: 0, source: null };

/**
 * Conecta el correo real de la persona (IMAP para leer, SMTP para enviar). Verifica las dos conexiones antes de
 * guardar nada, guarda la contraseña cifrada y hace la primera revisión de la bandeja.
 */
export async function connectRealMailbox(userId: string, input: RealMailboxInput) {
  const email = input.email.trim().toLowerCase();
  if (!EMAIL_PATTERN.test(email)) throw Errors.badRequest("Escribe tu correo completo, por ejemplo laura@gmail.com.");
  if (detectMailService(email) === "microsoft") throw Errors.badRequest(MICROSOFT_NOTICE);
  const preset = input.service === "custom" ? null : mailService(input.service);
  if (input.service !== "custom" && !preset) throw Errors.badRequest("Elige tu proveedor de correo.");
  const imap = preset ? preset.imap : input.imap;
  const smtp = preset ? preset.smtp : input.smtp;
  if (!imap || !smtp) throw Errors.badRequest("Escribe los servidores IMAP y SMTP de tu correo.");
  const problem = mailServerProblem(imap, "imap") ?? mailServerProblem(smtp, "smtp");
  if (problem) throw Errors.badRequest(problem);
  const password = normalizeAppPassword(input.service, input.password);
  if (!password) throw Errors.badRequest("Escribe la contraseña de aplicación.");

  const existing = await prisma.integrationConnection.findMany({
    where: { userId, provider: "MAIL_IMAP" },
    select: { id: true, externalAccountId: true, metadata: true },
  });
  const same = existing.find((c) => c.externalAccountId === email);
  if (!same && existing.length >= MAX_REAL_MAILBOXES) throw Errors.conflict(`Puedes conectar hasta ${MAX_REAL_MAILBOXES} correos.`);

  const profile = await prisma.profile.findUnique({ where: { id: userId }, select: { fullName: true, timezone: true } });
  const credentials: ImapCredentials = {
    v: 1,
    service: input.service,
    user: email,
    pass: password,
    name: profile?.fullName?.trim() || null,
    imap: { host: normalizeMailHost(imap.host) ?? imap.host, port: imap.port },
    smtp: { host: normalizeMailHost(smtp.host) ?? smtp.host, port: smtp.port },
  };
  const provider = getMailProvider("imap");
  const { accessToken, account } = await provider.connect({
    userId,
    flavor: "gmail",
    firstName: firstName(profile?.fullName),
    timeZone: safeTimeZone(profile?.timezone),
    credentials,
  });

  // Al reconectar (contraseña nueva) se conserva el cursor: los correos ya guardados no se duplican.
  const previous = same ? readMailboxMeta(same.metadata) : null;
  const meta: MailboxMeta = {
    provider: "imap",
    flavor: account.flavor,
    address: account.address,
    cursor: previous?.cursor ?? null,
    service: input.service,
  };
  const data = {
    displayName: account.displayName,
    scopes: ["mail.read", "mail.send"],
    accessTokenEncrypted: encryptSecret(accessToken),
    status: "ACTIVE" as const,
    metadata: meta as unknown as Prisma.InputJsonValue,
  };
  const connection = same
    ? await prisma.integrationConnection.update({ where: { id: same.id }, data })
    : await prisma.integrationConnection.create({ data: { userId, provider: "MAIL_IMAP", externalAccountId: account.address, ...data } });

  await audit({
    userId,
    actor: "user",
    action: "mail.connected",
    entity: "integration_connection",
    entityId: connection.id,
    metadata: { provider: "imap", service: input.service, reconnected: Boolean(same) },
  });

  let sync = EMPTY_SYNC;
  let syncError: string | null = null;
  try {
    sync = await syncMailbox(userId, connection.id);
  } catch (error) {
    // La bandeja quedó conectada: la próxima revisión (o el trabajo programado) la pone al día.
    console.error("[mail] primera revisión del correo real", connection.id, error);
    syncError = error instanceof AppError ? error.message : "La primera revisión no terminó; Omni lo intentará de nuevo.";
  }
  const mailbox = (await listMailboxes(userId)).find((m) => m.id === connection.id)!;
  return { mailbox, sync, syncError };
}

async function readInvites(mailbox: OpenMailbox, message: MailMessageData, timeZone: string): Promise<MailExtracted["ics"]> {
  const invites = message.attachments.filter(isIcs).filter((a) => a.size <= MAX_ICS_BYTES).slice(0, 2);
  const events = [];
  for (const invite of invites) {
    try {
      const file = await mailbox.provider.getAttachment(mailbox.token, message.id, invite.id);
      if (file.bytes.byteLength > MAX_ICS_BYTES) continue;
      events.push(...parseIcs(new TextDecoder().decode(file.bytes), timeZone));
    } catch (error) {
      console.error("[mail] no se pudo leer la invitación", invite.fileName, error);
    }
  }
  return events.length ? toStoredIcs(events) : undefined;
}

/** Sincronización incremental: guarda los correos nuevos (con sus adjuntos e invitaciones) y los clasifica. */
export async function syncMailbox(
  userId: string,
  connectionId: string,
  opts: { triage?: boolean; preferAI?: boolean } = {},
): Promise<MailSyncResult> {
  const mailbox = await openMailbox(userId, connectionId);
  const profile = await prisma.profile.findUnique({ where: { id: userId }, select: { timezone: true } });
  const timeZone = safeTimeZone(profile?.timezone);
  let cursor = mailbox.meta.cursor;
  const counts = { fetched: 0, created: 0, removed: 0 };

  try {
    for (let page = 0; page < MAX_PAGES; page++) {
      const result = await mailbox.provider.syncMessages(mailbox.token, cursor);
      counts.fetched += result.messages.length;
      for (const message of result.messages) {
        const known = await prisma.mailMessage.findUnique({
          where: { connectionId_externalId: { connectionId, externalId: message.id } },
          select: { id: true },
        });
        if (known) continue;
        const ics = await readInvites(mailbox, message, timeZone);
        const extracted: MailExtracted = ics ? { ics } : {};
        try {
          await prisma.mailMessage.create({
            data: {
              userId,
              connectionId,
              externalId: message.id,
              threadId: message.threadId,
              folder: "inbox",
              fromName: message.from.name,
              fromEmail: message.from.email.toLowerCase(),
              toEmails: message.to,
              subject: message.subject.slice(0, 300),
              snippet: snippetOf(message.bodyText),
              bodyText: message.bodyText.slice(0, MAX_BODY),
              receivedAt: message.receivedAt,
              labels: message.labels,
              extracted: extracted as unknown as Prisma.InputJsonValue,
              attachments: {
                create: message.attachments.map((a) => ({
                  userId,
                  externalId: a.id,
                  fileName: a.fileName.slice(0, 200),
                  mimeType: a.mimeType,
                  sizeBytes: a.size,
                })),
              },
            },
          });
          counts.created += 1;
        } catch (error) {
          // Otra sincronización lo guardó al mismo tiempo.
          const again = await prisma.mailMessage.findUnique({
            where: { connectionId_externalId: { connectionId, externalId: message.id } },
            select: { id: true },
          });
          if (!again) throw error;
        }
      }
      if (result.deleted.length > 0) {
        // Si el correo se borró en el servidor, su sugerencia sin confirmar también sobra.
        await prisma.task.deleteMany({
          where: { userId, status: "SUGGESTED", mailMessage: { connectionId, externalId: { in: result.deleted } } },
        });
        counts.removed += (await prisma.mailMessage.deleteMany({ where: { connectionId, externalId: { in: result.deleted } } })).count;
      }
      cursor = result.nextCursor;
      if (!result.hasMore) break;
    }
  } catch (error) {
    await flagExpired(connectionId, error);
    throw error;
  }

  await prisma.integrationConnection.update({
    where: { id: connectionId },
    data: { status: "ACTIVE", lastSyncedAt: new Date(), metadata: { ...mailbox.meta, cursor } as unknown as Prisma.InputJsonValue },
  });

  const triage = opts.triage === false ? null : await triageInbox(userId, { preferAI: opts.preferAI });
  return {
    ...counts,
    triaged: triage?.triaged ?? 0,
    suggested: triage?.suggested ?? 0,
    source: triage?.source ?? null,
  };
}

/** Todas las bandejas activas del usuario ("Revisar correo"). */
export async function syncAllMailboxes(userId: string, opts: { preferAI?: boolean } = {}) {
  const connections = await prisma.integrationConnection.findMany({
    where: { userId, provider: { in: [...MAIL_PROVIDERS] }, status: "ACTIVE" },
    select: { id: true },
  });
  const totals: MailSyncResult & { mailboxes: number; errors: number } = {
    mailboxes: 0,
    errors: 0,
    fetched: 0,
    created: 0,
    removed: 0,
    triaged: 0,
    suggested: 0,
    source: null,
  };
  for (const connection of connections) {
    try {
      const result = await syncMailbox(userId, connection.id, { triage: false });
      totals.mailboxes += 1;
      totals.fetched += result.fetched;
      totals.created += result.created;
      totals.removed += result.removed;
    } catch (error) {
      totals.errors += 1;
      console.error("[mail] no se pudo sincronizar", connection.id, error);
    }
  }
  // Una sola clasificación al final (un solo lote para la IA).
  const triage = await triageInbox(userId, { preferAI: opts.preferAI });
  totals.triaged = triage.triaged;
  totals.suggested = triage.suggested;
  totals.source = triage.source;
  return totals;
}

export async function listMailboxes(userId: string): Promise<MailboxView[]> {
  const rows = await prisma.integrationConnection.findMany({
    where: { userId, provider: { in: [...MAIL_PROVIDERS] } },
    orderBy: { createdAt: "asc" },
  });
  // El correo real va primero (es el que se usa para enviar).
  rows.sort((a, b) => Number(b.provider === "MAIL_IMAP") - Number(a.provider === "MAIL_IMAP"));
  return Promise.all(
    rows.map(async (row) => {
      const meta = readMailboxMeta(row.metadata);
      return {
        id: row.id,
        address: meta.address || row.externalAccountId || "",
        displayName: row.displayName ?? "Correo",
        flavor: meta.flavor,
        provider: meta.provider,
        status: row.status,
        lastSyncedAt: row.lastSyncedAt?.toISOString() ?? null,
        messageCount: await prisma.mailMessage.count({ where: { connectionId: row.id, folder: "inbox" } }),
      };
    }),
  );
}

/** Desconecta: borra los correos guardados y las sugerencias sin confirmar. Los trámites confirmados se quedan. */
export async function disconnectMailbox(userId: string, connectionId: string) {
  if (!isUuid(connectionId)) throw Errors.notFound("La bandeja");
  const connection = await prisma.integrationConnection.findFirst({
    where: { id: connectionId, userId, provider: { in: [...MAIL_PROVIDERS] } },
    select: { id: true },
  });
  if (!connection) throw Errors.notFound("La bandeja");
  await prisma.task.deleteMany({ where: { userId, status: "SUGGESTED", mailMessage: { connectionId } } });
  // Los eventos que se habían enviado a ese calendario quedan solo en OmniAgent (y en el feed ICS).
  await prisma.calendarEvent.updateMany({
    where: { userId, connectionId },
    data: { syncStatus: "LOCAL_ONLY", externalEventId: null, connectionId: null },
  });
  await prisma.integrationConnection.delete({ where: { id: connectionId } });
  await audit({ userId, actor: "user", action: "mail.disconnected", entity: "integration_connection", entityId: connectionId });
  return { removed: true };
}

// ── Lectura ──────────────────────────────────────────────────────────────────

const MESSAGE_INCLUDE = {
  attachments: { select: { id: true, fileName: true, mimeType: true, documentId: true } },
  tasks: { select: { id: true }, take: 1 },
} as const;

type MessageRow = Prisma.MailMessageGetPayload<{ include: typeof MESSAGE_INCLUDE }>;

function toMessageView(row: MessageRow): MailMessageView {
  return {
    id: row.id,
    folder: row.folder === "sent" ? "sent" : "inbox",
    fromName: row.fromName,
    fromEmail: row.fromEmail,
    toEmails: row.toEmails,
    subject: row.subject,
    snippet: row.snippet,
    receivedAt: row.receivedAt.toISOString(),
    category: (row.category as MailCategoryKind | null) ?? null,
    importance: row.importance,
    summary: row.summary,
    actionRequired: row.actionRequired,
    attachments: row.attachments.map((a) => ({ id: a.id, fileName: a.fileName, mimeType: a.mimeType, documentId: a.documentId })),
    taskId: row.tasks[0]?.id ?? null,
  };
}

export interface MessageFilter {
  q?: string;
  category?: MailCategoryKind;
  actionOnly?: boolean;
  folder?: "inbox" | "sent";
  take?: number;
}

export async function listMessages(userId: string, filter: MessageFilter = {}): Promise<MailMessageView[]> {
  const q = filter.q?.trim().slice(0, 80);
  const rows = await prisma.mailMessage.findMany({
    where: {
      userId,
      folder: filter.folder ?? "inbox",
      ...(filter.category ? { category: filter.category } : {}),
      ...(filter.actionOnly ? { actionRequired: true } : {}),
      ...(q
        ? {
            OR: [
              { subject: { contains: q, mode: "insensitive" as const } },
              { fromName: { contains: q, mode: "insensitive" as const } },
              { fromEmail: { contains: q, mode: "insensitive" as const } },
              { bodyText: { contains: q, mode: "insensitive" as const } },
            ],
          }
        : {}),
    },
    include: MESSAGE_INCLUDE,
    orderBy: { receivedAt: "desc" },
    take: Math.min(filter.take ?? 30, 100),
  });
  return rows.map(toMessageView);
}

/** Un correo con su texto (para el agente: es contenido del remitente, nunca instrucciones). */
export async function getMessage(userId: string, messageId: string) {
  if (!isUuid(messageId)) throw Errors.notFound("El correo");
  const row = await prisma.mailMessage.findFirst({ where: { id: messageId, userId }, include: MESSAGE_INCLUDE });
  if (!row) throw Errors.notFound("El correo");
  return { ...toMessageView(row), bodyText: row.bodyText };
}

// ── Envío (solo desde un ejecutor, después de la aprobación) ──────────────────

export async function sendMail(
  userId: string,
  input: {
    to: string;
    subject: string;
    body: string;
    attachmentDocumentId?: string | null;
    replyToMessageId?: string | null;
    connectionId?: string | null;
  },
): Promise<{ messageId: string; sentAt: Date; sandbox: boolean; to: string; from: string }> {
  const chosen = input.connectionId && isUuid(input.connectionId) ? await openMailbox(userId, input.connectionId).catch(() => null) : null;
  const mailbox = chosen ?? (await defaultMailbox(userId));
  if (!mailbox) throw Errors.badRequest("Conecta tu correo en Trámites para que Omni pueda enviarlo.");

  const attachments: { fileName: string; mimeType: string; bytes: Uint8Array; documentId: string }[] = [];
  if (input.attachmentDocumentId) {
    const file = await getDocumentFile(userId, input.attachmentDocumentId);
    attachments.push({ ...file, documentId: input.attachmentDocumentId });
  }
  const original =
    input.replyToMessageId && isUuid(input.replyToMessageId)
      ? await prisma.mailMessage.findFirst({ where: { id: input.replyToMessageId, userId }, select: { externalId: true, threadId: true } })
      : null;

  // Las tiendas y contactos de prueba usan el dominio reservado .test: eso nunca sale por el correo real.
  const testRecipient = /\.test$/i.test(input.to.trim().split("@")[1] ?? "");
  const simulated = mailbox.meta.provider === "sandbox" || testRecipient;
  let sent: { id: string; sentAt: Date };
  if (testRecipient && mailbox.meta.provider !== "sandbox") {
    sent = { id: `sbx_sent_${randomUUID()}`, sentAt: new Date() };
  } else {
    try {
      sent = await mailbox.provider.sendMessage(mailbox.token, {
        to: input.to,
        subject: input.subject,
        body: input.body,
        inReplyTo: original?.externalId ?? null,
        attachments: attachments.map(({ fileName, mimeType, bytes }) => ({ fileName, mimeType, bytes })),
      });
    } catch (error) {
      await flagExpired(mailbox.id, error);
      throw error;
    }
  }

  // Un documento solo puede quedar ligado a un adjunto: si ya se envió antes, el registro va sin enlace.
  const linkable = new Set<string>();
  for (const a of attachments) {
    const used = await prisma.mailAttachment.count({ where: { documentId: a.documentId } });
    if (used === 0) linkable.add(a.documentId);
  }
  const record = await prisma.mailMessage.create({
    data: {
      userId,
      connectionId: mailbox.id,
      externalId: sent.id,
      threadId: original?.threadId ?? null,
      folder: "sent",
      fromEmail: mailbox.address,
      toEmails: [input.to],
      subject: input.subject.slice(0, 300),
      snippet: snippetOf(input.body),
      bodyText: input.body.slice(0, MAX_BODY),
      receivedAt: sent.sentAt,
      isRead: true,
      labels: ["SENT"],
      triagedAt: sent.sentAt,
      attachments: {
        create: attachments.map((a, i) => ({
          userId,
          externalId: `${sent.id}_${i + 1}`,
          fileName: a.fileName,
          mimeType: a.mimeType,
          sizeBytes: a.bytes.byteLength,
          documentId: linkable.has(a.documentId) ? a.documentId : null,
        })),
      },
    },
  });
  await audit({
    userId,
    actor: "system",
    action: "mail.sent",
    entity: "mail_message",
    entityId: record.id,
    metadata: { provider: mailbox.meta.provider, attachments: attachments.length, simulated },
  });
  return { messageId: record.id, sentAt: sent.sentAt, sandbox: simulated, to: input.to, from: mailbox.address };
}
