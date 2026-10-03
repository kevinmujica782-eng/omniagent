// Adjuntos de la bandeja de prueba, generados al descargarlos:
// - Permiso escolar: PDF rellenable (AcroForm) con nombres de campo poco claros (Text1, Text2...), como muchos reales.
// - Reembolso: PDF plano (sin campos), con líneas "____" para escribir encima.
// - Invitación de la cita: archivo .ics.
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { longDate } from "../../time/es-dates";
import { localParts } from "../../time/tz";
import { sandboxInviteIcs, scenarioFacts, type SandboxAttachmentKind, type SandboxContext } from "./sandbox-inbox";

const INK = rgb(0.075, 0.125, 0.105);
const MUTED = rgb(0.36, 0.42, 0.39);
const ACCENT = rgb(0.118, 0.357, 0.278);
const LINE = rgb(0.76, 0.8, 0.78);

interface Fonts {
  regular: PDFFont;
  bold: PDFFont;
}

async function newDocument(title: string, subject: string) {
  const doc = await PDFDocument.create();
  doc.setTitle(title);
  doc.setSubject(subject);
  doc.setProducer("OmniAgent (bandeja de prueba)");
  doc.setCreator("OmniAgent");
  const fixed = new Date(Date.UTC(2026, 0, 1));
  doc.setCreationDate(fixed);
  doc.setModificationDate(fixed);
  const page = doc.addPage([612, 792]);
  const fonts: Fonts = {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
  };
  return { doc, page, fonts };
}

function header(page: PDFPage, fonts: Fonts, org: string, title: string) {
  page.drawText(org, { x: 54, y: 736, size: 17, font: fonts.bold, color: ACCENT });
  page.drawText(title, { x: 54, y: 714, size: 12.5, font: fonts.regular, color: INK });
  page.drawLine({ start: { x: 54, y: 702 }, end: { x: 558, y: 702 }, thickness: 1.2, color: ACCENT });
}

function sectionTitle(page: PDFPage, fonts: Fonts, text: string, y: number) {
  page.drawText(text.toUpperCase(), { x: 54, y, size: 9.5, font: fonts.bold, color: MUTED });
}

/** Permiso escolar rellenable. */
async function permissionForm(ctx: SandboxContext): Promise<Uint8Array> {
  const f = scenarioFacts(ctx);
  const year = localParts(f.excursionDay, ctx.timeZone).year;
  const { doc, page, fonts } = await newDocument("Autorización de salida pedagógica", "Excursión al Acuario Municipal");
  header(page, fonts, "COLEGIO LOS PINOS", "Autorización de salida pedagógica · 3.º B");

  // Recuadro con los datos de la actividad
  page.drawRectangle({ x: 54, y: 596, width: 504, height: 92, color: rgb(0.953, 0.965, 0.957), borderColor: LINE, borderWidth: 0.8 });
  const info: [string, string][] = [
    ["Actividad:", "Excursión al Acuario Municipal"],
    ["Fecha:", `${longDate(f.excursionDay, ctx.timeZone)} de ${year}`],
    ["Horario:", "salida 8:00 · regreso 14:00"],
    ["Costo del transporte:", "$12"],
    ["Entregar a más tardar:", longDate(f.permissionDue, ctx.timeZone)],
  ];
  info.forEach(([label, value], i) => {
    const y = 670 - i * 16;
    page.drawText(label, { x: 66, y, size: 10, font: fonts.bold, color: INK });
    page.drawText(value, { x: 196, y, size: 10, font: fonts.regular, color: INK });
  });

  const form = doc.getForm();
  const field = (name: string, label: string, y: number, opts: { x?: number; width?: number; height?: number; multiline?: boolean } = {}) => {
    page.drawText(label, { x: 54, y: y + 5, size: 10.5, font: fonts.regular, color: INK });
    const x = opts.x ?? 54 + fonts.regular.widthOfTextAtSize(label, 10.5) + 8;
    const text = form.createTextField(name);
    if (opts.multiline) text.enableMultiline();
    text.addToPage(page, {
      x,
      y: y - (opts.height ? opts.height - 18 : 0),
      width: opts.width ?? 558 - x,
      height: opts.height ?? 18,
      borderColor: LINE,
      borderWidth: 0.8,
      textColor: INK,
    });
    text.setFontSize(10);
  };

  sectionTitle(page, fonts, "Datos del estudiante", 566);
  field("Text1", "Nombre del estudiante:", 540);
  field("Text2", "Grado y sección:", 514, { width: 140 });

  sectionTitle(page, fonts, "Datos del padre, madre o acudiente", 482);
  field("Text3", "Nombre completo:", 456);
  field("Text4", "Teléfono de contacto:", 430, { width: 200 });
  field("Text5", "Contacto de emergencia (nombre y teléfono):", 404);
  field("Text6", "Alergias o condiciones médicas:", 378);

  // Consentimiento
  const check = form.createCheckBox("Check1");
  check.addToPage(page, { x: 54, y: 330, width: 13, height: 13, borderColor: INK, borderWidth: 1 });
  page.drawText("Autorizo a mi hijo(a) a participar en la salida pedagógica descrita", { x: 76, y: 339, size: 10.5, font: fonts.regular, color: INK });
  page.drawText("y acepto el pago del transporte.", { x: 76, y: 325, size: 10.5, font: fonts.regular, color: INK });

  field("Firma_acudiente", "Firma del padre, madre o acudiente:", 282, { width: 230 });
  field("Text7", "Fecha:", 256, { width: 120 });

  page.drawLine({ start: { x: 54, y: 90 }, end: { x: 558, y: 90 }, thickness: 0.6, color: LINE });
  page.drawText("Devuelva este formulario a la docente de 3.º B: c.rivera@colegiolospinos.test", {
    x: 54,
    y: 74,
    size: 9,
    font: fonts.regular,
    color: MUTED,
  });
  return doc.save();
}

/** Formulario de reembolso plano (sin campos rellenables). */
async function reimbursementForm(ctx: SandboxContext): Promise<Uint8Array> {
  const { doc, page, fonts } = await newDocument("Solicitud de reembolso de gastos médicos", "Caso R-48213");
  header(page, fonts, "SEGUROS HORIZONTE", "Solicitud de reembolso de gastos médicos");
  const f = scenarioFacts(ctx);
  page.drawText("N.º de caso: R-48213", { x: 54, y: 680, size: 10.5, font: fonts.bold, color: INK });
  page.drawText(`Enviar antes del ${longDate(f.reimbursementDue, ctx.timeZone)} a reembolsos@seguroshorizonte.test`, {
    x: 54,
    y: 664,
    size: 9.5,
    font: fonts.regular,
    color: MUTED,
  });

  const line = (text: string, x: number, y: number) => page.drawText(text, { x, y, size: 10.5, font: fonts.regular, color: INK });
  sectionTitle(page, fonts, "Datos del asegurado", 628);
  line("Nombre del asegurado titular: ______________________________________", 54, 604);
  line("N.º de póliza: ______________________", 54, 580);
  line("Correo electrónico: __________________________________", 54, 556);
  line("Teléfono: ______________________", 54, 532);

  sectionTitle(page, fonts, "Datos de la atención", 496);
  line("Nombre del paciente: ______________________________________", 54, 472);
  line("Fecha de la atención: ______________", 54, 448);
  line("Monto solicitado (USD): ____________", 330, 448);
  line("Médico o centro de salud: __________________________________", 54, 424);

  sectionTitle(page, fonts, "Depósito del reembolso", 388);
  line("Banco y número de cuenta: __________________________________", 54, 364);

  line("[   ] Declaro que la información de esta solicitud es verdadera.", 54, 320);
  line("Firma del asegurado: ______________________", 54, 272);
  line("Fecha: ______________", 360, 272);

  page.drawText("Adjunte la factura de la atención. Las solicitudes incompletas no se procesan.", {
    x: 54,
    y: 74,
    size: 9,
    font: fonts.regular,
    color: MUTED,
  });
  return doc.save();
}

export async function sandboxAttachmentBytes(kind: SandboxAttachmentKind, ctx: SandboxContext): Promise<Uint8Array> {
  switch (kind) {
    case "permission_form":
      return permissionForm(ctx);
    case "reimbursement_form":
      return reimbursementForm(ctx);
    case "ics_invite":
      return new TextEncoder().encode(sandboxInviteIcs(ctx));
  }
}
