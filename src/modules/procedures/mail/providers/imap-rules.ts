// Reglas puras del correo real por IMAP/SMTP: credenciales, servidores permitidos, cursor de sincronización,
// adjuntos según la estructura MIME y mensajes de error. Sin red ni base de datos (se prueban en tests/unit).
import { AppError } from "@/lib/errors";
import { isIpLiteral, isPublicAddress } from "@/modules/concierge/scraper/net-policy";
import { EMAIL_PATTERN, mailService, type MailServer, type MailServiceId } from "./imap-presets";
import type { MailAttachmentMeta } from "./types";

export const IMAP_PORTS = [993, 143];
export const SMTP_PORTS = [465, 587];

/** Primera sincronización: los correos de los últimos días, como máximo FIRST_SYNC_MAX. */
export const FIRST_SYNC_DAYS = 30;
export const FIRST_SYNC_MAX = 20;
/** Sincronizaciones siguientes: de a PAGE_SIZE correos nuevos por página. */
export const PAGE_SIZE = 25;
/** Si hay más nuevos que esto (la bandeja estuvo meses sin revisarse), se toman solo los más recientes. */
export const RESYNC_THRESHOLD = 200;

/** Lo que va cifrado en accessTokenEncrypted. */
export type ImapCredentials = {
  v: 1;
  service: MailServiceId;
  /** Usuario de IMAP y SMTP (el correo). */
  user: string;
  pass: string;
  /** Nombre para el remitente («Laura Pérez <laura@…>»). */
  name: string | null;
  imap: MailServer;
  smtp: MailServer;
};

export function encodeCredentials(credentials: ImapCredentials): string {
  return JSON.stringify(credentials);
}

const invalidAccess = () => new AppError(401, "invalid_access_token", "El acceso a este correo ya no es válido. Vuelve a conectarlo.");

export function decodeCredentials(token: string): ImapCredentials {
  let value: Partial<ImapCredentials> | null = null;
  try {
    value = JSON.parse(token) as Partial<ImapCredentials>;
  } catch {
    throw invalidAccess();
  }
  const server = (s: unknown): s is MailServer =>
    !!s && typeof (s as MailServer).host === "string" && Number.isInteger((s as MailServer).port);
  if (!value || value.v !== 1 || typeof value.user !== "string" || typeof value.pass !== "string" || !server(value.imap) || !server(value.smtp)) {
    throw invalidAccess();
  }
  return {
    v: 1,
    service: value.service && (value.service === "custom" || mailService(value.service)) ? value.service : "custom",
    user: value.user,
    pass: value.pass,
    name: typeof value.name === "string" ? value.name : null,
    imap: value.imap,
    smtp: value.smtp,
  };
}

const BLOCKED_SUFFIXES = [".localhost", ".local", ".internal", ".intranet", ".lan", ".home.arpa", ".corp", ".private", ".test"];

/** Nombre de servidor válido y público (no IP literal, no localhost ni dominios internos). */
export function normalizeMailHost(raw: string): string | null {
  const host = raw.trim().toLowerCase().replace(/\.$/, "");
  if (!host || host.length > 253 || isIpLiteral(host) || host.startsWith("[")) return null;
  if (host === "localhost" || !host.includes(".") || BLOCKED_SUFFIXES.some((suffix) => host.endsWith(suffix))) return null;
  if (!/^[a-z0-9.-]+$/.test(host) || host.split(".").some((label) => !label || label.length > 63 || label.startsWith("-") || label.endsWith("-"))) {
    return null;
  }
  return host;
}

/** Problema con un servidor que escribió la persona (null si está bien). */
export function mailServerProblem(server: MailServer, kind: "imap" | "smtp"): string | null {
  const label = kind === "imap" ? "IMAP" : "SMTP";
  if (!normalizeMailHost(server.host)) return `El servidor ${label} no es válido. Escribe su nombre, por ejemplo ${kind}.tudominio.com.`;
  const ports = kind === "imap" ? IMAP_PORTS : SMTP_PORTS;
  if (!ports.includes(server.port)) return `El puerto ${label} debe ser ${ports.join(" o ")}.`;
  return null;
}

/** De las direcciones del DNS, la primera pública (IPv4 primero: no todas las funciones tienen salida IPv6). */
export function pickPublicAddress(addresses: { address: string; family: number }[]): string | null {
  const ordered = [...addresses.filter((a) => a.family === 4), ...addresses.filter((a) => a.family !== 4)];
  return ordered.find((a) => isPublicAddress(a.address))?.address ?? null;
}

// ── Cursor ───────────────────────────────────────────────────────────────────

/** v: UIDVALIDITY de la bandeja (si cambia, los UID se reinician); last: último UID guardado. */
export type ImapCursor = { v: string; last: number };

export function encodeImapCursor(cursor: ImapCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

export function decodeImapCursor(raw: string | null): ImapCursor | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Partial<ImapCursor>;
    return typeof value.v === "string" && Number.isInteger(value.last) && (value.last as number) >= 0 ? { v: value.v, last: value.last as number } : null;
  } catch {
    return null;
  }
}

/**
 * Qué UID traer. Primera vez (o si cambió UIDVALIDITY): los más recientes de los últimos días. Después: los nuevos,
 * del más viejo al más nuevo y de a PAGE_SIZE. `found` es el resultado de la búsqueda en el servidor.
 */
export function planImapFetch(input: {
  cursor: ImapCursor | null;
  validity: string;
  uidNext: number | null;
  found: number[];
}): { uids: number[]; hasMore: boolean; cursor: ImapCursor } {
  const sorted = [...new Set(input.found.filter((uid) => Number.isInteger(uid) && uid > 0))].sort((a, b) => a - b);
  const fresh = input.cursor && input.cursor.v === input.validity ? input.cursor : null;
  const newest = sorted.length ? sorted[sorted.length - 1] : 0;
  const serverLast = input.uidNext && input.uidNext > 1 ? input.uidNext - 1 : 0;

  if (!fresh) {
    const uids = sorted.slice(-FIRST_SYNC_MAX);
    return { uids, hasMore: false, cursor: { v: input.validity, last: Math.max(newest, serverLast) } };
  }
  // En IMAP, «N:*» siempre devuelve al menos el último mensaje aunque su UID sea menor que N.
  const pending = sorted.filter((uid) => uid > fresh.last);
  if (pending.length > RESYNC_THRESHOLD) {
    return { uids: pending.slice(-FIRST_SYNC_MAX), hasMore: false, cursor: { v: input.validity, last: pending[pending.length - 1] } };
  }
  const uids = pending.slice(0, PAGE_SIZE);
  return {
    uids,
    hasMore: pending.length > PAGE_SIZE,
    cursor: { v: input.validity, last: uids.length ? uids[uids.length - 1] : fresh.last },
  };
}

// ── Mensajes ─────────────────────────────────────────────────────────────────

export function imapMessageId(validity: string, uid: number): string {
  return `${validity}:${uid}`;
}

export function parseImapMessageId(id: string): { validity: string; uid: number } | null {
  const match = /^(\d+):(\d+)$/.exec(id);
  return match ? { validity: match[1], uid: Number(match[2]) } : null;
}

function qBytes(data: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < data.length; i++) {
    const c = data[i];
    if (c === "_") out.push(0x20);
    else if (c === "=" && /^[0-9a-f]{2}$/i.test(data.slice(i + 1, i + 3))) {
      out.push(parseInt(data.slice(i + 1, i + 3), 16));
      i += 2;
    } else out.push(c.charCodeAt(0) & 0xff);
  }
  return Uint8Array.from(out);
}

const ENCODED_WORD = /=\?([^?\s*]+)(?:\*[^?\s]*)?\?([bBqQ])\?([^?\s]*)\?=/g;

/** Decodifica «=?UTF-8?B?…?=» y «=?ISO-8859-1?Q?…?=» (asuntos y nombres de archivo). */
export function decodeMimeWords(text: string): string {
  if (!text.includes("=?")) return text;
  return text
    .replace(/(\?=)\s+(?==\?)/g, "$1")
    .replace(ENCODED_WORD, (whole, charset: string, encoding: string, data: string) => {
      try {
        const bytes = encoding.toUpperCase() === "B" ? Uint8Array.from(Buffer.from(data, "base64")) : qBytes(data);
        return new TextDecoder(charset.toLowerCase()).decode(bytes);
      } catch {
        return whole;
      }
    });
}

/** Nodo de la estructura MIME (BODYSTRUCTURE) como la entrega imapflow. */
export type BodyNode = {
  part?: string;
  type?: string;
  parameters?: Record<string, string>;
  encoding?: string;
  size?: number;
  disposition?: string;
  dispositionParameters?: Record<string, string>;
  childNodes?: BodyNode[];
};

const MAX_ATTACHMENTS = 20;

function param(map: Record<string, string> | undefined, key: string): string | null {
  if (!map) return null;
  const found = Object.entries(map).find(([k]) => k.toLowerCase() === key);
  return found?.[1] ?? null;
}

/**
 * Adjuntos de un correo según su estructura: archivos con nombre, partes marcadas como adjunto e invitaciones
 * de calendario (text/calendar). El cuerpo (texto y HTML sin nombre) y los logos en línea no cuentan.
 */
export function attachmentsFromStructure(root: BodyNode | undefined | null): MailAttachmentMeta[] {
  const found: MailAttachmentMeta[] = [];
  const visit = (node: BodyNode, isRoot: boolean) => {
    if (found.length >= MAX_ATTACHMENTS) return;
    const type = (node.type ?? "application/octet-stream").toLowerCase();
    if (type.startsWith("multipart/")) {
      for (const child of node.childNodes ?? []) visit(child, false);
      return;
    }
    const disposition = (node.disposition ?? "").toLowerCase();
    const rawName = param(node.dispositionParameters, "filename") ?? param(node.parameters, "name");
    const fileName = rawName ? decodeMimeWords(rawName).trim() : null;
    const calendar = type === "text/calendar";
    const inlineImage = disposition === "inline" && type.startsWith("image/");
    const body = !fileName && disposition !== "attachment" && (type === "text/plain" || type === "text/html");
    if (body || inlineImage || (!fileName && disposition !== "attachment" && !calendar)) return;
    const encodedSize = Math.max(0, Math.round(node.size ?? 0));
    const size = (node.encoding ?? "").toLowerCase() === "base64" ? Math.floor((encodedSize * 3) / 4) : encodedSize;
    found.push({
      id: node.part ?? (isRoot ? "1" : ""),
      fileName: (fileName || (calendar ? "invitacion.ics" : type === "message/rfc822" ? "correo-adjunto.eml" : "adjunto")).slice(0, 200),
      mimeType: type,
      size,
    });
  };
  if (root) visit(root, true);
  return found.filter((a) => a.id !== "");
}

type EnvelopeAddress = { name?: string | null; address?: string | null };

export function firstAddress(list: EnvelopeAddress[] | undefined | null): { name: string | null; email: string } {
  const first = list?.find((a) => a.address);
  return { name: first?.name ? decodeMimeWords(first.name).trim() || null : null, email: (first?.address ?? "").toLowerCase() };
}

export function addressList(list: EnvelopeAddress[] | undefined | null): string[] {
  return (list ?? []).map((a) => (a.address ?? "").toLowerCase()).filter((a) => EMAIL_PATTERN.test(a)).slice(0, 20);
}

/** Hilo: el primer Message-ID de References (la raíz), o al que responde, o el propio. */
export function threadRoot(references: string | string[] | undefined | null, inReplyTo: string | undefined | null, messageId: string | undefined | null): string | null {
  const list = Array.isArray(references) ? references : references ? references.split(/\s+/) : [];
  const root = list.find((r) => r.trim()) ?? inReplyTo ?? messageId ?? null;
  return root ? root.trim().slice(0, 300) : null;
}

// ── Errores ──────────────────────────────────────────────────────────────────

export type MailFailure = "auth" | "tls" | "network" | "unknown";

const TLS_CODES = /CERT|SELF_SIGNED|UNABLE_TO_VERIFY|ERR_TLS|ERR_SSL|EPROTO/i;
const NETWORK_CODES = /^(ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|EHOSTUNREACH|ENETUNREACH|ETIMEDOUT|ETIMEOUT|ESOCKET|ECONNECTION|EPIPE|NoConnection|CONNECT_TIMEOUT|GREETING_TIMEOUT|UPGRADE_TIMEOUT)$/i;

export function classifyMailError(error: unknown): MailFailure {
  const e = (error ?? {}) as {
    code?: unknown;
    authenticationFailed?: unknown;
    serverResponseCode?: unknown;
    responseCode?: unknown;
    responseText?: unknown;
    response?: unknown;
    message?: unknown;
  };
  const code = typeof e.code === "string" ? e.code : "";
  const text = [e.responseText, e.response, e.message].filter((t) => typeof t === "string").join(" ");
  if (
    e.authenticationFailed === true ||
    e.serverResponseCode === "AUTHENTICATIONFAILED" ||
    code === "EAUTH" ||
    e.responseCode === 535 ||
    /AUTHENTICATIONFAILED|authentication failed|invalid credentials|login failed|username and password not accepted|application-specific password/i.test(text)
  ) {
    return "auth";
  }
  if (TLS_CODES.test(code) || /certificate|self[- ]signed|tls|ssl/i.test(code)) return "tls";
  if (NETWORK_CODES.test(code) || /timed? ?out|timeout|ECONNREFUSED|ENOTFOUND|socket hang up|connection closed/i.test(text)) return "network";
  return "unknown";
}

export function mailErrorMessage(kind: MailFailure, phase: "imap" | "smtp", service: MailServiceId): string {
  const preset = mailService(service);
  const name = preset?.name ?? "Tu servidor de correo";
  if (kind === "auth") {
    if (service === "gmail") {
      return "Gmail rechazó la contraseña. Usa una contraseña de aplicación (16 letras), no tu contraseña normal; para crearla necesitas la verificación en dos pasos.";
    }
    if (preset) return `${name} rechazó el correo o la contraseña. Usa una contraseña de aplicación, no tu contraseña normal.`;
    return phase === "smtp"
      ? "El servidor SMTP rechazó el usuario o la contraseña. Revisa los datos de envío."
      : "El servidor rechazó el correo o la contraseña. Revisa los datos e inténtalo de nuevo.";
  }
  if (kind === "tls") return `${name} no presentó un certificado de seguridad válido. Revisa el nombre del servidor ${phase === "imap" ? "IMAP" : "SMTP"}.`;
  if (kind === "network") {
    return preset
      ? `No pudimos conectar con ${name}. Inténtalo de nuevo en un momento.`
      : `No pudimos conectar con el servidor ${phase === "imap" ? "IMAP" : "SMTP"}. Revisa el nombre y el puerto.`;
  }
  return `${name} no respondió como esperábamos. Inténtalo de nuevo en un momento.`;
}
