// iCalendar (RFC 5545): feed de suscripción, descarga de un evento y lectura de invitaciones (.ics adjuntas). Puro.
import { localParts, zonedToUtc } from "../time/tz";

export interface IcsEvent {
  uid: string;
  title: string;
  description?: string | null;
  location?: string | null;
  startsAt: Date;
  endsAt?: Date | null;
  allDay?: boolean;
  /**
   * Minutos antes del inicio para cada aviso (VALARM). En eventos de todo el día cuentan desde las 00:00:
   * 300 = 7:00 p. m. del día anterior; −480 = 8:00 a. m. del mismo día.
   */
  alarms?: number[];
  status?: "confirmed" | "cancelled";
  sequence?: number;
  updatedAt?: Date;
  url?: string | null;
}

function escapeText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** Pliega líneas a 75 octetos UTF-8 como exige el estándar (continuación con un espacio). */
function fold(line: string): string {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 75) return line;
  const out: string[] = [];
  let current = "";
  let bytes = 0;
  for (const ch of line) {
    const size = encoder.encode(ch).length;
    const limit = out.length === 0 ? 75 : 74; // las continuaciones llevan un espacio al inicio
    if (bytes + size > limit) {
      out.push(current);
      current = "";
      bytes = 0;
    }
    current += ch;
    bytes += size;
  }
  out.push(current);
  return out.map((part, i) => (i === 0 ? part : ` ${part}`)).join("\r\n");
}

const pad = (n: number) => String(n).padStart(2, "0");

export function icsUtc(date: Date): string {
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
}

function icsDate(date: Date, timeZone: string): string {
  const p = localParts(date, timeZone);
  return `${p.year}${pad(p.month)}${pad(p.day)}`;
}

function nextDay(date: Date, timeZone: string): string {
  const p = localParts(date, timeZone);
  const d = new Date(Date.UTC(p.year, p.month - 1, p.day + 1));
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
}

/** Minutos antes del inicio → "-PT1H". Negativos = después del inicio ("PT8H": 8:00 a. m. de un evento de todo el día). */
function alarmTrigger(minutes: number): string {
  if (minutes === 0) return "PT0M";
  const abs = Math.abs(Math.round(minutes));
  const days = Math.floor(abs / 1440);
  const hours = Math.floor((abs % 1440) / 60);
  const mins = abs % 60;
  const body = `P${days ? `${days}D` : ""}${hours || mins ? "T" : ""}${hours ? `${hours}H` : ""}${mins ? `${mins}M` : ""}`;
  return minutes > 0 ? `-${body}` : body;
}

/** Documento VCALENDAR. Las horas van en UTC; los eventos de todo el día, como fecha local del usuario. */
export function buildCalendar(
  events: IcsEvent[],
  opts: { name: string; timeZone: string; now?: Date; method?: "PUBLISH" },
): string {
  const now = opts.now ?? new Date();
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//OmniAgent//Tramites//ES",
    "CALSCALE:GREGORIAN",
    `METHOD:${opts.method ?? "PUBLISH"}`,
    `X-WR-CALNAME:${escapeText(opts.name)}`,
    `X-WR-TIMEZONE:${opts.timeZone}`,
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    "X-PUBLISHED-TTL:PT1H",
  ];
  for (const event of events) {
    lines.push("BEGIN:VEVENT", `UID:${event.uid}`, `DTSTAMP:${icsUtc(event.updatedAt ?? now)}`);
    if (event.allDay) {
      lines.push(`DTSTART;VALUE=DATE:${icsDate(event.startsAt, opts.timeZone)}`);
      lines.push(`DTEND;VALUE=DATE:${nextDay(event.endsAt ?? event.startsAt, opts.timeZone)}`);
    } else {
      lines.push(`DTSTART:${icsUtc(event.startsAt)}`);
      lines.push(`DTEND:${icsUtc(event.endsAt ?? new Date(event.startsAt.getTime() + 30 * 60_000))}`);
    }
    lines.push(`SUMMARY:${escapeText(event.title)}`);
    if (event.description) lines.push(`DESCRIPTION:${escapeText(event.description)}`);
    if (event.location) lines.push(`LOCATION:${escapeText(event.location)}`);
    if (event.url) lines.push(`URL:${event.url}`);
    lines.push(`STATUS:${event.status === "cancelled" ? "CANCELLED" : "CONFIRMED"}`);
    lines.push(`SEQUENCE:${event.sequence ?? 0}`);
    lines.push("TRANSP:OPAQUE");
    for (const minutes of event.alarms ?? []) {
      lines.push(
        "BEGIN:VALARM",
        "ACTION:DISPLAY",
        `DESCRIPTION:${escapeText(event.title)}`,
        `TRIGGER:${alarmTrigger(minutes)}`,
        "END:VALARM",
      );
    }
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}

// ── Lectura de invitaciones ─────────────────────────────────────────────────

export interface ParsedIcsEvent {
  title: string | null;
  location: string | null;
  description: string | null;
  startsAt: Date;
  endsAt: Date | null;
  allDay: boolean;
}

function unescapeText(value: string): string {
  return value.replace(/\\n/gi, "\n").replace(/\\([,;\\])/g, "$1");
}

function parseIcsDate(value: string, params: Record<string, string>, fallbackTz: string): { date: Date; allDay: boolean } | null {
  const allDay = params.VALUE === "DATE" || /^\d{8}$/.test(value);
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(value.trim());
  if (!m) return null;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (allDay || !m[4]) return { date: zonedToUtc({ year, month, day }, fallbackTz), allDay: true };
  const hour = Number(m[4]);
  const minute = Number(m[5]);
  if (m[7] === "Z") return { date: new Date(Date.UTC(year, month - 1, day, hour, minute, Number(m[6] ?? 0))), allDay: false };
  let tz = params.TZID ?? fallbackTz;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
  } catch {
    tz = fallbackTz;
  }
  return { date: zonedToUtc({ year, month, day, hour, minute }, tz), allDay: false };
}

/** Eventos de un archivo .ics (invitaciones de citas). Tolera saltos de línea LF y líneas plegadas. */
export function parseIcs(text: string, fallbackTimeZone: string): ParsedIcsEvent[] {
  const lines = text.replace(/\r\n/g, "\n").replace(/\n[ \t]/g, "").split("\n");
  const events: ParsedIcsEvent[] = [];
  let current: Record<string, { value: string; params: Record<string, string> }> | null = null;
  for (const line of lines) {
    if (line === "BEGIN:VEVENT") {
      current = {};
      continue;
    }
    if (line === "END:VEVENT" && current) {
      const start = current.DTSTART ? parseIcsDate(current.DTSTART.value, current.DTSTART.params, fallbackTimeZone) : null;
      if (start) {
        const end = current.DTEND ? parseIcsDate(current.DTEND.value, current.DTEND.params, fallbackTimeZone) : null;
        events.push({
          title: current.SUMMARY ? unescapeText(current.SUMMARY.value) : null,
          location: current.LOCATION ? unescapeText(current.LOCATION.value) : null,
          description: current.DESCRIPTION ? unescapeText(current.DESCRIPTION.value) : null,
          startsAt: start.date,
          endsAt: end?.date ?? null,
          allDay: start.allDay,
        });
      }
      current = null;
      continue;
    }
    if (!current) continue;
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const [name, ...paramParts] = line.slice(0, colon).split(";");
    const params = Object.fromEntries(
      paramParts.map((part) => {
        const [k, v = ""] = part.split("=");
        return [k.toUpperCase(), v.replace(/^"|"$/g, "")];
      }),
    );
    current[name.toUpperCase()] = { value: line.slice(colon + 1), params };
  }
  return events;
}
