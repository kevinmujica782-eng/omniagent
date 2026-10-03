// Fechas, horas, montos y referencias en texto en español ("a más tardar el miércoles 30 de septiembre",
// "vence el 05/10/2026", "a las 6 p. m."). Es el respaldo sin IA de la detección de trámites. Puro.
import { addLocalDays, localParts, startOfLocalDay, zonedToUtc } from "./tz";

export const MONTH_NAMES = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];
export const WEEKDAY_NAMES = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

const MONTHS: Record<string, number> = {
  enero: 1, ene: 1, febrero: 2, feb: 2, marzo: 3, mar: 3, abril: 4, abr: 4, mayo: 5, may: 5, junio: 6, jun: 6,
  julio: 7, jul: 7, agosto: 8, ago: 8, septiembre: 9, setiembre: 9, sept: 9, sep: 9, set: 9, octubre: 10, oct: 10,
  noviembre: 11, nov: 11, diciembre: 12, dic: 12,
};
const WEEKDAYS: Record<string, number> = {
  domingo: 0, lunes: 1, martes: 2, miércoles: 3, miercoles: 3, jueves: 4, viernes: 5, sábado: 6, sabado: 6,
};

const MONTH_RE = "enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre|ene|feb|mar|abr|may|jun|jul|ago|sept|sep|set|oct|nov|dic";
const WEEKDAY_RE = "lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo";

const DEADLINE_CUES = /(antes del?|a m[aá]s tardar|fecha l[ií]mite|l[ií]mite|vencimiento|vence|vencen|hasta el|tienes hasta|tiene hasta|plazo|entregar|entr[eé]guelo|devolver|devu[eé]lvanlo|devolverlo|enviarlo|pagar antes)\s*(el|la|del|:)?\s*$/i;
const EVENT_CUES = /(cita|consulta|reuni[oó]n|excursi[oó]n|evento|clase|taller|ceremonia|salida|visita|te esperamos|los esperamos|ser[aá] el|se realizar[aá]|haremos|quedó para|quedo para|inicia|comienza|función|funci[oó]n|partido|vacunaci[oó]n|jornada)/i;

export type DateRole = "deadline" | "event" | "other";

export interface DateMention {
  index: number;
  text: string;
  date: Date;
  hasTime: boolean;
  endDate: Date | null;
  role: DateRole;
}

interface RawDate {
  index: number;
  length: number;
  text: string;
  year: number;
  month: number;
  day: number;
}

function validDay(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

/** Año más probable para "2 de octubre" sin año: el de la fecha de referencia, o el siguiente si ya pasó hace rato. */
function inferYear(month: number, day: number, ref: Date, timeZone: string): number {
  const p = localParts(ref, timeZone);
  const candidate = Date.UTC(p.year, month - 1, day);
  const refDay = Date.UTC(p.year, p.month - 1, p.day);
  return candidate < refDay - 60 * 86_400_000 ? p.year + 1 : p.year;
}

/** ¿Termina una oración en la posición i? "3.º B", "p. m.", "$12.00" y "Dra. Méndez" no cortan. */
function isBoundary(text: string, i: number): boolean {
  const c = text[i];
  if (c === "\n" || c === "!" || c === "?") return true;
  if (c !== ".") return false;
  const next = text[i + 1];
  if (next === undefined || next === "\n") return true;
  if (!/\s/.test(next)) return false;
  const after = text.slice(i + 1).trimStart()[0];
  const word = /(\S+)$/.exec(text.slice(0, i))?.[1] ?? "";
  if (/^(dra?|sra?|srta|av|ing|lic|p|a|m|no|n)$/i.test(word)) return false;
  return after === undefined || /[A-ZÁÉÍÓÚÑ¿¡"“(]/.test(after);
}

function sentenceBounds(text: string, index: number): { start: number; end: number } {
  let start = index;
  while (start > 0 && !isBoundary(text, start - 1)) start--;
  let end = index;
  while (end < text.length && !isBoundary(text, end)) end++;
  return { start, end };
}

interface TimeMatch {
  hour: number;
  minute: number;
  endHour: number | null;
  endMinute: number | null;
}

function to24(hour: number, meridiem: string | undefined): number {
  if (!meridiem) return hour;
  const pm = /p/i.test(meridiem);
  if (pm && hour < 12) return hour + 12;
  if (!pm && hour === 12) return 0;
  return hour;
}

const MERIDIEM = "(a\\.?\\s?m\\.?|p\\.?\\s?m\\.?)";

/** Hora (o rango) dentro de un fragmento: "a las 10:30", "de 8:00 a 14:00", "6 p. m.", "18:00 h". */
export function findTime(fragment: string): TimeMatch | null {
  const range = new RegExp(`de\\s+(\\d{1,2})(?::(\\d{2}))?\\s*${MERIDIEM}?\\s*(?:a|hasta las?)\\s+(\\d{1,2})(?::(\\d{2}))?\\s*${MERIDIEM}?`, "i").exec(fragment);
  if (range) {
    const h1 = to24(Number(range[1]), range[3] ?? range[6]);
    const h2 = to24(Number(range[4]), range[6]);
    if (h1 < 24 && h2 < 24) {
      return { hour: h1, minute: Number(range[2] ?? 0), endHour: h2, endMinute: Number(range[5] ?? 0) };
    }
  }
  const all = [...fragment.matchAll(new RegExp(`(?:a las?\\s+)?\\b(\\d{1,2})(?::(\\d{2}))\\s*${MERIDIEM}?|a las?\\s+(\\d{1,2})\\s*${MERIDIEM}?|\\b(\\d{1,2})\\s*${MERIDIEM}`, "gi"))];
  const times: { hour: number; minute: number }[] = [];
  for (const m of all) {
    let hour: number;
    let minute = 0;
    if (m[1] !== undefined) {
      hour = to24(Number(m[1]), m[3]);
      minute = Number(m[2]);
    } else if (m[4] !== undefined) {
      hour = to24(Number(m[4]), m[5]);
    } else {
      hour = to24(Number(m[6]), m[7]);
    }
    if (hour > 23 || minute > 59) continue;
    times.push({ hour, minute });
  }
  if (times.length === 0) return null;
  const [first, second] = times;
  const later = second && second.hour * 60 + second.minute > first.hour * 60 + first.minute;
  return { hour: first.hour, minute: first.minute, endHour: later ? second.hour : null, endMinute: later ? second.minute : null };
}

function rawDates(text: string, ref: Date, timeZone: string): RawDate[] {
  const found: RawDate[] = [];
  const lower = text.toLowerCase();
  const push = (index: number, length: number, year: number, month: number, day: number) => {
    if (!validDay(year, month, day)) return;
    if (found.some((f) => index < f.index + f.length && f.index < index + length)) return;
    found.push({ index, length, text: text.slice(index, index + length), year, month, day });
  };

  // "viernes 2 de octubre (de 2026)"
  for (const m of lower.matchAll(new RegExp(`(?:(?:${WEEKDAY_RE}),?\\s+)?(\\d{1,2})\\s+de\\s+(${MONTH_RE})\\b\\.?(?:\\s+(?:de|del)\\s+(\\d{4}))?`, "g"))) {
    const day = Number(m[1]);
    const month = MONTHS[m[2]];
    const year = m[3] ? Number(m[3]) : inferYear(month, day, ref, timeZone);
    push(m.index ?? 0, m[0].length, year, month, day);
  }
  // 2026-10-02
  for (const m of lower.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) {
    push(m.index ?? 0, m[0].length, Number(m[1]), Number(m[2]), Number(m[3]));
  }
  // 05/10/2026, 5-10-26, 05.10.2026 y 5/10 (día primero)
  for (const m of lower.matchAll(/\b(\d{1,2})([/.-])(\d{1,2})(?:\2(\d{2,4}))?\b/g)) {
    if (m[2] === "." && !m[4]) continue; // "8.30" es una hora o un monto
    const day = Number(m[1]);
    const month = Number(m[3]);
    let year = m[4] ? Number(m[4]) : inferYear(month, day, ref, timeZone);
    if (year < 100) year += 2000;
    push(m.index ?? 0, m[0].length, year, month, day);
  }
  // hoy, mañana, pasado mañana
  const today = localParts(ref, timeZone);
  for (const m of lower.matchAll(/\b(pasado mañana|mañana|hoy)\b/g)) {
    const index = m.index ?? 0;
    if (m[1] === "mañana" && /(la|por la|de la|en la|esta)\s+$/.test(lower.slice(Math.max(0, index - 8), index))) continue;
    const offset = m[1] === "hoy" ? 0 : m[1] === "mañana" ? 1 : 2;
    const d = new Date(Date.UTC(today.year, today.month - 1, today.day + offset));
    push(index, m[0].length, d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }
  // en 10 días, dentro de 2 semanas
  for (const m of lower.matchAll(/\b(?:en|dentro de)\s+(\d{1,3})\s+(d[ií]as|semanas?)\b/g)) {
    const n = Number(m[1]) * (m[2].startsWith("semana") ? 7 : 1);
    const d = new Date(Date.UTC(today.year, today.month - 1, today.day + n));
    push(m.index ?? 0, m[0].length, d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }
  // "el jueves", "este viernes", "el próximo lunes" (sin número de día)
  for (const m of lower.matchAll(new RegExp(`\\b(este|esta|el pr[oó]ximo|pr[oó]ximo|el)?\\s*(${WEEKDAY_RE})\\b(?!,?\\s+\\d)`, "g"))) {
    const name = m[2].normalize("NFD").replace(/[̀-ͯ]/g, "");
    const target = WEEKDAYS[name];
    if (target === undefined) continue;
    let ahead = (target - today.weekday + 7) % 7;
    if (ahead === 0 && !/^est/.test(m[1] ?? "")) ahead = 7;
    const d = new Date(Date.UTC(today.year, today.month - 1, today.day + ahead));
    const start = (m.index ?? 0) + (m[0].length - m[0].trimStart().length);
    push(start, m[0].trim().length, d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }
  return found.sort((a, b) => a.index - b.index);
}

/** Todas las fechas mencionadas, con su hora si la hay y su papel (fecha límite, evento u otra). */
export function findDateMentions(text: string, ref: Date, timeZone: string): DateMention[] {
  const mentions: DateMention[] = [];
  const raws = rawDates(text, ref, timeZone);
  for (const [i, raw] of raws.entries()) {
    const { start, end } = sentenceBounds(text, raw.index);
    const sentence = text.slice(start, end);
    const before = text.slice(Math.max(start, raw.index - 45), raw.index);
    const role: DateRole = DEADLINE_CUES.test(before) ? "deadline" : EVENT_CUES.test(sentence) ? "event" : "other";

    // Hora: en la misma oración o, para eventos, en la siguiente si no trae otra fecha.
    const afterDate = text.slice(raw.index + raw.length, end);
    let time = findTime(afterDate) ?? findTime(text.slice(start, raw.index));
    if (!time && role === "event") {
      const next = sentenceBounds(text, Math.min(text.length - 1, end + 1));
      const nextRaw = raws[i + 1];
      if (next.start > end && !(nextRaw && nextRaw.index >= next.start && nextRaw.index < next.end)) {
        time = findTime(text.slice(next.start, next.end));
      }
    }
    const date = time
      ? zonedToUtc({ year: raw.year, month: raw.month, day: raw.day, hour: time.hour, minute: time.minute }, timeZone)
      : zonedToUtc({ year: raw.year, month: raw.month, day: raw.day }, timeZone);
    const endDate =
      time && time.endHour !== null
        ? zonedToUtc({ year: raw.year, month: raw.month, day: raw.day, hour: time.endHour, minute: time.endMinute ?? 0 }, timeZone)
        : null;
    mentions.push({ index: raw.index, text: raw.text, date, hasTime: Boolean(time), endDate, role });
  }
  return mentions;
}

/** Fecha límite y evento más probables de un correo. Las fechas pasadas no cuentan como fecha límite. */
export function pickDates(mentions: DateMention[], now: Date, timeZone: string) {
  const today = startOfLocalDay(now, timeZone).getTime();
  const future = (m: DateMention) => m.date.getTime() >= today;
  const deadline = mentions.find((m) => m.role === "deadline" && future(m)) ?? null;
  const event =
    mentions.find((m) => m.role === "event" && m.hasTime && future(m)) ??
    mentions.find((m) => m.role === "event" && future(m)) ??
    null;
  return { deadline, event };
}

/** Montos: "$96.40", "USD 1,250.00", "180 dólares". */
export function findAmounts(text: string): { value: number; currency: string; index: number }[] {
  const out: { value: number; currency: string; index: number }[] = [];
  const parse = (raw: string) => {
    const cleaned = raw.replace(/\s/g, "");
    const lastSep = Math.max(cleaned.lastIndexOf("."), cleaned.lastIndexOf(","));
    const decimals = lastSep >= 0 ? cleaned.length - lastSep - 1 : 0;
    const normalized =
      lastSep >= 0 && decimals === 2
        ? cleaned.slice(0, lastSep).replace(/[.,]/g, "") + "." + cleaned.slice(lastSep + 1)
        : cleaned.replace(/[.,]/g, "");
    return Number(normalized);
  };
  for (const m of text.matchAll(/(?:US\$|\$|USD\s?)\s?(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})?|\d+(?:[.,]\d{2})?)/g)) {
    const value = parse(m[1]);
    if (Number.isFinite(value) && value > 0) out.push({ value, currency: "USD", index: m.index ?? 0 });
  }
  for (const m of text.matchAll(/(\d+(?:[.,]\d{2})?)\s?(?:d[oó]lares|USD)\b/gi)) {
    const value = parse(m[1]);
    if (Number.isFinite(value) && value > 0 && !out.some((o) => Math.abs(o.index - (m.index ?? 0)) < 6)) {
      out.push({ value, currency: "USD", index: m.index ?? 0 });
    }
  }
  return out.sort((a, b) => a.index - b.index);
}

/** Número de caso, solicitud o referencia: "Número de caso: R-48213". */
export function findReference(text: string): string | null {
  const m = /(?:n[uú]mero de (?:caso|solicitud|referencia|reclamo|expediente)|caso|solicitud|referencia|reclamo|expediente|ref\.?)\s*(?:n\.?[ºo°]\s*)?[:#]?\s*([A-Z]{0,4}-?\d[\dA-Z-]{3,})/i.exec(
    text,
  );
  return m ? m[1] : null;
}

/** Lugar explícito: "Dirección: …", "Lugar: …" o "en el auditorio del colegio". */
export function findLocation(text: string): string | null {
  const explicit = /(?:direcci[oó]n|lugar|ubicaci[oó]n)\s*:\s*([^\n]{3,90})/i.exec(text);
  if (explicit) return explicit[1].replace(/[.;]\s*$/, "").trim();
  const place = /\ben (?:el|la) ((?:auditorio|sala|sal[oó]n|consultorio|acuario|museo|parque|biblioteca|gimnasio|colegio|escuela|oficina|cl[ií]nica|hospital|sede|centro)[^.,\n]{0,60})/i.exec(text);
  return place ? place[1].trim() : null;
}

/** "viernes 2 de octubre" en la zona del usuario (para textos y para el sandbox). */
export function longDate(date: Date, timeZone: string, withWeekday = true): string {
  const p = localParts(date, timeZone);
  const base = `${p.day} de ${MONTH_NAMES[p.month - 1]}`;
  return withWeekday ? `${WEEKDAY_NAMES[p.weekday]} ${base}` : base;
}

/** "7:00 p. m." en la zona del usuario. */
export function clockTime(date: Date, timeZone: string): string {
  const p = localParts(date, timeZone);
  const hour12 = p.hour % 12 === 0 ? 12 : p.hour % 12;
  return `${hour12}:${String(p.minute).padStart(2, "0")} ${p.hour < 12 ? "a. m." : "p. m."}`;
}

/** "hoy", "mañana", "el viernes 2 de octubre" respecto de `now`. */
export function relativeDay(date: Date, now: Date, timeZone: string): string {
  const a = localParts(now, timeZone);
  const b = localParts(date, timeZone);
  const diff = Math.round((Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) / 86_400_000);
  if (diff === 0) return "hoy";
  if (diff === 1) return "mañana";
  if (diff === -1) return "ayer";
  return `el ${longDate(date, timeZone)}`;
}

/** "05/10/2026". */
export function numericDate(date: Date, timeZone: string): string {
  const p = localParts(date, timeZone);
  return `${String(p.day).padStart(2, "0")}/${String(p.month).padStart(2, "0")}/${p.year}`;
}

/** Para pruebas y el sandbox: el mismo día local que `ref` + n días. */
export function dayOffset(ref: Date, days: number, timeZone: string): Date {
  return addLocalDays(startOfLocalDay(ref, timeZone), days, timeZone);
}
