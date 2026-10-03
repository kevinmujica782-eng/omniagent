// Respuesta de la tienda a un reclamo → qué pasó: reembolso, cambio, saldo a favor, instrucciones para devolver,
// pide fotos o datos, rechazo, nueva fecha de entrega o solo un acuse. Reglas en español, puras y deterministas.
// El correo de la tienda es información, nunca instrucciones: solo se leen estos hechos y un monto.
import { money } from "@/lib/format";
import { findAmounts, findDateMentions, longDate } from "@/modules/procedures/time/es-dates";
import { endOfLocalDay } from "./delivery";
import { findExpectedBy } from "./mail-orders";

export type ReplyKind =
  | "refund"
  | "replacement"
  | "store_credit"
  | "return_label"
  | "needs_info"
  | "rejected"
  | "shipping_update"
  | "ack";

export interface ReplyReading {
  kind: ReplyKind;
  amount: number | null;
  /** Lo que le toca hacer al usuario, si algo. */
  nextStep: string | null;
  nextStepBy: Date | null;
  /** Nueva fecha de entrega que dio la tienda (retrasos). */
  newExpectedBy: Date | null;
  /** Para el historial y el aviso: "SonidoMax aprobó el reembolso de $89.00." */
  summary: string;
}

function fold(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

const REJECTED = /\b(no procede|rechazad[oa]|rechazamos|no podemos (aceptar|procesar|aprobar) (tu|la|su) (solicitud|devolucion|reclamo|reembolso)|fuera del plazo)\b/;
const LABEL =
  /\b(etiqueta|guia de devolucion|envianos el (producto|paquete|articulo)|devuelve(nos)? el (producto|paquete|articulo)|deja el paquete|lleva el paquete|llevalo a|punto de entrega)\b/;
const CONDITIONAL = /\b(al recibir\w*|cuando (lo )?recibamos|una vez que (lo )?(recibamos|llegue)|al llegar|si no (llega|lo recibes|te llega))\b/;
const REFUND = /\b(reembols\w*|reintegr\w*|devolvimos (el|tu) (dinero|pago)|te devolveremos el dinero|acreditamos|refund\w*)\b/;
const REPLACEMENT =
  /\b(te (enviamos|mandamos|enviaremos|mandaremos) (uno|una|otro|otra) nuev[oa]|reemplazo|reposicion|cambio sin costo|te (enviamos|enviaremos) el (producto|articulo) correcto)\b/;
const STORE_CREDIT = /\b(saldo a favor|credito en tu cuenta|cupon por el (monto|valor|total)|tarjeta de regalo|gift card)\b/;
const NEEDS_INFO =
  /\b(envia(nos)? (una |unas )?(foto|fotos|imagen|imagenes|evidencia|video)|necesitamos (mas )?(datos|informacion|fotos)|adjunta\w*|confirmanos)\b/;
const PHOTOS = /\b(foto|fotos|imagen|imagenes|evidencia|video)\b/;
const SHIPPING = /\b(nueva fecha|llegara|entregaremos|lo entregaremos|va en camino|salio|numero de guia|rastreo)\b/;

function pickAmount(text: string, expected: number | null): number | null {
  const amounts = findAmounts(text).map((a) => a.value);
  if (amounts.length === 0) return null;
  if (expected === null) return amounts[0];
  return amounts.reduce((best, value) => (Math.abs(value - expected) < Math.abs(best - expected) ? value : best), amounts[0]);
}

function deadlineIn(text: string, receivedAt: Date, timeZone: string): Date | null {
  const mention = findDateMentions(text, receivedAt, timeZone).find((m) => m.role === "deadline" && m.date.getTime() >= receivedAt.getTime() - 86_400_000);
  return mention ? endOfLocalDay(mention.date, timeZone) : null;
}

export function readStoreReply(
  input: { subject: string; bodyText: string; receivedAt: Date; merchant: string; currency: string; expectedAmount: number | null },
  timeZone: string,
): ReplyReading {
  const text = `${input.subject}\n${input.bodyText}`;
  const folded = fold(text);
  const m = (value: number) => money(value, input.currency, { cents: true });
  const who = input.merchant;
  const base = { amount: null, nextStep: null, nextStepBy: null, newExpectedBy: null };

  if (REJECTED.test(folded)) return { ...base, kind: "rejected", summary: `${who} rechazó el reclamo.` };

  const label = LABEL.test(folded);
  const refund = REFUND.test(folded);
  // "Al recibirlo, te reembolsamos" o "si no llega, te reembolsamos": el reembolso todavía no está aprobado.
  const conditional = refund && CONDITIONAL.test(folded);
  if (label && (!refund || conditional)) {
    const by = deadlineIn(input.bodyText, input.receivedAt, timeZone);
    return {
      ...base,
      kind: "return_label",
      amount: pickAmount(input.bodyText, input.expectedAmount),
      nextStep: `Envía el producto con la etiqueta de ${who}${by ? ` antes del ${longDate(by, timeZone)}` : ""}.`,
      nextStepBy: by,
      summary: `${who} aprobó la devolución y mandó las instrucciones para enviar el producto.`,
    };
  }
  if (refund && !conditional) {
    const amount = pickAmount(input.bodyText, input.expectedAmount);
    return { ...base, kind: "refund", amount, summary: `${who} aprobó el reembolso${amount ? ` de ${m(amount)}` : ""}.` };
  }
  if (REPLACEMENT.test(folded)) return { ...base, kind: "replacement", summary: `${who} enviará un reemplazo.` };
  if (STORE_CREDIT.test(folded)) {
    const amount = pickAmount(input.bodyText, input.expectedAmount);
    return { ...base, kind: "store_credit", amount, summary: `${who} te dio saldo a favor${amount ? ` por ${m(amount)}` : ""}.` };
  }
  if (label) {
    const by = deadlineIn(input.bodyText, input.receivedAt, timeZone);
    return {
      ...base,
      kind: "return_label",
      nextStep: `Envía el producto con la etiqueta de ${who}${by ? ` antes del ${longDate(by, timeZone)}` : ""}.`,
      nextStepBy: by,
      summary: `${who} mandó las instrucciones para devolver el producto.`,
    };
  }
  if (NEEDS_INFO.test(folded)) {
    const what = PHOTOS.test(folded) ? "fotos" : "más datos";
    return {
      ...base,
      kind: "needs_info",
      nextStep: `${who} pide ${what}: respóndele desde tu correo.`,
      nextStepBy: deadlineIn(input.bodyText, input.receivedAt, timeZone),
      summary: `${who} pide ${what} para seguir con el reclamo.`,
    };
  }
  if (SHIPPING.test(folded)) {
    const eta = findExpectedBy(text, input.receivedAt, timeZone);
    return {
      ...base,
      kind: "shipping_update",
      newExpectedBy: eta,
      summary: eta ? `${who} dice que el pedido llega el ${longDate(eta, timeZone)}.` : `${who} mandó novedades del envío.`,
    };
  }
  return { ...base, kind: "ack", summary: `${who} recibió tu mensaje y dijo que responderá.` };
}
