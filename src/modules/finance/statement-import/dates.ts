import { fold } from "./text";
import type { DateOrder } from "./types";

// Fechas de estados de cuenta: "05/03/2024", "2024-03-05", "15-ene-24", "15/ENE" (sin año), "15 de enero de 2024",
// "Jan 15, 2024". El orden día/mes se decide con todas las fechas del archivo, no fila por fila.

const DAY_MS = 86_400_000;

const MONTHS: Record<string, number> = {
  ene: 1, enero: 1, jan: 1, january: 1,
  feb: 2, febrero: 2, february: 2,
  mar: 3, marzo: 3, march: 3,
  abr: 4, abril: 4, apr: 4, april: 4,
  may: 5, mayo: 5,
  jun: 6, junio: 6, june: 6,
  jul: 7, julio: 7, july: 7,
  ago: 8, agosto: 8, aug: 8, august: 8,
  sep: 9, sept: 9, set: 9, septiembre: 9, setiembre: 9, september: 9,
  oct: 10, octubre: 10, october: 10,
  nov: 11, noviembre: 11, november: 11,
  dic: 12, diciembre: 12, dec: 12, december: 12,
};

export type DateToken =
  /** Año, mes y día sin ambigüedad ("2024-03-05"). */
  | { kind: "full"; y: number; m: number; d: number }
  /** Mes con nombre ("15 ENE 2024", "15/ENE"); el año puede faltar. */
  | { kind: "named"; y: number | null; m: number; d: number }
  /** Solo números ("05/03/2024", "05/03"): el orden del archivo decide cuál es el día. */
  | { kind: "numeric"; y: number | null; a: number; b: number };

function monthNumber(word: string): number | null {
  return MONTHS[word] ?? (word.length > 3 ? (MONTHS[word.slice(0, 3)] ?? null) : null);
}

/** Años de 2 dígitos: los estados de cuenta son de este siglo. */
function fullYear(text: string): number {
  return text.length === 4 ? Number(text) : 2000 + Number(text);
}

export function readDateToken(input: string | null | undefined): DateToken | null {
  const text = (input ?? "").trim();
  if (!text || text.length > 40) return null;

  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s]\d{1,2}:\d{2}.*|T.*)?$/.exec(text);
  if (m) return { kind: "full", y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };

  m = /^((?:19|20)\d{2})(\d{2})(\d{2})$/.exec(text);
  if (m) return { kind: "full", y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };

  m = /^(\d{1,2})[-/.](\d{1,2})(?:[-/.](\d{4}|\d{2}))?(?:\s+\d{1,2}:\d{2}(?::\d{2})?(?:\s*[ap]\.?\s?m\.?)?)?$/i.exec(text);
  if (m) return { kind: "numeric", a: Number(m[1]), b: Number(m[2]), y: m[3] ? fullYear(m[3]) : null };

  const f = fold(text);
  m = /^(\d{1,2}) ?(?:de )?([a-z]{3,10}) ?(?:(?:de |del )?(\d{4}|\d{2}))?$/.exec(f);
  if (m) {
    const month = monthNumber(m[2]);
    if (month) return { kind: "named", m: month, d: Number(m[1]), y: m[3] ? fullYear(m[3]) : null };
  }
  m = /^([a-z]{3,10}) ?(\d{1,2})(?: (\d{4}|\d{2}))?$/.exec(f);
  if (m) {
    const month = monthNumber(m[1]);
    if (month) return { kind: "named", m: month, d: Number(m[2]), y: m[3] ? fullYear(m[3]) : null };
  }
  return null;
}

/** "YYYY-MM-DD" si la fecha existe en el calendario (sin 31 de abril ni 30 de febrero). */
export function isoDate(y: number, m: number, d: number): string | null {
  if (!Number.isInteger(y) || y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

type NumericToken = Extract<DateToken, { kind: "numeric" }>;

/** Cuántos pares seguidos quedan en orden (ascendente o descendente) si las fechas se leen así. */
function monotony(tokens: NumericToken[], order: "DMY" | "MDY"): number {
  const values = tokens.map((t) => {
    const [d, m] = order === "DMY" ? [t.a, t.b] : [t.b, t.a];
    return (t.y ?? 2000) * 10_000 + m * 100 + d;
  });
  let up = 0;
  let down = 0;
  for (let i = 1; i < values.length; i++) {
    if (values[i] >= values[i - 1]) up++;
    if (values[i] <= values[i - 1]) down++;
  }
  return Math.max(up, down);
}

/** Días entre la primera y la última fecha si se leen en ese orden (un estado de cuenta abarca semanas, no meses). */
function spanDays(tokens: NumericToken[], order: "DMY" | "MDY"): number {
  const times = tokens.map((t) => {
    const [d, m] = order === "DMY" ? [t.a, t.b] : [t.b, t.a];
    return Date.UTC(t.y ?? 2000, m - 1, d);
  });
  return (Math.max(...times) - Math.min(...times)) / DAY_MS;
}

/**
 * Orden de las fechas numéricas del archivo. Un día mayor que 12 lo decide ("25/03" solo puede ser día/mes).
 * Si ninguno lo es, se avisa que es ambiguo y se elige el orden que junta las fechas en menos días ("02/01, 02/02,
 * 02/05" son del 1 al 5 de febrero, no de enero a mayo); si empatan, el que las deja en secuencia.
 */
export function inferDateOrder(tokens: DateToken[], fallback: DateOrder = "DMY"): { order: DateOrder; ambiguous: boolean } {
  const numeric = tokens.filter((t): t is NumericToken => t.kind === "numeric");
  if (numeric.length === 0) {
    return { order: tokens.some((t) => t.kind === "full") ? "YMD" : fallback, ambiguous: false };
  }
  let dmy = 0;
  let mdy = 0;
  let undecided = 0;
  for (const t of numeric) {
    if (t.a > 12 && t.a <= 31 && t.b >= 1 && t.b <= 12) dmy++;
    else if (t.b > 12 && t.b <= 31 && t.a >= 1 && t.a <= 12) mdy++;
    else if (t.a !== t.b) undecided++;
  }
  if (dmy > 0 && mdy === 0) return { order: "DMY", ambiguous: false };
  if (mdy > 0 && dmy === 0) return { order: "MDY", ambiguous: false };
  if (dmy > 0 && mdy > 0) return { order: dmy >= mdy ? "DMY" : "MDY", ambiguous: true };
  if (undecided === 0) return { order: fallback, ambiguous: false };
  const [dmySpan, mdySpan] = [spanDays(numeric, "DMY"), spanDays(numeric, "MDY")];
  if (dmySpan !== mdySpan) return { order: dmySpan < mdySpan ? "DMY" : "MDY", ambiguous: true };
  const byDay = monotony(numeric, "DMY");
  const byMonth = monotony(numeric, "MDY");
  if (byDay !== byMonth) return { order: byDay > byMonth ? "DMY" : "MDY", ambiguous: true };
  return { order: fallback === "MDY" ? "MDY" : "DMY", ambiguous: true };
}

/**
 * Año para fechas que no lo traen ("15/ENE"): el del fin del periodo (o de hoy), o el anterior si la fecha
 * caería después. Así un estado del 15 de diciembre al 14 de enero pone diciembre en el año correcto.
 */
export function yearResolver(anchorIso: string): (m: number, d: number) => number {
  const anchor = Date.parse(`${anchorIso}T00:00:00Z`);
  const year = new Date(anchor).getUTCFullYear();
  return (m, d) => (Date.UTC(year, m - 1, d) > anchor + 7 * DAY_MS ? year - 1 : year);
}

export function resolveDate(token: DateToken, order: DateOrder, yearFor: (m: number, d: number) => number): string | null {
  if (token.kind === "full") return isoDate(token.y, token.m, token.d);
  if (token.kind === "named") return isoDate(token.y ?? yearFor(token.m, token.d), token.m, token.d);
  const [d, m] = order === "MDY" ? [token.b, token.a] : [token.a, token.b];
  if (m < 1 || m > 12) return null;
  return isoDate(token.y ?? yearFor(m, d), m, d);
}

export function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(iso: string, days: number): string {
  return isoDay(new Date(Date.parse(`${iso}T00:00:00Z`) + days * DAY_MS));
}

const MONTH_WORD =
  "(?:ene(?:ro)?|feb(?:rero)?|february|mar(?:zo)?|march|abr(?:il)?|apr(?:il)?|may(?:o)?|jun(?:io)?|june|jul(?:io)?|july|ago(?:sto)?|aug(?:ust)?|sep(?:t(?:iembre)?)?|september|set(?:iembre)?|oct(?:ubre)?|october|nov(?:iembre)?|november|dic(?:iembre)?|dec(?:ember)?|jan(?:uary)?)";
const DATE_IN_TEXT = new RegExp(
  "(?<![A-Za-z0-9])(?:" +
    [
      String.raw`\d{4}-\d{1,2}-\d{1,2}`,
      String.raw`\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4}`,
      String.raw`\d{1,2}(?:[/.\-]|\s+(?:de\s+)?)${MONTH_WORD}\.?(?:(?:[/.\-]|\s+(?:del?\s+)?)\d{4}|[/.\-]\d{2})?`,
      String.raw`${MONTH_WORD}\.?\s+\d{1,2}(?:,?\s+\d{4})?`,
    ].join("|") +
    ")(?![A-Za-z0-9])",
  "gi",
);

/** Fechas dentro de un texto libre ("Periodo del 01/01/2024 al 31/01/2024"). */
export function findDatesInText(text: string): string[] {
  return [...text.matchAll(DATE_IN_TEXT)].map((match) => match[0]).filter((found) => readDateToken(found) !== null);
}
