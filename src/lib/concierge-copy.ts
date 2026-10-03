// Textos compartidos del módulo de compras (sin dependencias de servidor).
import { money } from "@/lib/format";
import type { PriceMethodId, TrackedItemView, WatchKindId } from "@/types/cards";

export const KIND_LABEL: Record<WatchKindId, string> = {
  PRODUCT: "Producto",
  EVENT_TICKET: "Boletos",
  FLIGHT: "Vuelo",
  HOTEL: "Hotel",
  OTHER: "Otro",
};

export const METHOD_LABEL: Record<PriceMethodId, string> = {
  jsonld: "Datos de la tienda",
  microdata: "Datos de la tienda",
  meta: "Datos de la tienda",
  ai: "Leído con IA",
  manual: "Sin enlace",
};

/** Sensibilidades que ofrece la interfaz: cuánto tiene que bajar frente a lo normal para avisar. */
export const SENSITIVITY_OPTIONS = [
  { pct: 10, label: "10%", hint: "Te aviso más seguido" },
  { pct: 15, label: "15%", hint: "Recomendado" },
  { pct: 25, label: "25%", hint: "Solo bajadas grandes" },
];

export const MAX_QUANTITY = 10;

/** "Entradas", "Noches"... para el selector de cantidad. */
export function quantityLabel(kind: WatchKindId): string {
  switch (kind) {
    case "EVENT_TICKET":
      return "Entradas";
    case "FLIGHT":
      return "Pasajeros";
    case "HOTEL":
      return "Habitaciones";
    default:
      return "Unidades";
  }
}

/** "−24%", "+5%", "=" (versión corta para listas). */
export function changeShort(pct: number | null): string | null {
  if (pct === null) return null;
  if (pct === 0) return "Sin cambio";
  return `${pct < 0 ? "−" : "+"}${Math.abs(pct)}%`;
}

/** "−24% vs. lo normal", "+5% vs. lo normal", "Igual que lo normal". */
export function changeText(pct: number | null): string | null {
  if (pct === null) return null;
  if (pct === 0) return "Igual que lo normal";
  return `${pct < 0 ? "−" : "+"}${Math.abs(pct)}% vs. lo normal`;
}

function sameLocalDay(a: Date, b: Date, timeZone: string): boolean {
  const f = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  try {
    return f(a) === f(b);
  } catch {
    return a.toDateString() === b.toDateString();
  }
}

function clock(date: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("es-US", { hour: "numeric", minute: "2-digit", timeZone })
      .format(date)
      .replace(/\s?([ap])\.\s?m\./i, (_m, p: string) => ` ${p.toLowerCase()}. m.`);
  } catch {
    return date.toISOString().slice(11, 16);
  }
}

/** "hoy 3:00 p. m.", "mañana 8:15 a. m.", "el 4 oct". */
export function whenText(iso: string, now: Date, timeZone: string): string {
  const date = new Date(iso);
  if (sameLocalDay(date, now, timeZone)) return `hoy ${clock(date, timeZone)}`;
  const tomorrow = new Date(now.getTime() + 86_400_000);
  if (sameLocalDay(date, tomorrow, timeZone)) return `mañana ${clock(date, timeZone)}`;
  const yesterday = new Date(now.getTime() - 86_400_000);
  if (sameLocalDay(date, yesterday, timeZone)) return `ayer ${clock(date, timeZone)}`;
  try {
    return `el ${new Intl.DateTimeFormat("es-US", { day: "numeric", month: "short", timeZone }).format(date)}`;
  } catch {
    return iso.slice(0, 10);
  }
}

/** Línea de estado bajo cada seguimiento. */
export function statusLine(item: TrackedItemView, now: Date, timeZone: string): string {
  if (item.status === "PURCHASED") return "Comprado";
  if (item.health === "blocked") return "La tienda no permite revisiones automáticas";
  if (item.status === "PAUSED") return item.health === "paused" ? "Pausado tras varios errores" : "Pausado";
  if (item.source === "manual") return "Sin enlace: no se revisa solo";
  if (item.health === "failing") return "No pude leer la página; sigo intentando";
  if (item.health === "retrying") return "Reintento pronto";
  return item.nextCheckAt ? `Próxima revisión: ${whenText(item.nextCheckAt, now, timeZone)}` : "Revisión programada";
}

/** Versión corta de statusLine para las filas de la lista (cabe junto a la tienda en un teléfono). */
export function rowStatus(item: TrackedItemView, now: Date, timeZone: string): string {
  if (item.status === "PURCHASED") return "Comprado";
  if (item.health === "blocked") return "La tienda no lo permite";
  if (item.status === "PAUSED") return "Pausado";
  if (item.source === "manual") return "Sin enlace";
  if (item.health === "failing") return "No pude leer la página";
  if (item.health === "retrying") return "Reintento pronto";
  return item.nextCheckAt ? `Revisa ${whenText(item.nextCheckAt, now, timeZone)}` : "Revisión programada";
}

/** "Cada hora", "Una vez al día". */
export function frequencyText(minutes: number): string {
  if (minutes <= 60) return "cada hora";
  if (minutes >= 1440) return "una vez al día";
  return `cada ${Math.round(minutes / 60)} horas`;
}

/** Texto de la regla de aviso: "Te aviso si baja 15% o llega a $260". */
export function ruleText(dropAlertPct: number, target: number | null, currency: string): string {
  return target !== null
    ? `Te aviso si baja ${dropAlertPct}% frente a lo normal o si llega a ${money(target, currency)}`
    : `Te aviso si baja ${dropAlertPct}% frente a lo normal`;
}

/** ¿Parece un enlace (y no una búsqueda)? */
export function looksLikeUrl(text: string): boolean {
  const t = text.trim();
  return /^https?:\/\//i.test(t) || /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(t);
}
