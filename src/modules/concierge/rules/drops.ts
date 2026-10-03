// ¿Esta lectura es una bajada drástica? Reglas puras (sin servidor) para el agente de precios.
// - La referencia es la mediana de los últimos 30 días: un "descuento" justo después de subir el precio no cuenta.
// - Avisa si baja al menos el % que eligió el usuario frente a la referencia, o si llega a su precio objetivo.
// - No repite el aviso por la misma bajada: solo si baja otro 5% o si el precio se recuperó y volvió a caer.
// - Agotado o en otra moneda: no avisa. Una bajada de más del 60% se confirma con una segunda lectura.

const DAY = 86_400_000;
export const REFERENCE_WINDOW_DAYS = 30;
export const SUSPICIOUS_DROP_PCT = 60;
const REALERT_EXTRA_DROP = 0.05;
const ALERT_MEMORY_DAYS = 14;

export type HistoryPoint = { price: number; at: Date; inStock: boolean | null };
export type AlertReason = "DROP" | "TARGET" | "LOWEST";

export interface DropInput {
  now: Date;
  price: number;
  currency: string;
  itemCurrency: string;
  inStock: boolean | null;
  /** Lecturas anteriores (sin la actual), en cualquier orden. */
  history: HistoryPoint[];
  targetPrice: number | null;
  dropAlertPct: number;
  lastAlert: { price: number; at: Date } | null;
  /** La bajada sospechosa ya se confirmó con una segunda lectura. */
  confirmed?: boolean;
}

export interface DropAnalysis {
  referencePrice: number | null;
  referenceKind: "median30" | "previous" | null;
  previousPrice: number | null;
  /** Bajada frente a la referencia, en % entero (negativo si subió). */
  dropPct: number | null;
  /** Cambio frente a la lectura anterior, en %. */
  changePct: number | null;
  /** Mínimo antes de esta lectura. */
  lowestBefore: number | null;
  isLowest: boolean;
  hitsTarget: boolean;
  reasons: AlertReason[];
  shouldAlert: boolean;
  suppressed: null | "out_of_stock" | "currency_mismatch" | "already_alerted" | "needs_confirmation";
  suspicious: boolean;
  verdict: "buy" | "wait";
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round(((sorted[mid - 1] + sorted[mid]) / 2) * 100) / 100;
}

/** Un precio por día (el último de cada día UTC), para la referencia y la minigráfica. */
export function dailyCloses(points: HistoryPoint[]): HistoryPoint[] {
  const byDay = new Map<string, HistoryPoint>();
  for (const point of [...points].sort((a, b) => a.at.getTime() - b.at.getTime())) {
    byDay.set(point.at.toISOString().slice(0, 10), point);
  }
  return [...byDay.values()];
}

export function referenceOf(history: HistoryPoint[], now: Date): { price: number | null; kind: "median30" | "previous" | null } {
  const recent = dailyCloses(history.filter((p) => p.at.getTime() >= now.getTime() - REFERENCE_WINDOW_DAYS * DAY && p.inStock !== false));
  if (recent.length >= 3) return { price: median(recent.map((p) => p.price)), kind: "median30" };
  const previous = [...history].sort((a, b) => b.at.getTime() - a.at.getTime())[0];
  return previous ? { price: previous.price, kind: "previous" } : { price: null, kind: null };
}

const pct = (from: number, to: number) => Math.round(((from - to) / from) * 100);

export function analyzeReading(input: DropInput): DropAnalysis {
  const sorted = [...input.history].sort((a, b) => b.at.getTime() - a.at.getTime());
  const previousPrice = sorted[0]?.price ?? null;
  const reference = referenceOf(input.history, input.now);
  const lowestBefore = input.history.length ? Math.min(...input.history.map((p) => p.price)) : null;
  const dropPct = reference.price ? pct(reference.price, input.price) : null;
  const changePct = previousPrice ? -pct(previousPrice, input.price) : null;
  const isLowest = lowestBefore !== null && input.history.length >= 2 && input.price < lowestBefore;
  const hitsTarget = input.targetPrice !== null && input.price <= input.targetPrice;

  const reasons: AlertReason[] = [];
  if (dropPct !== null && dropPct >= input.dropAlertPct) reasons.push("DROP");
  if (hitsTarget) reasons.push("TARGET");
  if (isLowest && reasons.length > 0) reasons.push("LOWEST");

  const verdict: "buy" | "wait" = lowestBefore !== null && lowestBefore < input.price * 0.95 && !hitsTarget ? "wait" : "buy";
  const base = { referencePrice: reference.price, referenceKind: reference.kind, previousPrice, dropPct, changePct, lowestBefore, isLowest, hitsTarget, reasons, verdict };
  const trigger = reasons.includes("DROP") || reasons.includes("TARGET");
  const suspicious = dropPct !== null && dropPct >= SUSPICIOUS_DROP_PCT;

  if (!trigger) return { ...base, shouldAlert: false, suppressed: null, suspicious };
  if (input.currency !== input.itemCurrency) return { ...base, shouldAlert: false, suppressed: "currency_mismatch", suspicious };
  if (input.inStock === false) return { ...base, shouldAlert: false, suppressed: "out_of_stock", suspicious };

  if (input.lastAlert && input.now.getTime() - input.lastAlert.at.getTime() < ALERT_MEMORY_DAYS * DAY) {
    const muchCheaper = input.price <= input.lastAlert.price * (1 - REALERT_EXTRA_DROP);
    // ¿El precio se recuperó (volvió por encima del aviso) después de avisar? Entonces es una bajada nueva.
    const recovered = input.history.some(
      (p) => p.at.getTime() > input.lastAlert!.at.getTime() && p.price > input.lastAlert!.price * (1 + REALERT_EXTRA_DROP),
    );
    if (!muchCheaper && !recovered) return { ...base, shouldAlert: false, suppressed: "already_alerted", suspicious };
  }
  if (suspicious && !input.confirmed) return { ...base, shouldAlert: false, suppressed: "needs_confirmation", suspicious };
  return { ...base, shouldAlert: true, suppressed: null, suspicious };
}
