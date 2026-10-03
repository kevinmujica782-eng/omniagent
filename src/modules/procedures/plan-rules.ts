// Plan de un trámite: pasos, eventos de calendario, prioridad, lo que se guarda en tasks.metadata y la vista.
// Puro y determinista: lo usan el servidor, la vista previa y las pruebas (sin base de datos).
import { money } from "@/lib/format";
import type { MailCategoryKind, ProcedureView, TaskStatusId } from "@/types/cards";
import {
  describeSchedule,
  planKindFor,
  suggestSchedule,
  type BusyBlock,
  type PlanKind,
  type ScheduleBasis,
} from "./calendar/scheduler";
import type { MailCategoryId, TaskTypeId, TriageResult } from "./mail/triage/rules";
import { clockTime, longDate, relativeDay } from "./time/es-dates";
import { atLocalTime, addLocalDays, startOfLocalDay } from "./time/tz";

export interface PlanEvent {
  title: string;
  startsAt: Date;
  endsAt: Date | null;
  allDay: boolean;
  location: string | null;
}

export interface PlanFacts {
  kind: PlanKind;
  title: string;
  dueAt: Date | null;
  dueHasTime: boolean;
  event: PlanEvent | null;
  amount: number | null;
  currency: string;
  reference: string | null;
  replyTo: string | null;
  hasForm: boolean;
  /** De dónde salió (asunto del correo), para la descripción de los eventos. */
  origin?: string | null;
}

export interface CalendarEventDraft {
  kind: "EVENT" | "DEADLINE" | "FOCUS";
  title: string;
  description: string | null;
  location: string | null;
  startsAt: Date;
  endsAt: Date | null;
  allDay: boolean;
  /** Minutos antes del inicio (negativos: después; ver ics.ts). */
  reminderMinutes: number[];
}

/** Minutos que toma hacerlo (el bloque que se reserva en el calendario). */
export const DURATION_MINUTES: Record<PlanKind, number> = {
  form: 15,
  reimbursement: 20,
  bill: 10,
  deadline: 30,
  task: 20,
  appointment: 0,
  event: 0,
};

export function priorityFor(importance: number, urgent: boolean, overdue: boolean): "LOW" | "MEDIUM" | "HIGH" {
  if (urgent || overdue || importance >= 2) return "HIGH";
  return importance === 1 ? "MEDIUM" : "LOW";
}

/** Tipo de tarea para un trámite creado a mano (sin correo). */
export function planKindForTaskType(type: string): PlanKind {
  switch (type) {
    case "FORM_FILL":
      return "form";
    case "APPOINTMENT":
      return "appointment";
    default:
      return "task";
  }
}

function dueText(facts: PlanFacts, timeZone: string): string | null {
  if (!facts.dueAt) return null;
  return facts.dueHasTime
    ? `${longDate(facts.dueAt, timeZone)} a las ${clockTime(facts.dueAt, timeZone)}`
    : longDate(facts.dueAt, timeZone);
}

function eventText(event: PlanEvent, timeZone: string): string {
  return `${longDate(event.startsAt, timeZone)}${event.allDay ? "" : ` a las ${clockTime(event.startsAt, timeZone)}`}`;
}

/** Pasos concretos del trámite, en infinitivo y en orden. */
export function stepsFor(facts: PlanFacts, timeZone: string): string[] {
  const due = dueText(facts, timeZone);
  const before = due ? ` antes del ${due}` : "";
  const steps: (string | null)[] = [];
  switch (facts.kind) {
    case "form":
      steps.push(
        facts.hasForm ? "Revisar el formulario: Omni ya llenó lo que sabe de ti" : "Conseguir el formulario y llenarlo",
        "Firmar y marcar la autorización (eso lo haces tú)",
        facts.replyTo ? `Enviarlo a ${facts.replyTo}${before}` : `Entregarlo${before}`,
      );
      break;
    case "reimbursement":
      steps.push(
        facts.hasForm ? "Revisar el formulario de reembolso que Omni prellenó" : "Llenar el formulario de reembolso",
        "Tener a mano la factura o el recibo",
        facts.replyTo ? `Enviarlo a ${facts.replyTo}${before}` : `Enviarlo${before}`,
      );
      break;
    case "appointment":
      steps.push(
        facts.event ? `Asistir el ${eventText(facts.event, timeZone)}` : "Agendar la cita",
        facts.event?.location ? `Lugar: ${facts.event.location}` : null,
        "Confirmar o cambiar la cita si te lo piden",
      );
      break;
    case "event":
      steps.push(
        facts.event ? `Asistir el ${eventText(facts.event, timeZone)}` : null,
        facts.event?.location ? `Lugar: ${facts.event.location}` : null,
        facts.replyTo ? `Confirmar asistencia a ${facts.replyTo}` : "Confirmar asistencia si te lo piden",
      );
      break;
    case "bill":
      steps.push(
        `Pagar${facts.amount ? ` ${money(facts.amount, facts.currency, { cents: true })}` : ""}${before}`,
        facts.reference ? `Referencia de pago: ${facts.reference}` : null,
        "Guardar el comprobante",
      );
      break;
    case "deadline":
      if (/pasaporte|licencia|renova|renueva/i.test(facts.title)) {
        steps.push("Agendar la cita de renovación", "Reunir los documentos que pide el aviso", `Terminarlo${before}`);
      } else if (facts.replyTo) {
        steps.push(`Responder a ${facts.replyTo}${before}`);
      } else {
        steps.push(`Hacerlo${before}`);
      }
      if (facts.event) steps.push(`Fecha del evento: ${eventText(facts.event, timeZone)}`);
      break;
    default:
      if (due) steps.push(`Hacerlo${before}`);
  }
  return steps.filter((s): s is string => Boolean(s));
}

/** Texto del recordatorio en la app ("Vence mañana.", "Tu cita es hoy a las 10:30 a. m. en …"). */
export function reminderText(
  input: { kind: PlanKind; dueAt: Date | null; dueHasTime: boolean; event: PlanEvent | null },
  now: Date,
  timeZone: string,
): string {
  const { event } = input;
  if ((input.kind === "appointment" || input.kind === "event") && event) {
    const when = `${relativeDay(event.startsAt, now, timeZone)}${event.allDay ? "" : ` a las ${clockTime(event.startsAt, timeZone)}`}`;
    const where = event.location ? ` en ${event.location}` : "";
    return event.startsAt < now
      ? `Era ${when}${where}.`
      : `${input.kind === "appointment" ? "Tu cita es" : "Es"} ${when}${where}.`;
  }
  if (input.dueAt) {
    const when = `${relativeDay(input.dueAt, now, timeZone)}${input.dueHasTime ? ` a las ${clockTime(input.dueAt, timeZone)}` : ""}`;
    return input.dueAt < now ? `Venció ${when}. Aún puedes hacerlo.` : `Vence ${when}.`;
  }
  return "Es buen momento para hacerlo.";
}

/** Aviso la víspera a las 7:00 p. m. y 1 hora antes (citas con hora). */
function eventAlarms(event: PlanEvent, timeZone: string): number[] {
  if (event.allDay) return [300];
  const eve = atLocalTime(addLocalDays(event.startsAt, -1, timeZone), 19, 0, timeZone);
  const eveMinutes = Math.round((event.startsAt.getTime() - eve.getTime()) / 60_000);
  return eveMinutes > 90 ? [eveMinutes, 60] : [60];
}

/**
 * Eventos que se crean al confirmar: la cita o evento, el bloque para hacerlo (FOCUS) y la fecha límite.
 * Solo los que aún no pasaron.
 */
export function calendarEventsFor(
  facts: PlanFacts,
  schedule: { plannedAt: Date | null; plannedEndAt: Date | null },
  steps: string[],
  now: Date,
  timeZone: string,
): CalendarEventDraft[] {
  const events: CalendarEventDraft[] = [];
  const origin = facts.origin ? `Detectado por OmniAgent en «${facts.origin}».` : "Creado con OmniAgent.";

  if (facts.event && (facts.event.endsAt ?? facts.event.startsAt) > now) {
    events.push({
      kind: "EVENT",
      title: facts.event.title,
      description: origin,
      location: facts.event.location,
      startsAt: facts.event.allDay ? startOfLocalDay(facts.event.startsAt, timeZone) : facts.event.startsAt,
      endsAt: facts.event.endsAt,
      allDay: facts.event.allDay,
      reminderMinutes: eventAlarms(facts.event, timeZone),
    });
  }

  if (schedule.plannedAt && schedule.plannedAt > now) {
    events.push({
      kind: "FOCUS",
      title: facts.title,
      description: [steps.map((s, i) => `${i + 1}. ${s}`).join("\n"), origin].filter(Boolean).join("\n\n"),
      location: null,
      startsAt: schedule.plannedAt,
      endsAt: schedule.plannedEndAt,
      allDay: false,
      reminderMinutes: [0],
    });
  }

  if (facts.dueAt && facts.dueAt > now && facts.kind !== "appointment" && facts.kind !== "event") {
    events.push({
      kind: "DEADLINE",
      title: `Fecha límite: ${facts.title}`,
      description: origin,
      location: null,
      startsAt: facts.dueHasTime ? facts.dueAt : startOfLocalDay(facts.dueAt, timeZone),
      endsAt: null,
      allDay: !facts.dueHasTime,
      // Todo el día: aviso a las 8:00 a. m. de ese día. Con hora: 2 horas antes.
      reminderMinutes: facts.dueHasTime ? [120] : [-480],
    });
  }
  return events;
}

// ── Lo que se guarda en tasks.metadata ─────────────────────────────────────

export type StoredEvent = { title: string; startsAt: string; endsAt: string | null; allDay: boolean; location: string | null };

export type PlanMeta = {
  v: 1;
  kind: PlanKind;
  category: MailCategoryId | null;
  summary: string | null;
  dueHasTime: boolean;
  plannedEndAt: string | null;
  basis: ScheduleBasis | null;
  lead: number;
  skipped: string | null;
  event: StoredEvent | null;
  replyTo: string | null;
  amount: number | null;
  currency: string;
  reference: string | null;
  steps: string[];
  triageSource: "AI" | "RULES" | null;
  hasForm: boolean;
  origin: string | null;
};

export function readPlanMeta(value: unknown, taskType: string): PlanMeta {
  const raw = (value ?? {}) as Partial<PlanMeta>;
  return {
    v: 1,
    kind: raw.kind ?? planKindForTaskType(taskType),
    category: raw.category ?? null,
    summary: raw.summary ?? null,
    dueHasTime: Boolean(raw.dueHasTime),
    plannedEndAt: raw.plannedEndAt ?? null,
    basis: raw.basis ?? null,
    lead: typeof raw.lead === "number" ? raw.lead : 0,
    skipped: raw.skipped ?? null,
    event: raw.event ?? null,
    replyTo: raw.replyTo ?? null,
    amount: typeof raw.amount === "number" ? raw.amount : null,
    currency: raw.currency ?? "USD",
    reference: raw.reference ?? null,
    steps: Array.isArray(raw.steps) ? raw.steps.filter((s): s is string => typeof s === "string") : [],
    triageSource: raw.triageSource ?? null,
    hasForm: Boolean(raw.hasForm),
    origin: raw.origin ?? null,
  };
}

export const toStoredEvent = (e: PlanEvent | null): StoredEvent | null =>
  e ? { title: e.title, startsAt: e.startsAt.toISOString(), endsAt: e.endsAt?.toISOString() ?? null, allDay: e.allDay, location: e.location } : null;

export const toPlanEvent = (e: StoredEvent | null): PlanEvent | null =>
  e ? { title: e.title, startsAt: new Date(e.startsAt), endsAt: e.endsAt ? new Date(e.endsAt) : null, allDay: e.allDay, location: e.location } : null;

export function factsFrom(title: string, due: { at: Date; hasTime: boolean } | null, meta: PlanMeta): PlanFacts {
  return {
    kind: meta.kind,
    title,
    dueAt: due?.at ?? null,
    dueHasTime: due?.hasTime ?? false,
    event: toPlanEvent(meta.event),
    amount: meta.amount,
    currency: meta.currency,
    reference: meta.reference,
    replyTo: meta.replyTo,
    hasForm: meta.hasForm,
    origin: meta.origin,
  };
}

/** "Permiso para la excursión al Acuario" → "Excursión al Acuario" (título del evento en el calendario). */
export function eventTitleFrom(subject: string): string {
  let s = subject.replace(/^(re|rv|fw|fwd)\s*:\s*/i, "");
  const permiso = /permiso para (?:la |el )?(.+)/i.exec(s);
  if (permiso) s = permiso[1];
  s = s.replace(/\s*[:—–-]\s*(falta|pendiente|urgente|recordatorio|confirma|responde).*$/i, "").trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : subject;
}

// ── Sugerencia a partir de un correo clasificado ───────────────────────────

export interface PlanDraft {
  title: string;
  type: TaskTypeId;
  priority: "LOW" | "MEDIUM" | "HIGH";
  notes: string | null;
  dueAt: Date | null;
  plannedAt: Date | null;
  remindAt: Date | null;
  meta: PlanMeta;
}

/** Trámite sugerido para un correo accionable: fechas propuestas (sin chocar con `busy`), pasos y datos. */
export function draftFromTriage(
  triage: TriageResult,
  subject: string,
  ctx: { now: Date; timeZone: string; busy: BusyBlock[] },
): PlanDraft | null {
  if (!triage.actionRequired) return null;
  const kind = planKindFor(triage.category);
  const title = (triage.taskTitle ?? subject).slice(0, 140);
  const event: PlanEvent | null = triage.eventStartsAt
    ? {
        title: (triage.eventTitle ?? eventTitleFrom(subject)).slice(0, 140),
        startsAt: triage.eventStartsAt,
        endsAt: triage.eventEndsAt,
        allDay: triage.eventAllDay,
        location: triage.eventLocation,
      }
    : null;
  const schedule = suggestSchedule({
    now: ctx.now,
    timeZone: ctx.timeZone,
    kind,
    dueAt: triage.dueAt,
    eventAt: event?.startsAt ?? null,
    durationMinutes: DURATION_MINUTES[kind] || 15,
    busy: ctx.busy,
  });
  const due = triage.dueAt ? { at: triage.dueAt, hasTime: triage.dueHasTime } : null;
  const meta: PlanMeta = {
    v: 1,
    kind,
    category: triage.category,
    summary: triage.summary,
    dueHasTime: triage.dueHasTime,
    plannedEndAt: schedule.plannedEndAt?.toISOString() ?? null,
    basis: schedule.basis,
    lead: schedule.lead,
    skipped: schedule.skipped,
    event: toStoredEvent(event),
    replyTo: triage.replyTo,
    amount: triage.amount,
    currency: triage.currency,
    reference: triage.reference,
    steps: [],
    triageSource: triage.source,
    hasForm: triage.hasForm,
    origin: subject,
  };
  meta.steps = stepsFor(factsFrom(title, due, meta), ctx.timeZone);
  return {
    title,
    type: triage.taskType ?? "OTHER",
    priority: priorityFor(triage.importance, schedule.urgent, schedule.overdue),
    notes: triage.summary,
    dueAt: due?.at ?? null,
    plannedAt: schedule.plannedAt,
    remindAt: schedule.remindAt,
    meta,
  };
}

// ── Vista ──────────────────────────────────────────────────────────────────

export interface ProcedureSource {
  taskId: string;
  status: TaskStatusId;
  type: string;
  title: string;
  notes: string | null;
  dueAt: Date | null;
  plannedAt: Date | null;
  remindAt: Date | null;
  confirmedAt: Date | null;
  completedAt: Date | null;
  metadata: unknown;
  mail: { fromName: string | null; fromEmail: string; subject: string; receivedAt: Date } | null;
  calendarSynced: boolean;
  documents: ProcedureView["documents"];
}

/** Vista del trámite. Urgencia, vencimiento y el "por qué" se calculan respecto de `now`. */
export function procedureView(src: ProcedureSource, now: Date, timeZone: string): ProcedureView {
  const meta = readPlanMeta(src.metadata, src.type);
  const event = meta.event;
  const isEventKind = meta.kind === "appointment" || meta.kind === "event";
  const ref = isEventKind && event ? new Date(event.startsAt) : src.dueAt;
  const open = src.status !== "DONE" && src.status !== "CANCELED";
  const overdue = open && ref !== null && ref < now;
  const urgent = open && ref !== null && !overdue && ref.getTime() - now.getTime() < 48 * 3_600_000;
  const reason =
    open && meta.basis
      ? describeSchedule({ basis: meta.basis, lead: meta.lead, skipped: meta.skipped, plannedAt: src.plannedAt, remindAt: src.remindAt }, now, timeZone) ||
        null
      : null;
  return {
    taskId: src.taskId,
    status: src.status,
    type: src.type,
    category: (meta.category as MailCategoryKind | null) ?? null,
    title: src.title,
    summary: meta.summary ?? src.notes,
    from: src.mail ? { name: src.mail.fromName, email: src.mail.fromEmail } : null,
    mailSubject: src.mail?.subject ?? null,
    receivedAt: src.mail?.receivedAt.toISOString() ?? null,
    dueAt: src.dueAt?.toISOString() ?? null,
    dueHasTime: meta.dueHasTime,
    plannedAt: src.plannedAt?.toISOString() ?? null,
    remindAt: src.remindAt?.toISOString() ?? null,
    reason,
    urgent,
    overdue,
    event,
    amount: meta.amount,
    currency: meta.currency,
    reference: meta.reference,
    replyTo: meta.replyTo,
    steps: meta.steps,
    documents: src.documents,
    calendarSynced: src.calendarSynced,
    confirmedAt: src.confirmedAt?.toISOString() ?? null,
    completedAt: src.completedAt?.toISOString() ?? null,
  };
}

/** Fecha más próxima del trámite (para ordenar: lo vencido y lo urgente primero). */
export function nextDateOf(view: ProcedureView): number {
  const dates = [view.dueAt, view.event?.startsAt ?? null, view.plannedAt].filter((d): d is string => Boolean(d));
  return dates.length ? Math.min(...dates.map((d) => new Date(d).getTime())) : Number.MAX_SAFE_INTEGER;
}
