// Clasificación de correos con reglas: categoría, fechas, montos y el trámite que sugiere.
// Es el respaldo sin IA y la base que Claude mejora. Pura y determinista.
import { money } from "@/lib/format";
import type { ParsedIcsEvent } from "../../calendar/ics";
import {
  clockTime,
  findAmounts,
  findDateMentions,
  findLocation,
  findReference,
  longDate,
  pickDates,
} from "../../time/es-dates";
import { atLocalTime } from "../../time/tz";

export type MailCategoryId = "FORM" | "APPOINTMENT" | "REIMBURSEMENT" | "BILL" | "DEADLINE" | "EVENT" | "INFO" | "PROMO";
export type TaskTypeId = "FORM_FILL" | "EMAIL" | "APPOINTMENT" | "REMINDER" | "DOCUMENT" | "OTHER";

export const ACTIONABLE: MailCategoryId[] = ["FORM", "APPOINTMENT", "REIMBURSEMENT", "BILL", "DEADLINE", "EVENT"];

export interface TriageInput {
  subject: string;
  fromName: string | null;
  fromEmail: string;
  bodyText: string;
  labels: string[];
  attachments: { fileName: string; mimeType: string }[];
  receivedAt: Date;
  /** Eventos leídos de invitaciones .ics adjuntas. */
  ics: ParsedIcsEvent[];
}

export interface TriageResult {
  source: "AI" | "RULES";
  category: MailCategoryId;
  importance: 0 | 1 | 2;
  actionRequired: boolean;
  summary: string;
  dueAt: Date | null;
  dueHasTime: boolean;
  eventStartsAt: Date | null;
  eventEndsAt: Date | null;
  eventAllDay: boolean;
  eventLocation: string | null;
  eventTitle: string | null;
  amount: number | null;
  currency: string;
  reference: string | null;
  taskTitle: string | null;
  taskType: TaskTypeId | null;
  /** A quién responder (formularios que se devuelven por correo, confirmaciones). */
  replyTo: string | null;
  hasForm: boolean;
}

const PROMO_SUBJECT = /(oferta|descuento|promoci[oó]n|cup[oó]n|rebaja|liquidaci[oó]n|black friday|cyber|\b\d{1,2}\s?%)/i;
const PROMO_BODY = /(cancela tu suscripci[oó]n|dejar de recibir|darte de baja de (estos|nuestros) correos|unsubscribe|hasta agotar existencias)/i;
const REPLY_CUES = /(respondiendo a este correo|responde a este correo|responder a este correo|confirmen? (su|tu) (autorizaci[oó]n|asistencia)|conf[ií]rmanos)/i;

function isPdf(a: { fileName: string; mimeType: string }): boolean {
  return a.mimeType === "application/pdf" || /\.pdf$/i.test(a.fileName);
}

function endOfLocalDay(date: Date, timeZone: string): Date {
  return atLocalTime(date, 23, 59, timeZone);
}

function timeText(date: Date, timeZone: string): string {
  return clockTime(date, timeZone);
}

function cleanSubject(subject: string): string {
  return subject
    .replace(/^(re|rv|fw|fwd)\s*:\s*/i, "")
    .replace(/\s*[:—–-]\s*(falta|pendiente|urgente|recordatorio|confirma|responde).*$/i, "")
    .trim();
}

function taskTitleFor(category: MailCategoryId, input: TriageInput, facts: { amount: number | null; reference: string | null; eventTitle: string | null }): string | null {
  const subject = cleanSubject(input.subject);
  const text = `${input.subject}\n${input.bodyText}`.toLowerCase();
  const sender = input.fromName ?? input.fromEmail;
  switch (category) {
    case "FORM": {
      const permiso = /permiso para (?:la|el) (.+)/i.exec(subject);
      if (permiso) return `Llenar y devolver el permiso: ${permiso[1]}`;
      return `Llenar y devolver: ${subject}`;
    }
    case "REIMBURSEMENT":
      return `Enviar el formulario de reembolso${facts.reference ? ` (${facts.reference})` : ""}`;
    case "APPOINTMENT":
      return facts.eventTitle ?? `Cita: ${subject.replace(/^confirmaci[oó]n de (tu|la) cita:?\s*/i, "")}`;
    case "BILL":
      return `Pagar la factura de ${sender}${facts.amount ? ` (${money(facts.amount, "USD", { cents: true })})` : ""}`;
    case "DEADLINE":
      if (/pasaporte/.test(text)) return "Agendar la renovación del pasaporte";
      if (/licencia/.test(text)) return "Renovar la licencia";
      if (/libro/.test(text)) return "Devolver los libros a la biblioteca";
      if (REPLY_CUES.test(text) && /autoriza/.test(text)) return `Confirmar la autorización: ${subject}`;
      return `Atender: ${subject}`;
    case "EVENT":
      return subject;
    default:
      return null;
  }
}

function taskTypeFor(category: MailCategoryId, hasForm: boolean, replyTo: string | null): TaskTypeId | null {
  switch (category) {
    case "FORM":
      return "FORM_FILL";
    case "REIMBURSEMENT":
      return hasForm ? "FORM_FILL" : "DOCUMENT";
    case "APPOINTMENT":
    case "EVENT":
      return "APPOINTMENT";
    case "BILL":
      return "REMINDER";
    case "DEADLINE":
      return replyTo ? "EMAIL" : "REMINDER";
    default:
      return null;
  }
}

export function triageWithRules(input: TriageInput, now: Date, timeZone: string): TriageResult {
  const text = `${input.subject}\n${input.bodyText}`;
  const lower = text.toLowerCase();
  const hasPdf = input.attachments.some(isPdf);
  const invite = input.ics[0] ?? null;

  const mentions = findDateMentions(text, input.receivedAt, timeZone);
  const { deadline, event } = pickDates(mentions, now, timeZone);
  const amounts = findAmounts(input.bodyText);
  const reference = findReference(text);

  const promo =
    input.labels.includes("CATEGORY_PROMOTIONS") || (PROMO_SUBJECT.test(input.subject) && !hasPdf) || PROMO_BODY.test(input.bodyText);
  const formWords = /(permiso|formulario|autorizaci[oó]n|solicitud|ll[eé]n[ao]|complet[ae]|firmad[oa])/i.test(lower);

  let category: MailCategoryId;
  if (promo) category = "PROMO";
  else if (invite || (/\b(cita|consulta|turno)\b/.test(lower) && event?.hasTime)) category = "APPOINTMENT";
  else if (/\b(reembolso|reclamo|siniestro)\b/.test(lower)) category = "REIMBURSEMENT";
  else if (hasPdf && formWords) category = "FORM";
  else if (/(factura|total a pagar|monto a pagar|recibo de)/.test(lower) && /(venc|pagar|pago)/.test(lower)) category = "BILL";
  else if (deadline) category = "DEADLINE";
  else if (event && /(reuni[oó]n|evento|invit|jornada|taller|ceremonia|excursi[oó]n)/.test(lower)) category = "EVENT";
  else if (/(vence|renovar|renovaci[oó]n|devolver|plazo|fecha l[ií]mite)/.test(lower)) category = "DEADLINE";
  else category = "INFO";

  // Fechas
  const dueHasTime = Boolean(deadline?.hasTime);
  const dueAt = deadline ? (deadline.hasTime ? deadline.date : endOfLocalDay(deadline.date, timeZone)) : null;
  let eventStartsAt: Date | null = null;
  let eventEndsAt: Date | null = null;
  let eventAllDay = false;
  if (invite) {
    eventStartsAt = invite.startsAt;
    eventEndsAt = invite.endsAt;
    eventAllDay = invite.allDay;
  } else if (event && (category === "APPOINTMENT" || category === "EVENT" || category === "FORM" || category === "DEADLINE")) {
    eventStartsAt = event.date;
    eventEndsAt = event.endDate;
    eventAllDay = !event.hasTime;
  }
  const eventLocation = invite?.location ?? (eventStartsAt ? findLocation(input.bodyText) : null);
  const eventTitle = invite?.title ?? null;

  const amount = amounts[0]?.value ?? null;
  const replyTo = (category === "FORM" || category === "REIMBURSEMENT" || REPLY_CUES.test(lower)) && ACTIONABLE.includes(category)
    ? input.fromEmail
    : null;
  const hasForm = hasPdf && (category === "FORM" || category === "REIMBURSEMENT");

  const upcoming = [dueAt, eventStartsAt].filter((d): d is Date => d !== null && d >= now);
  const actionRequired =
    ACTIONABLE.includes(category) && (upcoming.length > 0 || category === "FORM" || category === "REIMBURSEMENT");
  const soon = upcoming.some((d) => d.getTime() - now.getTime() < 7 * 86_400_000);
  const importance: 0 | 1 | 2 = !actionRequired
    ? 0
    : soon || category === "FORM" || category === "REIMBURSEMENT" || category === "APPOINTMENT" || input.labels.includes("IMPORTANT")
      ? 2
      : 1;

  const facts = { amount, reference, eventTitle };
  const dueText = dueAt ? longDate(dueAt, timeZone) : null;
  let summary: string;
  switch (category) {
    case "FORM":
      summary = `Pide llenar y devolver un formulario${dueText ? ` a más tardar el ${dueText}` : ""}.`;
      break;
    case "REIMBURSEMENT":
      summary = `Falta el formulario de tu reembolso${amount ? ` por ${money(amount, "USD", { cents: true })}` : ""}${dueText ? `; vence el ${dueText}` : ""}.`;
      break;
    case "APPOINTMENT":
      summary = eventStartsAt
        ? `Cita el ${longDate(eventStartsAt, timeZone)}${eventAllDay ? "" : ` a las ${timeText(eventStartsAt, timeZone)}`}${eventLocation ? ` en ${eventLocation}` : ""}.`
        : "Confirmación de una cita.";
      break;
    case "BILL":
      summary = `Factura${amount ? ` por ${money(amount, "USD", { cents: true })}` : ""}${dueText ? ` que vence el ${dueText}` : ""}.`;
      break;
    case "DEADLINE":
      summary = dueText ? `Fecha límite: ${dueText}.` : "Trámite con fecha límite.";
      break;
    case "EVENT":
      summary = eventStartsAt
        ? `${cleanSubject(input.subject)}: ${longDate(eventStartsAt, timeZone)}${eventAllDay ? "" : ` a las ${timeText(eventStartsAt, timeZone)}`}.`
        : cleanSubject(input.subject);
      break;
    default:
      summary = cleanSubject(input.subject);
  }

  return {
    source: "RULES",
    category,
    importance,
    actionRequired,
    summary,
    dueAt,
    dueHasTime,
    eventStartsAt,
    eventEndsAt,
    eventAllDay,
    eventLocation,
    eventTitle,
    amount,
    currency: "USD",
    reference,
    taskTitle: actionRequired ? taskTitleFor(category, input, facts) : null,
    taskType: actionRequired ? taskTypeFor(category, hasForm, replyTo) : null,
    replyTo,
    hasForm,
  };
}
