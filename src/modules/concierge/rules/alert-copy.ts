// Texto de las alertas inteligentes por reglas (siempre disponible). La versión con Claude y su validación están en
// alert-ai.ts. Sin dependencias de servidor ni de zod: también lo usa la vista previa en el navegador.
import { money } from "@/lib/format";
import type { WatchKindId } from "@/types/cards";
import type { AlertReason } from "./drops";

export type AlertFacts = {
  title: string;
  merchant: string | null;
  kind: WatchKindId;
  currency: string;
  price: number;
  previousPrice: number | null;
  referencePrice: number | null;
  referenceKind: "median30" | "previous" | null;
  dropPct: number | null;
  lowestBefore: number | null;
  isLowest: boolean;
  hitsTarget: boolean;
  targetPrice: number | null;
  reasons: AlertReason[];
  inStock: boolean | null;
  stockCount: number | null;
  daysTracked: number;
  /** Precios diarios recientes (para que Claude vea la tendencia). */
  recent: number[];
  verdict: "buy" | "wait";
};

export type AlertText = { headline: string; summary: string; verdict: "buy" | "wait" };

const UNIT: Partial<Record<WatchKindId, [string, string]>> = {
  EVENT_TICKET: ["entrada", "entradas"],
  HOTEL: ["habitación", "habitaciones"],
  FLIGHT: ["asiento", "asientos"],
  PRODUCT: ["unidad", "unidades"],
};

const short = (title: string, max = 60) => (title.length <= max ? title : `${title.slice(0, max - 1).trimEnd()}…`);

/** Resumen por reglas: siempre correcto, aunque menos conversacional. */
export function rulesAlertText(f: AlertFacts): AlertText {
  const m = (n: number) => money(n, f.currency, { cents: !Number.isInteger(n) });
  const headline =
    f.reasons.includes("DROP") && f.dropPct !== null
      ? `Bajó ${f.dropPct}%: ${short(f.title)}`
      : `Llegó a tu precio: ${short(f.title)}`;
  const parts: string[] = [];
  const where = f.merchant ? ` en ${f.merchant}` : "";
  if (f.referencePrice !== null && f.referenceKind === "median30") {
    parts.push(`Ahora cuesta ${m(f.price)}${where}; lo normal en los últimos 30 días fue ${m(f.referencePrice)}.`);
  } else if (f.previousPrice !== null) {
    parts.push(`Ahora cuesta ${m(f.price)}${where}; antes costaba ${m(f.previousPrice)}.`);
  } else {
    parts.push(`Ahora cuesta ${m(f.price)}${where}.`);
  }
  if (f.isLowest) parts.push("Es el precio más bajo desde que lo sigo.");
  else if (f.lowestBefore !== null && f.lowestBefore < f.price) parts.push(`Llegó a estar en ${m(f.lowestBefore)}.`);
  if (f.hitsTarget && f.targetPrice !== null) parts.push(`Está por debajo de tu objetivo de ${m(f.targetPrice)}.`);
  const unit = UNIT[f.kind];
  if (f.stockCount !== null && f.stockCount <= 20 && unit) parts.push(`Quedan ${f.stockCount} ${f.stockCount === 1 ? unit[0] : unit[1]}.`);
  parts.push(f.verdict === "buy" ? "Si lo quieres, es buen momento." : "Si no te urge, puede bajar más.");
  return { headline, summary: parts.join(" "), verdict: f.verdict };
}

/**
 * Motivo corto de una compra que viene de una alerta, para la ficha de aprobación (que ya muestra el nombre):
 * "Bajó 24% frente a lo normal ($327)." o "Llegó a tu objetivo de $260.".
 */
export function purchaseReason(a: {
  dropPct: number | null;
  referencePrice: number | null;
  reasons: string[];
  targetPrice: number | null;
  currency: string;
}): string | null {
  const m = (n: number) => money(n, a.currency, { cents: !Number.isInteger(n) });
  if (a.reasons.includes("DROP") && a.dropPct !== null && a.referencePrice !== null) {
    return `Bajó ${a.dropPct}% frente a lo normal (${m(a.referencePrice)}).`;
  }
  if (a.reasons.includes("TARGET") && a.targetPrice !== null) return `Llegó a tu objetivo de ${m(a.targetPrice)}.`;
  return null;
}

/** Ahorro por unidad frente a la referencia (se le da al modelo para que no lo calcule él). */
export function savingsOf(f: AlertFacts): number | null {
  return f.referencePrice !== null && f.referencePrice > f.price ? Math.round((f.referencePrice - f.price) * 100) / 100 : null;
}
