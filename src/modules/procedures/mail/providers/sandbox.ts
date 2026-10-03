import "server-only";
import { randomUUID } from "node:crypto";
import { signPayload, verifyPayload } from "@/lib/crypto";
import { AppError, Errors } from "@/lib/errors";
import { startOfLocalDay } from "../../time/tz";
import { sandboxAttachmentBytes } from "./sandbox-files";
import { sandboxInbox, sandboxWeeklyBusy, type SandboxContext } from "./sandbox-inbox";
import type { MailFlavor, MailProvider } from "./types";

// Bandeja y calendario de prueba con el contrato de Gmail/Outlook. El access token va firmado (HMAC) y no
// guarda estado: dice de quién es la bandeja, su dirección, su zona horaria y el día en que se conectó.

type AccessPayload = { t: "mail_access"; uid: string; flavor: MailFlavor; addr: string; tz: string; anchor: string; name: string | null };
type Cursor = { through: string | null };

function readAccess(token: string): { payload: AccessPayload; ctx: SandboxContext } {
  const payload = verifyPayload<AccessPayload>(token);
  if (!payload || payload.t !== "mail_access") {
    throw new AppError(401, "invalid_access_token", "El acceso a esta bandeja ya no es válido. Vuelve a conectarla.");
  }
  return {
    payload,
    ctx: { anchor: new Date(payload.anchor), timeZone: payload.tz, address: payload.addr, userFirstName: payload.name },
  };
}

function slug(text: string): string {
  return (
    text
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, ".")
      .replace(/^\.|\.$/g, "")
      .slice(0, 20) || "tu.correo"
  );
}

export const sandboxMailProvider: MailProvider = {
  name: "sandbox",

  async connect({ userId, flavor, firstName, timeZone }) {
    const addr = `${slug(firstName ?? "tu correo")}.demo@${flavor === "outlook" ? "outlook-demo.test" : "correo-demo.test"}`;
    const anchor = startOfLocalDay(new Date(), timeZone).toISOString();
    const accessToken = signPayload({ t: "mail_access", uid: userId, flavor, addr, tz: timeZone, anchor, name: firstName });
    return {
      accessToken,
      account: {
        address: addr,
        displayName: flavor === "outlook" ? "Correo de prueba (estilo Outlook)" : "Correo de prueba (estilo Gmail)",
        flavor,
      },
    };
  },

  async syncMessages(accessToken, rawCursor) {
    const { ctx } = readAccess(accessToken);
    let cursor: Cursor = { through: null };
    if (rawCursor) {
      try {
        cursor = JSON.parse(Buffer.from(rawCursor, "base64url").toString("utf8")) as Cursor;
      } catch {
        cursor = { through: null };
      }
    }
    const now = new Date();
    const through = cursor.through ? new Date(cursor.through) : null;
    const messages = sandboxInbox(ctx)
      .filter((m) => m.receivedAt <= now && (!through || m.receivedAt > through))
      .map((m) => ({
        id: m.id,
        threadId: m.threadId,
        from: m.from,
        to: m.to,
        subject: m.subject,
        bodyText: m.bodyText,
        receivedAt: m.receivedAt,
        labels: m.labels,
        attachments: m.attachments.map(({ id, fileName, mimeType, size }) => ({ id, fileName, mimeType, size })),
      }));
    return {
      messages,
      deleted: [],
      hasMore: false,
      nextCursor: Buffer.from(JSON.stringify({ through: now.toISOString() })).toString("base64url"),
    };
  },

  async getAttachment(accessToken, messageId, attachmentId) {
    const { ctx } = readAccess(accessToken);
    const message = sandboxInbox(ctx).find((m) => m.id === messageId);
    const attachment = message?.attachments.find((a) => a.id === attachmentId);
    if (!attachment) throw Errors.notFound("El adjunto");
    return { bytes: await sandboxAttachmentBytes(attachment.kind, ctx), mimeType: attachment.mimeType, fileName: attachment.fileName };
  },

  async sendMessage(accessToken, mail) {
    readAccess(accessToken);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail.to)) throw Errors.badRequest("La dirección del destinatario no es válida.");
    // En el sandbox el correo no sale a internet: queda en "Enviados" de OmniAgent.
    return { id: `sbx_sent_${randomUUID()}`, sentAt: new Date() };
  },

  async listCalendarEvents(accessToken, from, to) {
    const { ctx } = readAccess(accessToken);
    return sandboxWeeklyBusy(from, to, ctx.timeZone);
  },

  async createCalendarEvent(accessToken) {
    readAccess(accessToken);
    return { id: `sbx_evt_${randomUUID()}` };
  },

  async deleteCalendarEvent(accessToken) {
    readAccess(accessToken);
  },
};
