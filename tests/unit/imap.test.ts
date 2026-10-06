import { describe, expect, it } from "vitest";
import { detectMailService, mailService, normalizeAppPassword } from "@/modules/procedures/mail/providers/imap-presets";
import {
  FIRST_SYNC_MAX,
  PAGE_SIZE,
  attachmentsFromStructure,
  classifyMailError,
  decodeCredentials,
  decodeImapCursor,
  decodeMimeWords,
  encodeCredentials,
  encodeImapCursor,
  mailErrorMessage,
  mailServerProblem,
  normalizeMailHost,
  parseImapMessageId,
  pickPublicAddress,
  planImapFetch,
  threadRoot,
  type BodyNode,
} from "@/modules/procedures/mail/providers/imap-rules";

describe("correo real: proveedores", () => {
  it("reconoce el proveedor por el dominio", () => {
    expect(detectMailService("laura@gmail.com")).toBe("gmail");
    expect(detectMailService("LAURA@GoogleMail.com")).toBe("gmail");
    expect(detectMailService("ana@yahoo.com.mx")).toBe("yahoo");
    expect(detectMailService("ana@ymail.com")).toBe("yahoo");
    expect(detectMailService("pepe@icloud.com")).toBe("icloud");
    expect(detectMailService("pepe@me.com")).toBe("icloud");
    expect(detectMailService("x@aol.com")).toBe("aol");
    expect(detectMailService("x@zohomail.com")).toBe("zoho");
    expect(detectMailService("x@hotmail.com")).toBe("microsoft");
    expect(detectMailService("x@outlook.es")).toBe("microsoft");
    expect(detectMailService("x@miempresa.com")).toBeNull();
    expect(detectMailService("sin-arroba")).toBeNull();
  });

  it("Gmail usa los servidores oficiales con TLS", () => {
    expect(mailService("gmail")).toMatchObject({ imap: { host: "imap.gmail.com", port: 993 }, smtp: { host: "smtp.gmail.com", port: 465 } });
    expect(mailService("custom")).toBeNull();
  });

  it("la contraseña de aplicación se pega sin espacios; la de un servidor propio va tal cual", () => {
    expect(normalizeAppPassword("gmail", "abcd efgh ijkl mnop")).toBe("abcdefghijklmnop");
    expect(normalizeAppPassword("icloud", " abcd-efgh-ijkl-mnop ")).toBe("abcd-efgh-ijkl-mnop");
    expect(normalizeAppPassword("custom", "mi clave segura")).toBe("mi clave segura");
  });
});

describe("correo real: servidores permitidos", () => {
  it("solo nombres públicos, nunca IP ni redes internas", () => {
    expect(normalizeMailHost(" IMAP.MiEmpresa.com. ")).toBe("imap.miempresa.com");
    expect(normalizeMailHost("127.0.0.1")).toBeNull();
    expect(normalizeMailHost("[::1]")).toBeNull();
    expect(normalizeMailHost("localhost")).toBeNull();
    expect(normalizeMailHost("mail.local")).toBeNull();
    expect(normalizeMailHost("metadata.google.internal")).toBeNull();
    expect(normalizeMailHost("imap")).toBeNull();
    expect(normalizeMailHost("imap.mi_empresa.com")).toBeNull();
  });

  it("puertos de correo con TLS", () => {
    expect(mailServerProblem({ host: "imap.miempresa.com", port: 993 }, "imap")).toBeNull();
    expect(mailServerProblem({ host: "smtp.miempresa.com", port: 587 }, "smtp")).toBeNull();
    expect(mailServerProblem({ host: "imap.miempresa.com", port: 25 }, "imap")).toMatch(/993 o 143/);
    expect(mailServerProblem({ host: "smtp.miempresa.com", port: 25 }, "smtp")).toMatch(/465 o 587/);
    expect(mailServerProblem({ host: "10.0.0.5", port: 993 }, "imap")).toMatch(/no es válido/);
  });

  it("del DNS se usa una IP pública, IPv4 primero", () => {
    expect(pickPublicAddress([{ address: "2607:f8b0:4003:c00::6c", family: 6 }, { address: "142.250.115.108", family: 4 }])).toBe("142.250.115.108");
    expect(pickPublicAddress([{ address: "10.1.2.3", family: 4 }, { address: "2607:f8b0:4003:c00::6c", family: 6 }])).toBe("2607:f8b0:4003:c00::6c");
    expect(pickPublicAddress([{ address: "169.254.169.254", family: 4 }, { address: "::1", family: 6 }])).toBeNull();
  });
});

describe("correo real: credenciales y cursor", () => {
  it("las credenciales van y vuelven; si no se pueden leer, la bandeja vence (401)", () => {
    const credentials = {
      v: 1 as const,
      service: "gmail" as const,
      user: "laura@gmail.com",
      pass: "abcdefghijklmnop",
      name: "Laura",
      imap: { host: "imap.gmail.com", port: 993 },
      smtp: { host: "smtp.gmail.com", port: 465 },
    };
    expect(decodeCredentials(encodeCredentials(credentials))).toEqual(credentials);
    expect(() => decodeCredentials("no-es-json")).toThrow(expect.objectContaining({ status: 401 }));
    expect(() => decodeCredentials(JSON.stringify({ v: 1, user: "x" }))).toThrow(expect.objectContaining({ status: 401 }));
  });

  it("el cursor guarda UIDVALIDITY y el último UID", () => {
    const cursor = { v: "1700000000", last: 4521 };
    expect(decodeImapCursor(encodeImapCursor(cursor))).toEqual(cursor);
    expect(decodeImapCursor(null)).toBeNull();
    expect(decodeImapCursor("basura")).toBeNull();
    expect(parseImapMessageId("1700000000:4521")).toEqual({ validity: "1700000000", uid: 4521 });
    expect(parseImapMessageId("sbx_123")).toBeNull();
  });

  it("primera revisión: solo los más recientes y el cursor queda al final de la bandeja", () => {
    const found = Array.from({ length: 50 }, (_, i) => 100 + i);
    const plan = planImapFetch({ cursor: null, validity: "7", uidNext: 160, found });
    expect(plan.uids).toHaveLength(FIRST_SYNC_MAX);
    expect(plan.uids[plan.uids.length - 1]).toBe(149);
    expect(plan.hasMore).toBe(false);
    expect(plan.cursor).toEqual({ v: "7", last: 159 });
  });

  it("después: los nuevos en orden, de a una página, ignorando el último que IMAP siempre devuelve", () => {
    const pending = Array.from({ length: 30 }, (_, i) => 201 + i);
    const plan = planImapFetch({ cursor: { v: "7", last: 200 }, validity: "7", uidNext: 231, found: [200, ...pending] });
    expect(plan.uids).toEqual(pending.slice(0, PAGE_SIZE));
    expect(plan.hasMore).toBe(true);
    expect(plan.cursor).toEqual({ v: "7", last: 200 + PAGE_SIZE });

    const none = planImapFetch({ cursor: { v: "7", last: 200 }, validity: "7", uidNext: 201, found: [200] });
    expect(none).toEqual({ uids: [], hasMore: false, cursor: { v: "7", last: 200 } });
  });

  it("si cambió UIDVALIDITY, se vuelve a empezar", () => {
    const plan = planImapFetch({ cursor: { v: "7", last: 200 }, validity: "8", uidNext: 12, found: [3, 5, 11] });
    expect(plan.uids).toEqual([3, 5, 11]);
    expect(plan.cursor).toEqual({ v: "8", last: 11 });
  });
});

describe("correo real: mensajes", () => {
  it("decodifica asuntos y nombres de archivo MIME", () => {
    expect(decodeMimeWords("=?UTF-8?B?UGVybWlzbyBkZSBzYWxpZGE=?=")).toBe("Permiso de salida");
    expect(decodeMimeWords("=?ISO-8859-1?Q?Excursi=F3n_al_museo?=")).toBe("Excursión al museo");
    expect(decodeMimeWords("=?UTF-8?Q?Cita_m=C3=A9dica?= =?UTF-8?Q?_ma=C3=B1ana?=")).toBe("Cita médica mañana");
    expect(decodeMimeWords("Texto normal")).toBe("Texto normal");
  });

  it("adjuntos: archivos e invitaciones, no el cuerpo ni los logos en línea", () => {
    const structure: BodyNode = {
      type: "multipart/mixed",
      childNodes: [
        {
          part: "1",
          type: "multipart/alternative",
          childNodes: [
            { part: "1.1", type: "text/plain", parameters: { charset: "utf-8" }, size: 300 },
            { part: "1.2", type: "text/html", parameters: { charset: "utf-8" }, size: 900 },
            { part: "1.3", type: "text/calendar", parameters: { method: "REQUEST" }, size: 1200 },
          ],
        },
        { part: "2", type: "image/png", disposition: "inline", dispositionParameters: { filename: "logo.png" }, encoding: "base64", size: 4000 },
        {
          part: "3",
          type: "application/pdf",
          disposition: "attachment",
          dispositionParameters: { filename: "=?UTF-8?Q?Autorizaci=C3=B3n.pdf?=" },
          encoding: "base64",
          size: 40000,
        },
      ],
    };
    expect(attachmentsFromStructure(structure)).toEqual([
      { id: "1.3", fileName: "invitacion.ics", mimeType: "text/calendar", size: 1200 },
      { id: "3", fileName: "Autorización.pdf", mimeType: "application/pdf", size: 30000 },
    ]);
    expect(attachmentsFromStructure({ type: "text/plain", size: 100 })).toEqual([]);
    expect(attachmentsFromStructure(undefined)).toEqual([]);
  });

  it("el hilo es la raíz de References", () => {
    expect(threadRoot(["<a@x>", "<b@x>"], "<b@x>", "<c@x>")).toBe("<a@x>");
    expect(threadRoot("<a@x> <b@x>", null, "<c@x>")).toBe("<a@x>");
    expect(threadRoot(undefined, "<b@x>", "<c@x>")).toBe("<b@x>");
    expect(threadRoot(undefined, undefined, "<c@x>")).toBe("<c@x>");
  });
});

describe("correo real: errores", () => {
  it("contraseña rechazada, red y certificado", () => {
    expect(classifyMailError({ authenticationFailed: true })).toBe("auth");
    expect(classifyMailError({ code: "EAUTH", responseCode: 535 })).toBe("auth");
    expect(classifyMailError({ responseText: "[AUTHENTICATIONFAILED] Invalid credentials (Failure)" })).toBe("auth");
    expect(classifyMailError({ code: "ECONNREFUSED" })).toBe("network");
    expect(classifyMailError({ code: "ETIMEDOUT" })).toBe("network");
    expect(classifyMailError({ code: "ERR_TLS_CERT_ALTNAME_INVALID" })).toBe("tls");
    expect(classifyMailError(new Error("algo raro"))).toBe("unknown");
  });

  it("mensajes claros según el proveedor", () => {
    expect(mailErrorMessage("auth", "imap", "gmail")).toMatch(/contraseña de aplicación/);
    expect(mailErrorMessage("auth", "imap", "yahoo")).toMatch(/^Yahoo rechazó/);
    expect(mailErrorMessage("network", "smtp", "custom")).toMatch(/SMTP/);
  });
});
