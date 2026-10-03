// Fechas sugeridas: cuándo hacer un trámite antes de su fecha límite y cuándo avisar,
// sin chocar con lo que ya hay en el calendario. Puro y determinista (fácil de probar).
import { addLocalDays, atLocalTime, localDayDiff, localParts, startOfLocalDay } from "../time/tz";

export type PlanKind = "form" | "reimbursement" | "appointment" | "event" | "bill" | "deadline" | "task";

export interface BusyBlock {
  start: Date;
  end: Date;
  title?: string;
}

export interface ScheduleInput {
  now: Date;
  timeZone: string;
  kind: PlanKind;
  dueAt: Date | null;
  /** Inicio de la cita o evento (si lo hay). */
  eventAt: Date | null;
  /** Minutos que toma hacer el trámite (llenar un formulario: 15). */
  durationMinutes: number;
  busy: BusyBlock[];
}

/** Por qué se eligieron esas fechas (el texto se arma al mostrarlo, así "mañana" nunca queda viejo). */
export type ScheduleBasis =
  | "eve" // cita: aviso la víspera
  | "two_hours" // cita muy pronto: aviso 2 horas antes
  | "too_soon" // cita en menos de 30 minutos
  | "past" // la cita ya pasó
  | "free" // sin fecha límite: primer hueco libre
  | "lead" // X días antes de que venza
  | "month" // renovación: un mes de margen
  | "urgent" // vence pronto
  | "before" // antes de que venza (otro día)
  | "overdue" // ya venció: lo antes posible
  | "full" // calendario lleno: aviso a primera hora
  | "overdue_full" // ya venció y no hay hueco
  | "user"; // el usuario eligió la fecha

export interface ScheduleSuggestion {
  plannedAt: Date | null;
  plannedEndAt: Date | null;
  remindAt: Date | null;
  urgent: boolean;
  overdue: boolean;
  basis: ScheduleBasis;
  /** Días de anticipación usados. */
  lead: number;
  /** Evento del calendario que se evitó. */
  skipped: string | null;
  /** Por qué esa fecha, en una frase ("Un día antes de que venza: mañana a las 7:00 p. m."). */
  reason: string;
}

/** Días de anticipación por tipo de trámite. */
const LEAD_DAYS: Record<PlanKind, number> = {
  form: 1,
  reimbursement: 3,
  bill: 2,
  deadline: 3,
  task: 1,
  appointment: 0,
  event: 0,
};

/** Horas preferidas para hacer trámites, en orden (fuera del horario laboral típico). */
const PREFERRED_SLOTS: [number, number][] = [
  [19, 0],
  [20, 0],
  [18, 0],
  [12, 30],
  [8, 0],
  [21, 0],
];

const MIN_LEAD_MS = 30 * 60_000;

function overlaps(start: Date, end: Date, busy: BusyBlock[]): BusyBlock | null {
  return busy.find((b) => start < b.end && b.start < end) ?? null;
}

function timeLabel(date: Date, timeZone: string): string {
  const p = localParts(date, timeZone);
  const hour12 = p.hour % 12 === 0 ? 12 : p.hour % 12;
  return `${hour12}:${String(p.minute).padStart(2, "0")} ${p.hour < 12 ? "a. m." : "p. m."}`;
}

/** Cierra la frase con punto salvo que ya termine en uno ("… 7:00 p. m."). */
function sentence(text: string): string {
  return text.endsWith(".") ? text : `${text}.`;
}

function dayLabel(date: Date, now: Date, timeZone: string): string {
  const diff = localDayDiff(now, date, timeZone);
  if (diff === 0) return "hoy";
  if (diff === 1) return "mañana";
  const names = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
  const p = localParts(date, timeZone);
  return `el ${names[p.weekday]} ${p.day}`;
}

/** Primer bloque libre en ese día local, en las horas preferidas y dentro del rango permitido. */
function freeSlotOn(
  day: Date,
  input: ScheduleInput,
  notBefore: Date,
  notAfter: Date | null,
): { start: Date; end: Date; skipped: BusyBlock | null } | null {
  let skipped: BusyBlock | null = null;
  for (const [hour, minute] of PREFERRED_SLOTS) {
    const start = atLocalTime(day, hour, minute, input.timeZone);
    const end = new Date(start.getTime() + input.durationMinutes * 60_000);
    if (start < notBefore) continue;
    if (notAfter && end > notAfter) continue;
    const clash = overlaps(start, end, input.busy);
    if (clash) {
      skipped ??= clash;
      continue;
    }
    return { start, end, skipped };
  }
  return null;
}

type Draft = Omit<ScheduleSuggestion, "reason">;

function withReason(draft: Draft, now: Date, timeZone: string): ScheduleSuggestion {
  return { ...draft, reason: describeSchedule(draft, now, timeZone) };
}

/**
 * El texto de "por qué esa fecha", relativo a `now` (se vuelve a armar cada vez que se muestra).
 * Si el bloque planeado ya pasó, lo dice así.
 */
export function describeSchedule(
  s: Pick<ScheduleSuggestion, "basis" | "lead" | "skipped" | "plannedAt" | "remindAt">,
  now: Date,
  timeZone: string,
): string {
  const at = (date: Date) => `${dayLabel(date, now, timeZone)} a las ${timeLabel(date, timeZone)}`;
  const skipped = s.skipped ? ` Evité el choque con «${s.skipped}».` : "";
  if (s.plannedAt && s.plannedAt < now && s.basis !== "overdue_full" && s.basis !== "full") {
    return sentence(`Lo tenías planeado para ${at(s.plannedAt)}`);
  }
  switch (s.basis) {
    case "past":
      return "Esta fecha ya pasó.";
    case "eve":
      return s.remindAt ? sentence(`Te aviso la víspera, ${at(s.remindAt)}`) : "Te aviso la víspera.";
    case "two_hours":
      return s.remindAt ? sentence(`Te aviso 2 horas antes, a las ${timeLabel(s.remindAt, timeZone)}`) : "Te aviso 2 horas antes.";
    case "too_soon":
      return "Es muy pronto para un recordatorio.";
    case "full":
      return "Tu calendario está lleno; te aviso a primera hora.";
    case "overdue_full":
      return "Ya venció: te aviso cuanto antes.";
    case "user":
      return s.plannedAt ? sentence(`Elegiste hacerlo ${at(s.plannedAt)}`) : s.remindAt ? sentence(`Te aviso ${at(s.remindAt)}`) : "Fechas elegidas por ti.";
  }
  if (!s.plannedAt) return "";
  const when = at(s.plannedAt);
  switch (s.basis) {
    case "free":
      return sentence(`Te propongo hacerlo ${when}`) + skipped;
    case "overdue":
      return sentence(`Ya venció; lo antes posible: ${when}`) + skipped;
    case "month":
      return sentence(`Con un mes de margen para conseguir cita: ${when}`) + skipped;
    case "lead":
      return sentence(`${s.lead === 1 ? "Un día" : `${s.lead} días`} antes de que venza: ${when}`) + skipped;
    case "urgent":
      return sentence(`Vence pronto: ${when}`) + skipped;
    default:
      return sentence(`Antes de que venza: ${when}`) + skipped;
  }
}

export function suggestSchedule(input: ScheduleInput): ScheduleSuggestion {
  const { now, timeZone } = input;
  const notBefore = new Date(now.getTime() + MIN_LEAD_MS);

  // Citas y eventos: el evento ya tiene hora; se avisa la víspera a las 7 p. m. o, si no da tiempo, 2 h antes.
  if ((input.kind === "appointment" || input.kind === "event") && input.eventAt) {
    const eve = atLocalTime(addLocalDays(input.eventAt, -1, timeZone), 19, 0, timeZone);
    const twoHours = new Date(input.eventAt.getTime() - 2 * 3_600_000);
    const remindAt = eve > notBefore ? eve : twoHours > notBefore ? twoHours : null;
    const overdue = input.eventAt < now;
    return withReason(
      {
        plannedAt: null,
        plannedEndAt: null,
        remindAt: overdue ? null : remindAt,
        urgent: !overdue && input.eventAt.getTime() - now.getTime() < 48 * 3_600_000,
        overdue,
        basis: overdue ? "past" : remindAt === eve ? "eve" : remindAt ? "two_hours" : "too_soon",
        lead: 0,
        skipped: null,
      },
      now,
      timeZone,
    );
  }

  const due = input.dueAt;
  const overdue = due !== null && due < now;
  const urgent = due !== null && !overdue && due.getTime() - now.getTime() < 48 * 3_600_000;

  // Renovaciones con mucho margen: se planean ~30 días antes (citas con cupo limitado).
  let lead = LEAD_DAYS[input.kind];
  if (input.kind === "deadline" && due && localDayDiff(now, due, timeZone) > 45) lead = 30;

  const today = startOfLocalDay(now, timeZone);
  const target = due ? addLocalDays(startOfLocalDay(due, timeZone), -lead, timeZone) : addLocalDays(today, 1, timeZone);
  // Un trámite vencido se planea igual (lo antes posible), sin tope.
  const latest = due && !overdue ? due : null;

  // Orden de búsqueda: el día objetivo, luego hacia atrás hasta hoy y, si no hay, hacia adelante hasta el vencimiento.
  const candidates: Date[] = [];
  const startDay = target < today ? today : target;
  for (let d = startDay; d >= today; d = addLocalDays(d, -1, timeZone)) {
    candidates.push(d);
    if (candidates.length > 10) break;
  }
  const lastDay = due && !overdue ? startOfLocalDay(due, timeZone) : addLocalDays(today, 7, timeZone);
  for (let d = addLocalDays(startDay, 1, timeZone); d <= lastDay; d = addLocalDays(d, 1, timeZone)) {
    candidates.push(d);
    if (candidates.length > 20) break;
  }

  for (const day of candidates) {
    const slot = freeSlotOn(day, input, notBefore, latest);
    if (!slot) continue;
    const basis: ScheduleBasis = !due
      ? "free"
      : overdue
        ? "overdue"
        : lead >= 30 && day.getTime() === target.getTime()
          ? "month"
          : day.getTime() === target.getTime()
            ? "lead"
            : urgent
              ? "urgent"
              : "before";
    return withReason(
      { plannedAt: slot.start, plannedEndAt: slot.end, remindAt: slot.start, urgent, overdue, basis, lead, skipped: slot.skipped?.title ?? null },
      now,
      timeZone,
    );
  }

  // Sin huecos: se avisa a primera hora del día límite (o ahora mismo si ya es tarde).
  const fallback = due ? atLocalTime(due, 8, 0, timeZone) : atLocalTime(addLocalDays(today, 1, timeZone), 8, 0, timeZone);
  const remindAt = fallback > notBefore ? fallback : notBefore;
  return withReason(
    { plannedAt: null, plannedEndAt: null, remindAt, urgent, overdue, basis: overdue ? "overdue_full" : "full", lead, skipped: null },
    now,
    timeZone,
  );
}

/** Qué tipo de plan corresponde a una categoría de correo. */
export function planKindFor(category: string | null | undefined): PlanKind {
  switch (category) {
    case "FORM":
      return "form";
    case "REIMBURSEMENT":
      return "reimbursement";
    case "APPOINTMENT":
      return "appointment";
    case "EVENT":
      return "event";
    case "BILL":
      return "bill";
    case "DEADLINE":
      return "deadline";
    default:
      return "task";
  }
}
