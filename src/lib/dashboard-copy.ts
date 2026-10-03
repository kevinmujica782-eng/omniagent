// Textos del panel de Inicio (sin dependencias de servidor).
import { clockTime, longDate } from "@/modules/procedures/time/es-dates";
import { localDayDiff } from "@/modules/procedures/time/tz";

/** "hace un momento", "hace 12 min", "hace 3 h", "ayer", "hace 5 días", "el 3 de septiembre". */
export function timeAgo(iso: string, now: Date, timeZone: string): string {
  const at = new Date(iso);
  const minutes = Math.round((now.getTime() - at.getTime()) / 60_000);
  if (minutes < 1) return "hace un momento";
  if (minutes < 60) return `hace ${minutes} min`;
  const days = localDayDiff(at, now, timeZone);
  if (days === 0) return `hace ${Math.round(minutes / 60)} h`;
  if (days === 1) return "ayer";
  if (days < 7) return `hace ${days} días`;
  return `el ${longDate(at, timeZone, false)}`;
}

/** "hoy 9:52 p. m.", "mañana 8:15 a. m.", "el 4 de octubre". */
export function whenAhead(iso: string, now: Date, timeZone: string): string {
  const at = new Date(iso);
  const days = localDayDiff(now, at, timeZone);
  if (days <= 0) return `hoy ${clockTime(at, timeZone)}`;
  if (days === 1) return `mañana ${clockTime(at, timeZone)}`;
  return `el ${longDate(at, timeZone, false)}`;
}

/** Tono del medidor de consumo: se pone ámbar al 80% y rojo al llegar al tope. */
export function meterTone(used: number, limit: number): "primary" | "attention" | "danger" {
  if (limit <= 0) return "primary";
  if (used >= limit) return "danger";
  if (used / limit >= 0.8) return "attention";
  return "primary";
}

/** "−8% vs. agosto" / "+12% vs. agosto" / "Igual que agosto". */
export function versusText(changePct: number | null, previousMonth: string): string | null {
  if (changePct === null) return null;
  if (changePct === 0) return `Igual que ${previousMonth}`;
  return `${changePct < 0 ? "−" : "+"}${Math.abs(changePct)}% vs. ${previousMonth}`;
}

const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

/** El mes anterior a `monthLabel` ("septiembre" → "agosto"). */
export function previousMonthLabel(monthLabel: string): string {
  const index = MONTHS.indexOf(monthLabel);
  return index < 0 ? "el mes pasado" : MONTHS[(index + 11) % 12];
}
