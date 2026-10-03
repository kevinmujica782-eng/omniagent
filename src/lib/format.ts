// Formato para UI y servidor (sin dependencias de servidor).
const LOCALE = "es-US";
const DAY_MS = 86_400_000;

export function money(
  value: number | string | null | undefined,
  currency = "USD",
  opts: { cents?: boolean } = {},
): string {
  const n = Number(value ?? 0);
  const cents = opts.cents ?? (Math.abs(n) < 100 && !Number.isInteger(n));
  try {
    return new Intl.NumberFormat(LOCALE, {
      style: "currency",
      currency,
      minimumFractionDigits: cents ? 2 : 0,
      maximumFractionDigits: cents ? 2 : 0,
    }).format(n);
  } catch {
    return `${n.toFixed(cents ? 2 : 0)} ${currency}`;
  }
}

export function percent(ratio: number, digits = 0): string {
  return `${(ratio * 100).toFixed(digits)}%`;
}

/** "+33%" o "−5%" (con signo menos tipográfico). */
export function signedPercent(pct: number): string {
  if (pct === 0) return "0%";
  return pct > 0 ? `+${pct}%` : `−${Math.abs(pct)}%`;
}

export function shortDate(value: string | Date | null | undefined, timeZone?: string): string {
  if (!value) return "";
  try {
    return new Intl.DateTimeFormat(LOCALE, { day: "numeric", month: "short", timeZone }).format(new Date(value));
  } catch {
    return new Date(value).toISOString().slice(0, 10);
  }
}

export function dateTime(value: string | Date | null | undefined, timeZone?: string): string {
  if (!value) return "";
  try {
    return new Intl.DateTimeFormat(LOCALE, {
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "numeric",
      minute: "2-digit",
      timeZone,
    }).format(new Date(value));
  } catch {
    return new Date(value).toISOString();
  }
}

/** "diciembre de 2027" (para fechas objetivo de metas, guardadas como fecha sin hora). */
export function monthYear(value: string | Date | null | undefined, timeZone = "UTC"): string {
  if (!value) return "";
  const date = typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00Z`) : new Date(value);
  try {
    return new Intl.DateTimeFormat(LOCALE, { month: "long", year: "numeric", timeZone }).format(date);
  } catch {
    return date.toISOString().slice(0, 7);
  }
}

/** "hoy", "mañana", "en 3 días", "hace 2 días" (por días de calendario aproximados). */
export function relativeDays(value: string | Date, now: Date = new Date()): string {
  const diff = Math.round((new Date(value).getTime() - now.getTime()) / DAY_MS);
  if (diff === 0) return "hoy";
  if (diff === 1) return "mañana";
  if (diff === -1) return "ayer";
  return diff > 0 ? `en ${diff} días` : `hace ${Math.abs(diff)} días`;
}

/** ["A", "B", "C"] → "A, B y C". */
export function listJoin(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} y ${items[items.length - 1]}`;
}

export function plural(n: number, singular: string, pluralForm: string): string {
  return `${n} ${n === 1 ? singular : pluralForm}`;
}

export function days(n: number): string {
  return plural(n, "día", "días");
}

export const CADENCE_LABEL: Record<string, string> = {
  WEEKLY: "semana",
  MONTHLY: "mes",
  QUARTERLY: "trimestre",
  YEARLY: "año",
};

/** "al mes", "a la semana"... para montos recurrentes. */
export const CADENCE_PHRASE: Record<string, string> = {
  WEEKLY: "a la semana",
  MONTHLY: "al mes",
  QUARTERLY: "al trimestre",
  YEARLY: "al año",
};

export function firstName(fullName: string | null | undefined): string | null {
  const first = fullName?.trim().split(/\s+/)[0];
  return first ? first : null;
}

/** Línea de estado del agente en el encabezado: "Vigilando 2 precios y 1 trámite". */
export function agentStatusLine(watching: number, openTasks: number): string {
  const parts: string[] = [];
  if (watching > 0) parts.push(plural(watching, "precio", "precios"));
  if (openTasks > 0) parts.push(plural(openTasks, "trámite", "trámites"));
  return parts.length ? `Vigilando ${parts.join(" y ")}` : "Listo para ayudarte";
}
