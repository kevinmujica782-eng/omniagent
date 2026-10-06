import { createTransport } from "nodemailer";
import { beforeAll, describe, expect, it } from "vitest";
import { imapMailProvider } from "@/modules/procedures/mail/providers/imap";
import { encodeCredentials, type ImapCredentials } from "@/modules/procedures/mail/providers/imap-rules";

// El proveedor de correo real contra un servidor IMAP/SMTP de verdad (GreenMail en CI, sin verificar contraseñas):
// conectar, leer la bandeja, bajar adjuntos, sincronizar solo lo nuevo y responder en el mismo hilo.
// Requiere MAIL_TEST_INSECURE_LOCAL=1 (servidor local con certificado propio).

const PASSWORD = "secreto";

function credentials(user: string, pass = PASSWORD): ImapCredentials {
  return {
    v: 1,
    service: "custom",
    user,
    pass,
    name: user.startsWith("laura") ? "Laura Prueba" : null,
    imap: { host: "localhost", port: 993 },
    smtp: { host: "localhost", port: 465 },
  };
}

const pdf = Buffer.concat([Buffer.from("%PDF-1.4\n% autorización de prueba\n"), Buffer.alloc(6000, 7), Buffer.from("\n%%EOF\n")]);

const ics = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "PRODID:-//OmniAgent//Prueba//ES",
  "METHOD:REQUEST",
  "BEGIN:VEVENT",
  "UID:cita-123@omni.test",
  "DTSTAMP:20261001T120000Z",
  "DTSTART:20261020T150000Z",
  "DTEND:20261020T153000Z",
  "SUMMARY:Cita de control",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

const seed = createTransport({ host: "127.0.0.1", port: 3025, secure: false, ignoreTLS: true });

describe("correo real por IMAP/SMTP", () => {
  const laura = credentials("laura@omni.test");
  const token = encodeCredentials(laura);

  beforeAll(async () => {
    await seed.sendMail({
      from: "Colegio Andes <colegio@omni.test>",
      to: "laura@omni.test",
      subject: "Excursión al museo",
      text: "Necesitamos la autorización firmada antes del viernes.",
      attachments: [{ filename: "Autorización.pdf", content: pdf, contentType: "application/pdf" }],
    });
    await seed.sendMail({
      from: "Clínica Sol <citas@omni.test>",
      to: "laura@omni.test",
      subject: "Tu cita del martes",
      text: "Te esperamos el martes a las 10.",
      icalEvent: { method: "request", content: ics },
    });
    await seed.sendMail({
      from: "tienda@omni.test",
      to: "laura@omni.test",
      subject: "Ofertas de la semana",
      html: "<p>Hola <b>Laura</b>, estas son las ofertas.</p>",
    });
  });

  it("conecta (entra a IMAP y a SMTP) y devuelve la cuenta", async () => {
    const ok = await imapMailProvider.connect({ userId: "u1", flavor: "gmail", firstName: "Laura", timeZone: "UTC", credentials: laura });
    expect(ok.account.address).toBe("laura@omni.test");
    expect(JSON.parse(ok.accessToken)).toMatchObject({ user: "laura@omni.test", imap: { port: 993 }, smtp: { port: 465 } });
  });

  it("un servidor que no responde da un error claro", async () => {
    const closed = { ...laura, imap: { host: "localhost", port: 143 } };
    await expect(
      imapMailProvider.connect({ userId: "u1", flavor: "gmail", firstName: "Laura", timeZone: "UTC", credentials: closed }),
    ).rejects.toMatchObject({ status: 502, code: "mail_unreachable" });
  });

  it("lee la bandeja, baja el adjunto y luego trae solo lo nuevo", async () => {
    const first = await imapMailProvider.syncMessages(token, null);
    expect(first.messages).toHaveLength(3);
    expect(first.hasMore).toBe(false);

    const school = first.messages.find((m) => m.subject === "Excursión al museo");
    expect(school).toBeDefined();
    expect(school!.from).toEqual({ name: "Colegio Andes", email: "colegio@omni.test" });
    expect(school!.to).toEqual(["laura@omni.test"]);
    expect(school!.bodyText).toContain("autorización firmada");
    const attachment = school!.attachments.find((a) => a.mimeType === "application/pdf");
    expect(attachment).toMatchObject({ fileName: "Autorización.pdf" });

    const file = await imapMailProvider.getAttachment(token, school!.id, attachment!.id);
    expect(Buffer.from(file.bytes).equals(pdf)).toBe(true);
    expect(file.mimeType).toBe("application/pdf");

    const clinic = first.messages.find((m) => m.subject === "Tu cita del martes");
    const invite = clinic!.attachments.find((a) => a.mimeType === "text/calendar");
    expect(invite).toBeDefined();
    const inviteFile = await imapMailProvider.getAttachment(token, clinic!.id, invite!.id);
    expect(Buffer.from(inviteFile.bytes).toString("utf8")).toContain("SUMMARY:Cita de control");

    const promo = first.messages.find((m) => m.subject === "Ofertas de la semana");
    expect(promo!.bodyText).toContain("estas son las ofertas");

    // Nada nuevo: misma posición.
    const idle = await imapMailProvider.syncMessages(token, first.nextCursor);
    expect(idle.messages).toHaveLength(0);

    await seed.sendMail({ from: "colegio@omni.test", to: "laura@omni.test", subject: "Recordatorio", text: "Mañana es la excursión." });
    const second = await imapMailProvider.syncMessages(token, idle.nextCursor);
    expect(second.messages.map((m) => m.subject)).toEqual(["Recordatorio"]);
  });

  it("envía por SMTP y la respuesta queda en el mismo hilo", async () => {
    const inbox = await imapMailProvider.syncMessages(token, null);
    const original = inbox.messages.find((m) => m.subject === "Excursión al museo")!;
    const sent = await imapMailProvider.sendMessage(token, {
      to: "tienda@omni.test",
      subject: "Re: Excursión al museo",
      body: "Adjunto la autorización firmada.",
      inReplyTo: original.id,
      attachments: [{ fileName: "Autorización firmada.pdf", mimeType: "application/pdf", bytes: new Uint8Array(pdf) }],
    });
    expect(sent.id).toMatch(/^smtp:/);

    const store = await imapMailProvider.syncMessages(encodeCredentials(credentials("tienda@omni.test")), null);
    const reply = store.messages.find((m) => m.subject === "Re: Excursión al museo");
    expect(reply).toBeDefined();
    expect(reply!.from).toEqual({ name: "Laura Prueba", email: "laura@omni.test" });
    expect(reply!.threadId).toBe(original.threadId);
    expect(reply!.attachments.map((a) => a.fileName)).toContain("Autorización firmada.pdf");
  });
});
