// Cotización de una compra (precio, envío, cargos y tasas), límites de gasto y datos de entrega.
// Sin dependencias de servidor: la usan el checkout, la vista previa y las pruebas.
import { money } from "@/lib/format";
import type { WatchKindId } from "@/types/cards";

const round2 = (n: number) => Math.round(n * 100) / 100;

export type FeeConfig = {
  shipping: number;
  freeShippingOver: number | null;
  feePerUnit: number;
  feeLabel: string | null;
  taxRate: number;
  taxLabel: string | null;
  deliveryDays: number | null;
};

export type QuoteLine = { label: string; amount: number; note?: string | null };

export type Quote = {
  unitPrice: number;
  quantity: number;
  currency: string;
  subtotal: number;
  lines: QuoteLine[];
  total: number;
  /** Se conocen el envío y los cargos (tiendas de prueba o páginas que los publican). */
  complete: boolean;
};

export const MAX_QUANTITY = 10;

export function buildQuote(input: {
  unitPrice: number;
  quantity: number;
  currency: string;
  kind: WatchKindId;
  fees: FeeConfig | null;
  offerShipping: number | null;
}): Quote {
  const quantity = Math.max(1, Math.min(MAX_QUANTITY, Math.floor(input.quantity)));
  const subtotal = round2(input.unitPrice * quantity);
  const m = (n: number) => money(n, input.currency, { cents: true });
  const lines: QuoteLine[] = [
    { label: quantity > 1 ? `${quantity} × ${m(input.unitPrice)}` : "Precio", amount: subtotal },
  ];
  let complete = true;
  const fees = input.fees;
  if (fees) {
    if (fees.deliveryDays !== null) {
      const free = fees.freeShippingOver !== null && subtotal >= fees.freeShippingOver;
      const shipping = free ? 0 : fees.shipping;
      lines.push({ label: "Envío", amount: shipping, note: shipping === 0 ? "Gratis" : null });
    }
    if (fees.feePerUnit > 0) lines.push({ label: fees.feeLabel ?? "Cargos", amount: round2(fees.feePerUnit * quantity) });
    if (fees.taxRate > 0) lines.push({ label: fees.taxLabel ?? "Impuestos", amount: round2(subtotal * fees.taxRate) });
  } else if (input.offerShipping !== null) {
    lines.push({ label: "Envío", amount: input.offerShipping, note: input.offerShipping === 0 ? "Gratis" : null });
  } else {
    complete = false;
  }
  const total = round2(lines.reduce((sum, line) => sum + line.amount, 0));
  return { unitPrice: input.unitPrice, quantity, currency: input.currency, subtotal, lines, total, complete };
}

export const DEFAULT_LIMITS = { perOrder: 500, monthly: 1000 };

export type LimitCheck = { ok: true } | { ok: false; reason: "per_order" | "monthly"; message: string };

/** Topes de gasto: por compra y por mes (en la moneda del usuario). */
export function checkLimits(
  total: number,
  limits: { perOrder: number; monthly: number; spentThisMonth: number; currency: string },
): LimitCheck {
  const m = (n: number) => money(n, limits.currency, { cents: true });
  if (total > limits.perOrder) {
    return {
      ok: false,
      reason: "per_order",
      message: `El total (${m(total)}) supera tu límite por compra de ${m(limits.perOrder)}. Puedes subirlo en Compras → Pago y límites.`,
    };
  }
  const remaining = round2(limits.monthly - limits.spentThisMonth);
  if (total > remaining) {
    return {
      ok: false,
      reason: "monthly",
      message: `Con esta compra pasarías tu límite mensual de ${m(limits.monthly)} (te quedan ${m(Math.max(0, remaining))}). Puedes subirlo en Compras → Pago y límites.`,
    };
  }
  return { ok: true };
}

export function addBusinessDays(date: Date, days: number): Date {
  const out = new Date(date.getTime());
  let added = 0;
  while (added < days) {
    out.setUTCDate(out.getUTCDate() + 1);
    const weekday = out.getUTCDay();
    if (weekday !== 0 && weekday !== 6) added++;
  }
  return out;
}

export type DeliveryPlan = { label: string; detail: string | null; eta: Date | null };

export function deliveryFor(kind: WatchKindId, fees: FeeConfig | null, now: Date, address: string | null): DeliveryPlan | null {
  switch (kind) {
    case "EVENT_TICKET":
      return { label: "Entradas digitales", detail: "Llegan a tu correo y quedan guardadas en Compras.", eta: null };
    case "FLIGHT":
      return { label: "Reserva de vuelo", detail: "En una compra real se piden los datos de cada pasajero.", eta: null };
    case "HOTEL":
      return { label: "Reserva de hotel", detail: "Confirmación inmediata a tu nombre.", eta: null };
    case "PRODUCT":
    case "OTHER": {
      const eta = fees?.deliveryDays ? addBusinessDays(now, fees.deliveryDays) : null;
      return {
        label: "Envío a domicilio",
        detail: address ? `A ${address}` : "A la dirección que tengas guardada en la tienda",
        eta,
      };
    }
  }
}

/** Número de pedido legible y estable: "SMX-7F3K2Q". */
export function orderNumber(prefix: string, seed: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${prefix}-${h.toString(36).toUpperCase().padStart(6, "0").slice(-6)}`;
}
