// ¿Ya llegó el reembolso? Busca en los movimientos de Finanzas un abono de la tienda por el monto confirmado.
// Puro y determinista: el servicio le pasa los movimientos a favor recientes del usuario.
import { foldName } from "../merchants";

export interface RefundCandidate {
  id: string;
  amount: number;
  direction: "DEBIT" | "CREDIT";
  currency: string;
  merchantName: string | null;
  description: string;
  postedAt: Date;
}

const GENERIC = new Set(["tienda", "store", "shop", "online", "oficial", "hogar", "sports", "central", "the", "los", "las"]);

/** Palabras que identifican a la tienda: "CasaNova Hogar" → ["casanova"]; "Bazar Central" → ["bazar"]. */
export function merchantTokens(merchant: string): string[] {
  const words = foldName(merchant)
    .split(" ")
    .filter((w) => w.length >= 4 && !GENERIC.has(w));
  return words.length ? words : foldName(merchant).split(" ").filter((w) => w.length >= 3);
}

/** El abono que corresponde al reembolso (mismo comercio, misma moneda, monto ±1 % o ±$0.50, después del reclamo). */
export function matchRefund(
  target: { merchant: string; amount: number | null; currency: string; since: Date },
  candidates: RefundCandidate[],
): RefundCandidate | null {
  if (!target.amount || target.amount <= 0) return null;
  const tokens = merchantTokens(target.merchant);
  if (tokens.length === 0) return null;
  const tolerance = Math.max(0.5, target.amount * 0.01);
  const matches = candidates.filter((tx) => {
    if (tx.direction !== "CREDIT" || tx.currency !== target.currency) return false;
    if (tx.postedAt.getTime() < target.since.getTime()) return false;
    if (Math.abs(tx.amount - target.amount!) > tolerance) return false;
    const text = foldName(`${tx.merchantName ?? ""} ${tx.description}`).replace(/\s+/g, "");
    return tokens.some((token) => text.includes(token));
  });
  matches.sort((a, b) => a.postedAt.getTime() - b.postedAt.getTime());
  return matches[0] ?? null;
}
