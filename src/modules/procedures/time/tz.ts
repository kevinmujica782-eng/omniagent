// Fechas en la zona horaria del usuario sin dependencias (Intl). Puro: lo usan servidor, pruebas y UI.

export interface LocalParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number; // 0 = domingo
}

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      weekday: "short",
    });
    formatters.set(timeZone, f);
  }
  return f;
}

export function safeTimeZone(timeZone: string | null | undefined): string {
  if (!timeZone) return "UTC";
  try {
    formatter(timeZone);
    return timeZone;
  } catch {
    return "UTC";
  }
}

export function localParts(date: Date, timeZone: string): LocalParts {
  const parts = Object.fromEntries(formatter(timeZone).formatToParts(date).map((p) => [p.type, p.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
    second: Number(parts.second),
    weekday: WEEKDAYS[parts.weekday] ?? 0,
  };
}

/** Minutos que la hora local va por delante de UTC en ese instante (Caracas: -240). */
export function offsetMinutes(date: Date, timeZone: string): number {
  const p = localParts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60_000);
}

/** Instante UTC de una fecha y hora "de pared" en la zona dada (tiene en cuenta el horario de verano). */
export function zonedToUtc(
  p: { year: number; month: number; day: number; hour?: number; minute?: number },
  timeZone: string,
): Date {
  const wall = Date.UTC(p.year, p.month - 1, p.day, p.hour ?? 0, p.minute ?? 0);
  let guess = wall - offsetMinutes(new Date(wall), timeZone) * 60_000;
  const second = wall - offsetMinutes(new Date(guess), timeZone) * 60_000;
  if (second !== guess) guess = second;
  return new Date(guess);
}

/** "2026-10-02" en la zona del usuario. */
export function localDateKey(date: Date, timeZone: string): string {
  const p = localParts(date, timeZone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

export function startOfLocalDay(date: Date, timeZone: string): Date {
  const p = localParts(date, timeZone);
  return zonedToUtc({ year: p.year, month: p.month, day: p.day }, timeZone);
}

/** El mismo día local de `date`, a la hora indicada. */
export function atLocalTime(date: Date, hour: number, minute: number, timeZone: string): Date {
  const p = localParts(date, timeZone);
  return zonedToUtc({ year: p.year, month: p.month, day: p.day, hour, minute }, timeZone);
}

/** Suma días de calendario conservando la hora local. */
export function addLocalDays(date: Date, days: number, timeZone: string): Date {
  const p = localParts(date, timeZone);
  const base = new Date(Date.UTC(p.year, p.month - 1, p.day + days));
  return zonedToUtc(
    { year: base.getUTCFullYear(), month: base.getUTCMonth() + 1, day: base.getUTCDate(), hour: p.hour, minute: p.minute },
    timeZone,
  );
}

/** Días de calendario entre dos instantes, en la zona del usuario (b - a). */
export function localDayDiff(a: Date, b: Date, timeZone: string): number {
  const pa = localParts(a, timeZone);
  const pb = localParts(b, timeZone);
  return Math.round((Date.UTC(pb.year, pb.month - 1, pb.day) - Date.UTC(pa.year, pa.month - 1, pa.day)) / 86_400_000);
}

/** "YYYY-MM-DDTHH:mm" (hora local, como la devuelve el modelo) → instante UTC. */
export function parseLocalDateTime(value: string | null | undefined, timeZone: string): { date: Date; hasTime: boolean } | null {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(value.trim());
  if (!m) return null;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const hasTime = m[4] !== undefined;
  const date = zonedToUtc({ year, month, day, hour: hasTime ? Number(m[4]) : 0, minute: hasTime ? Number(m[5]) : 0 }, timeZone);
  return Number.isNaN(date.getTime()) ? null : { date, hasTime };
}

/** Instante → "YYYY-MM-DDTHH:mm" en hora local (para el modelo y para inputs datetime-local). */
export function toLocalInput(date: Date, timeZone: string): string {
  const p = localParts(date, timeZone);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}
