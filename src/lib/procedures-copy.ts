// Textos del módulo de trámites para la interfaz (sin dependencias de servidor).
import { clockTime } from "@/modules/procedures/time/es-dates";
import { localDayDiff, localParts } from "@/modules/procedures/time/tz";
import type { ChipTone } from "@/components/ui";
import type { ProcedureView } from "@/types/cards";

const WEEKDAYS_SHORT = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
const WEEKDAYS_LONG = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const MONTHS_SHORT = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sept", "oct", "nov", "dic"];
const MONTHS_LONG = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

/** "hoy", "mañana", "ayer" o "vie 2 oct". */
export function dayText(value: string | Date, timeZone: string, now: Date = new Date()): string {
  const date = new Date(value);
  const diff = localDayDiff(now, date, timeZone);
  if (diff === 0) return "hoy";
  if (diff === 1) return "mañana";
  if (diff === -1) return "ayer";
  const p = localParts(date, timeZone);
  return `${WEEKDAYS_SHORT[p.weekday]} ${p.day} ${MONTHS_SHORT[p.month - 1]}`;
}

/** "Hoy", "Mañana" o "Jueves 1 de octubre" (encabezados de la agenda). */
export function dayHeading(value: string | Date, timeZone: string, now: Date = new Date()): string {
  const date = new Date(value);
  const diff = localDayDiff(now, date, timeZone);
  if (diff === 0) return "Hoy";
  if (diff === 1) return "Mañana";
  const p = localParts(date, timeZone);
  const name = WEEKDAYS_LONG[p.weekday];
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} ${p.day} de ${MONTHS_LONG[p.month - 1]}`;
}

/** "mañana, 8:00 p. m." (o solo el día). */
export function momentText(value: string | Date, timeZone: string, now: Date = new Date(), withTime = true): string {
  const date = new Date(value);
  return withTime ? `${dayText(date, timeZone, now)}, ${clockTime(date, timeZone)}` : dayText(date, timeZone, now);
}

export function timeText(value: string | Date, timeZone: string): string {
  return clockTime(new Date(value), timeZone);
}

/** Fecha límite legible: "hoy", "vie 2 oct, 12:00 p. m.". */
export function dueText(view: Pick<ProcedureView, "dueAt" | "dueHasTime">, timeZone: string, now: Date = new Date()): string | null {
  return view.dueAt ? momentText(view.dueAt, timeZone, now, view.dueHasTime) : null;
}

/** El aviso de un trámite activo ya llegó (le toca al usuario). */
export function reminderDue(view: ProcedureView, now: Date = new Date()): boolean {
  const open = view.status === "PENDING" || view.status === "IN_PROGRESS" || view.status === "WAITING_USER";
  return open && view.remindAt !== null && new Date(view.remindAt) <= now;
}

/** Estado principal del trámite como etiqueta. */
export function stateChip(view: ProcedureView, now: Date = new Date()): { tone: ChipTone; label: string } | null {
  if (view.status === "DONE") return { tone: "good", label: "Hecho" };
  if (view.status === "CANCELED") return { tone: "neutral", label: "Descartado" };
  if (view.overdue) return { tone: "danger", label: view.event && !view.dueAt ? "Ya pasó" : "Vencido" };
  if (reminderDue(view, now)) return { tone: "attention", label: "Te toca" };
  if (view.urgent) return { tone: "attention", label: "Urgente" };
  if (view.status === "IN_PROGRESS") return { tone: "neutral", label: "En curso" };
  return null;
}

/** Remitente corto: "Carolina Rivera" o el correo. */
export function senderText(view: ProcedureView): string | null {
  if (!view.from) return null;
  return view.from.name?.replace(/\s*[·|].*$/, "").trim() || view.from.email;
}
