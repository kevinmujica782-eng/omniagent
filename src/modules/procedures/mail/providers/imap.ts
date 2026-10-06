import "server-only";
import { randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { createTransport } from "nodemailer";
import { AppError, Errors } from "@/lib/errors";
import { log } from "@/lib/log";
import { EMAIL_PATTERN, domainOf, mailService, type MailServer, type MailServiceId } from "./imap-presets";
import {
  FIRST_SYNC_DAYS,
  addressList,
  attachmentsFromStructure,
  classifyMailError,
  decodeCredentials,
  decodeImapCursor,
  decodeMimeWords,
  encodeCredentials,
  encodeImapCursor,
  firstAddress,
  imapMessageId,
  mailErrorMessage,
  normalizeMailHost,
  parseImapMessageId,
  pickPublicAddress,
  planImapFetch,
  threadRoot,
  type BodyNode,
  type ImapCredentials,
} from "./imap-rules";
import type { MailMessageData, MailProvider } from "./types";

// Correo real: lee la bandeja de entrada por IMAP (solo lectura: no marca, no mueve, no borra) y envía por SMTP,
// con la contraseña de aplicación de la persona (cifrada en accessTokenEncrypted). Antes de conectar, el nombre
// del servidor se resuelve y se exige una IP pública (nada de redes internas), y TLS valida el certificado.

const SOURCE_LIMIT = 200 * 1024;
const MAX_ATTACHMENT_BYTES = 12 * 1024 * 1024;
const DAY = 86_400_000;

// Forma mínima de lo que usamos de imapflow (sus tipos cambian entre versiones; aquí se fija el contrato).
type Envelope = {
  date?: Date | string;
  subject?: string;
  messageId?: string;
  inReplyTo?: string;
  from?: { name?: string; address?: string }[];
  to?: { name?: string; address?: string }[];
};
type FetchedMessage = { uid: number; envelope?: Envelope; bodyStructure?: BodyNode; internalDate?: Date | string; source?: Buffer };
type MailboxState = { uidValidity?: bigint | number | string; uidNext?: number };
interface ImapSession {
  connect(): Promise<void>;
  logout(): Promise<void>;
  close(): void;
  on(event: "error", listener: (error: unknown) => void): unknown;
  getMailboxLock(path: string, options?: { readOnly?: boolean }): Promise<{ release(): void }>;
  readonly mailbox: MailboxState | false | null | undefined;
  search(query: Record<string, unknown>, options?: { uid?: boolean }): Promise<number[] | false>;
  fetch(range: string, query: Record<string, unknown>, options?: { uid?: boolean }): AsyncIterable<FetchedMessage>;
  fetchOne(range: string, query: Record<string, unknown>, options?: { uid?: boolean }): Promise<FetchedMessage | false>;
  download(
    range: string,
    part?: string,
    options?: { uid?: boolean; maxBytes?: number },
  ): Promise<{ meta?: { contentType?: string; filename?: string }; content: AsyncIterable<Buffer | string> } | false | null | undefined>;
}

/** Errores de red, TLS o contraseña → mensaje claro. Contraseña rechazada: 401 al sincronizar (la bandeja vence). */
function toAppError(error: unknown, phase: "imap" | "smtp", service: MailServiceId, connecting: boolean): AppError {
  if (error instanceof AppError) return error;
  const kind = classifyMailError(error);
  log.warn("mail.imap_error", { phase, kind, error });
  const message = mailErrorMessage(kind, phase, service);
  if (kind === "auth") return new AppError(connecting ? 400 : 401, "mail_auth_failed", message);
  return new AppError(502, "mail_unreachable", message);
}

/**
 * Solo para la prueba de integración de CI (tests/integration): un servidor de correo local con certificado propio.
 * Exige NODE_ENV=test (en producción y en desarrollo nunca se activa).
 */
function localTestServer(): boolean {
  return process.env.NODE_ENV === "test" && process.env.MAIL_TEST_INSECURE_LOCAL === "1";
}

function tlsOptions(servername: string) {
  return { servername, minVersion: "TLSv1.2" as const, ...(localTestServer() ? { rejectUnauthorized: false } : {}) };
}

async function resolveServer(server: MailServer, kind: "imap" | "smtp"): Promise<{ host: string; address: string }> {
  if (localTestServer() && server.host === "localhost") return { host: "localhost", address: "127.0.0.1" };
  const host = normalizeMailHost(server.host);
  const label = kind === "imap" ? "IMAP" : "SMTP";
  if (!host) throw Errors.badRequest(`El servidor ${label} no es válido.`);
  let addresses: { address: string; family: number }[];
  try {
    addresses = await lookup(host, { all: true, verbatim: true });
  } catch {
    throw Errors.badRequest(`No encontramos el servidor ${label} «${host}». Revisa el nombre.`);
  }
  const address = pickPublicAddress(addresses);
  if (!address) throw Errors.badRequest(`El servidor ${label} «${host}» no es público.`);
  return { host, address };
}

async function openImap(credentials: ImapCredentials): Promise<ImapSession> {
  const target = await resolveServer(credentials.imap, "imap");
  const implicitTls = credentials.imap.port === 993;
  const options = {
    host: target.address,
    servername: target.host,
    port: credentials.imap.port,
    secure: implicitTls,
    doSTARTTLS: implicitTls ? undefined : true,
    auth: { user: credentials.user, pass: credentials.pass },
    logger: false,
    emitLogs: false,
    disableAutoIdle: true,
    connectionTimeout: 12_000,
    greetingTimeout: 10_000,
    socketTimeout: 45_000,
    tls: tlsOptions(target.host),
  };
  const client = new ImapFlow(options as unknown as ConstructorParameters<typeof ImapFlow>[0]) as unknown as ImapSession;
  // Sin oyente, un error del socket después de conectar tumbaría el proceso.
  client.on("error", (error) => log.warn("mail.imap_socket_error", { error }));
  await client.connect();
  return client;
}

/** Abre INBOX en solo lectura (EXAMINE), corre `run` y cierra la sesión pase lo que pase. */
async function withInbox<T>(
  credentials: ImapCredentials,
  run: (client: ImapSession, box: { validity: string; uidNext: number | null }) => Promise<T>,
  opts: { connecting?: boolean } = {},
): Promise<T> {
  let client: ImapSession | null = null;
  try {
    client = await openImap(credentials);
    const lock = await client.getMailboxLock("INBOX", { readOnly: true });
    try {
      const mailbox = client.mailbox;
      if (!mailbox || mailbox.uidValidity === undefined) throw new Error("INBOX no disponible");
      return await run(client, { validity: String(mailbox.uidValidity), uidNext: typeof mailbox.uidNext === "number" ? mailbox.uidNext : null });
    } finally {
      lock.release();
    }
  } catch (error) {
    throw toAppError(error, "imap", credentials.service, Boolean(opts.connecting));
  } finally {
    if (client) {
      const session = client;
      await session.logout().catch(() => session.close());
    }
  }
}

function smtpTransport(credentials: ImapCredentials, target: { host: string; address: string }) {
  const implicitTls = credentials.smtp.port === 465;
  return createTransport({
    host: target.address,
    port: credentials.smtp.port,
    secure: implicitTls,
    requireTLS: !implicitTls,
    auth: { user: credentials.user, pass: credentials.pass },
    tls: tlsOptions(target.host),
    connectionTimeout: 12_000,
    greetingTimeout: 10_000,
    socketTimeout: 30_000,
  });
}

async function verifySmtp(credentials: ImapCredentials): Promise<void> {
  const target = await resolveServer(credentials.smtp, "smtp");
  const transport = smtpTransport(credentials, target);
  try {
    await transport.verify();
  } catch (error) {
    throw toAppError(error, "smtp", credentials.service, true);
  } finally {
    transport.close();
  }
}

function asDate(value: Date | string | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

async function toMessage(message: FetchedMessage, validity: string): Promise<MailMessageData> {
  const parsed = message.source
    ? await simpleParser(message.source, { skipImageLinks: true, skipTextToHtml: true, skipTextLinks: true }).catch(() => null)
    : null;
  const envelope = message.envelope ?? {};
  const parsedFrom = parsed?.from?.value?.[0];
  const from = firstAddress(envelope.from?.length ? envelope.from : parsedFrom ? [parsedFrom] : []);
  return {
    id: imapMessageId(validity, message.uid),
    threadId: threadRoot(parsed?.references, envelope.inReplyTo ?? parsed?.inReplyTo, envelope.messageId ?? parsed?.messageId),
    from,
    to: addressList(envelope.to),
    subject: decodeMimeWords(envelope.subject ?? parsed?.subject ?? "").trim() || "(sin asunto)",
    bodyText: (parsed?.text ?? "").replace(/\r\n/g, "\n").trim(),
    receivedAt: asDate(message.internalDate) ?? asDate(envelope.date) ?? parsed?.date ?? new Date(),
    labels: [],
    attachments: attachmentsFromStructure(message.bodyStructure),
  };
}

async function readStream(stream: AsyncIterable<Buffer | string>, limit: number): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of stream) {
    const buffer = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
    total += buffer.byteLength;
    if (total > limit) throw Errors.badRequest("El adjunto pesa más de 10 MB.");
    chunks.push(buffer);
  }
  return new Uint8Array(Buffer.concat(chunks));
}

/** Message-ID del correo al que se responde (para que la respuesta quede en el mismo hilo). */
async function originalMessageId(credentials: ImapCredentials, externalId: string): Promise<string | null> {
  const ref = parseImapMessageId(externalId);
  if (!ref) return null;
  return withInbox(credentials, async (client, box) => {
    if (box.validity !== ref.validity) return null;
    const message = await client.fetchOne(String(ref.uid), { uid: true, envelope: true }, { uid: true });
    return message && message.envelope?.messageId ? message.envelope.messageId : null;
  });
}

export const imapMailProvider: MailProvider = {
  name: "imap",

  async connect({ credentials }) {
    if (!credentials) throw Errors.badRequest("Faltan los datos de tu correo.");
    // Entra a IMAP (lee) y a SMTP (envía): si algo falla, la persona lo sabe ahora y no en el primer envío.
    await withInbox(credentials, async () => undefined, { connecting: true });
    await verifySmtp(credentials);
    return {
      accessToken: encodeCredentials(credentials),
      account: {
        address: credentials.user.toLowerCase(),
        displayName: mailService(credentials.service)?.name ?? domainOf(credentials.user),
        flavor: "gmail",
      },
    };
  },

  async syncMessages(accessToken, rawCursor) {
    const credentials = decodeCredentials(accessToken);
    const cursor = decodeImapCursor(rawCursor);
    return withInbox(credentials, async (client, box) => {
      const incremental = cursor !== null && cursor.v === box.validity ? cursor : null;
      if (incremental && box.uidNext !== null && box.uidNext <= incremental.last + 1) {
        return { messages: [], deleted: [], nextCursor: encodeImapCursor(incremental), hasMore: false };
      }
      const query = incremental ? { uid: `${incremental.last + 1}:*` } : { since: new Date(Date.now() - FIRST_SYNC_DAYS * DAY) };
      const found = (await client.search(query, { uid: true })) || [];
      const plan = planImapFetch({ cursor, validity: box.validity, uidNext: box.uidNext, found });
      if (plan.uids.length === 0) return { messages: [], deleted: [], nextCursor: encodeImapCursor(plan.cursor), hasMore: false };

      // Primero se descarga todo (no se puede mandar otro comando mientras corre el FETCH) y luego se procesa.
      const fetched: FetchedMessage[] = [];
      for await (const message of client.fetch(
        plan.uids.join(","),
        { uid: true, envelope: true, bodyStructure: true, internalDate: true, source: { maxLength: SOURCE_LIMIT } },
        { uid: true },
      )) {
        fetched.push(message);
      }
      const messages: MailMessageData[] = [];
      for (const message of fetched.sort((a, b) => a.uid - b.uid)) messages.push(await toMessage(message, box.validity));
      return { messages, deleted: [], nextCursor: encodeImapCursor(plan.cursor), hasMore: plan.hasMore };
    });
  },

  async getAttachment(accessToken, messageId, attachmentId) {
    const credentials = decodeCredentials(accessToken);
    const ref = parseImapMessageId(messageId);
    if (!ref || !/^\d+(\.\d+)*$/.test(attachmentId)) throw Errors.notFound("El adjunto");
    return withInbox(credentials, async (client, box) => {
      if (box.validity !== ref.validity) throw Errors.notFound("El adjunto");
      const download = await client.download(String(ref.uid), attachmentId, { uid: true, maxBytes: MAX_ATTACHMENT_BYTES + 1 });
      if (!download) throw Errors.notFound("El adjunto");
      const bytes = await readStream(download.content, MAX_ATTACHMENT_BYTES);
      return {
        bytes,
        mimeType: download.meta?.contentType || "application/octet-stream",
        fileName: decodeMimeWords(download.meta?.filename || `adjunto-${attachmentId}`),
      };
    });
  },

  async sendMessage(accessToken, mail) {
    const credentials = decodeCredentials(accessToken);
    if (!EMAIL_PATTERN.test(mail.to)) throw Errors.badRequest("La dirección del destinatario no es válida.");
    const original = mail.inReplyTo ? await originalMessageId(credentials, mail.inReplyTo).catch(() => null) : null;
    const target = await resolveServer(credentials.smtp, "smtp");
    const transport = smtpTransport(credentials, target);
    try {
      const info = await transport.sendMail({
        from: credentials.name ? { name: credentials.name, address: credentials.user } : credentials.user,
        to: mail.to,
        subject: mail.subject,
        text: mail.body,
        ...(original ? { inReplyTo: original, references: original } : {}),
        attachments: (mail.attachments ?? []).map((a) => ({ filename: a.fileName, contentType: a.mimeType, content: Buffer.from(a.bytes) })),
      });
      return { id: `smtp:${info.messageId || randomUUID()}`, sentAt: new Date() };
    } catch (error) {
      throw toAppError(error, "smtp", credentials.service, false);
    } finally {
      transport.close();
    }
  },

  // El correo por IMAP no trae calendario: los eventos quedan en OmniAgent y en el enlace del calendario del teléfono.
  async listCalendarEvents() {
    return [];
  },

  async createCalendarEvent() {
    throw Errors.badRequest("Este correo no tiene calendario conectado. Usa el enlace del calendario del teléfono.");
  },

  async deleteCalendarEvent() {},
};
