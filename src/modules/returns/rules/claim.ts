// Mensajes para la tienda: el reclamo según lo que pasó y lo que se pide, los seguimientos si no responde y los
// pasos para escalar. Solo usan datos del pedido y lo que escribió el usuario: nada se inventa (ni montos, ni
// fechas, ni políticas). Puras y deterministas: el usuario revisa el texto antes de enviarlo.
import { money } from "@/lib/format";
import { REASON_LABEL } from "@/lib/returns-copy";
import { longDate } from "@/modules/procedures/time/es-dates";
import type { ReturnOutcomeId, ReturnReasonId } from "@/types/cards";
import { CARD_DISPUTE_STEP, type MerchantInfo } from "../merchants";

export interface ClaimContext {
  merchant: string;
  orderNumber: string | null;
  title: string;
  orderedAt: Date;
  expectedBy: Date | null;
  deliveredAt: Date | null;
  total: number | null;
  currency: string;
  reason: ReturnReasonId;
  desired: ReturnOutcomeId;
  details: string | null;
  userName: string | null;
  now: Date;
  timeZone: string;
}

export type DraftedMessage = { subject: string; body: string };

export const MAX_DETAILS = 600;

/** Lo que escribió el usuario, limpio: sin espacios de más y con un tope de largo. */
export function cleanDetails(text: string | null | undefined): string | null {
  if (!text) return null;
  const cleaned = text
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!cleaned) return null;
  return cleaned.length > MAX_DETAILS ? `${cleaned.slice(0, MAX_DETAILS - 1).trimEnd()}…` : cleaned;
}

const SUBJECT_TAIL: Record<ReturnReasonId, string> = {
  LATE: "no ha llegado",
  NOT_RECEIVED: "no lo recibí",
  DAMAGED: "llegó dañado",
  WRONG_ITEM: "llegó un producto distinto",
  NOT_AS_DESCRIBED: "no corresponde a la descripción",
  CHANGED_MIND: "solicitud de devolución",
};

function shortTitle(title: string): string {
  return title.length > 40 ? `${title.slice(0, 39).trimEnd()}…` : title;
}

export function claimSubject(ctx: Pick<ClaimContext, "orderNumber" | "title" | "reason">): string {
  const which = ctx.orderNumber ? `Pedido ${ctx.orderNumber}` : `Mi pedido de ${shortTitle(ctx.title)}`;
  return `${which}: ${SUBJECT_TAIL[ctx.reason]}`;
}

function problemSentence(ctx: ClaimContext): string {
  const day = (date: Date) => longDate(date, ctx.timeZone);
  switch (ctx.reason) {
    case "LATE":
      // Sin contar los días de atraso: el texto puede aprobarse días después y la fecha ya lo dice.
      return ctx.expectedBy
        ? `La entrega estaba prometida para el ${day(ctx.expectedBy)} y todavía no lo recibo.`
        : "Todavía no lo recibo y no tengo noticias del envío.";
    case "NOT_RECEIVED":
      if (ctx.deliveredAt) return `Figura como entregado el ${day(ctx.deliveredAt)}, pero no lo recibí.`;
      if (ctx.expectedBy) return `Debía llegar el ${day(ctx.expectedBy)} y nunca lo recibí.`;
      return "No lo recibí.";
    case "DAMAGED":
      return "El producto llegó dañado o no funciona.";
    case "WRONG_ITEM":
      return "Recibí un producto distinto al que pedí.";
    case "NOT_AS_DESCRIBED":
      return "El producto no corresponde a lo que describía el anuncio.";
    case "CHANGED_MIND":
      return ctx.deliveredAt
        ? `Lo recibí el ${day(ctx.deliveredAt)} y quisiera devolverlo dentro del plazo de devolución.`
        : "Quisiera devolverlo dentro del plazo de devolución.";
  }
}

function requestSentence(ctx: ClaimContext): string {
  const total = ctx.total ? money(ctx.total, ctx.currency, { cents: true }) : null;
  switch (ctx.desired) {
    case "REFUND":
      return `Les pido el reembolso completo${total ? ` de ${total}` : ""} al mismo medio de pago.`;
    case "REPLACEMENT":
      return ctx.reason === "WRONG_ITEM"
        ? "Les pido que me envíen el producto correcto sin costo."
        : "Les pido que me envíen uno nuevo sin costo.";
    case "STORE_CREDIT":
      return `Acepto saldo a favor por el monto total${total ? ` (${total})` : ""}.`;
    case "ARRIVED":
      return "Les pido que me confirmen dónde está el pedido y una nueva fecha de entrega. Si no puede llegar pronto, prefiero el reembolso completo.";
  }
}

const PHYSICAL_RETURN: ReturnReasonId[] = ["DAMAGED", "WRONG_ITEM", "NOT_AS_DESCRIBED", "CHANGED_MIND"];

function signature(userName: string | null): string {
  return userName ? `Quedo pendiente de su respuesta. Gracias.\n${userName}` : "Quedo pendiente de su respuesta. Gracias.";
}

export function draftClaim(ctx: ClaimContext): DraftedMessage {
  const placed = longDate(ctx.orderedAt, ctx.timeZone, false);
  const total = ctx.total ? ` por ${money(ctx.total, ctx.currency, { cents: true })}` : "";
  const which = ctx.orderNumber ? `mi pedido ${ctx.orderNumber} (${ctx.title})` : `mi pedido de ${ctx.title}`;
  const paragraphs = [
    `Hola, equipo de ${ctx.merchant}:`,
    `Les escribo por ${which}, hecho el ${placed}${total}.`,
    problemSentence(ctx),
    ...(ctx.details ? [ctx.details] : []),
    [
      requestSentence(ctx),
      ...(PHYSICAL_RETURN.includes(ctx.reason) ? ["Si hay que devolver el producto, por favor envíenme la etiqueta o las instrucciones."] : []),
      ...(ctx.reason === "DAMAGED" || ctx.reason === "WRONG_ITEM" ? ["Puedo enviarles fotos si las necesitan."] : []),
    ].join(" "),
    signature(ctx.userName),
  ];
  return { subject: claimSubject(ctx), body: paragraphs.join("\n\n") };
}

/** Seguimiento n.º `number` (1 o 2) cuando la tienda no responde. */
export function draftFollowUp(
  ctx: Pick<ClaimContext, "merchant" | "orderNumber" | "title" | "reason" | "userName" | "timeZone"> & {
    number: number;
    firstSentAt: Date;
    subject: string;
  },
): DraftedMessage {
  const which = ctx.orderNumber ? `mi pedido ${ctx.orderNumber}` : `mi pedido de ${ctx.title}`;
  const paragraphs = [
    `Hola, equipo de ${ctx.merchant}:`,
    `El ${longDate(ctx.firstSentAt, ctx.timeZone)} les escribí por ${which} (${REASON_LABEL[ctx.reason].toLowerCase()}) y todavía no tengo respuesta. ¿Me pueden confirmar cómo sigue mi caso?`,
    ...(ctx.number >= 2
      ? ["Es mi segundo mensaje. Si no es posible resolverlo, tendré que pedir ayuda a la plataforma donde compré o a mi banco."]
      : []),
    signature(ctx.userName),
  ];
  const base = ctx.subject.replace(/^(Seguimiento:\s*)+/i, "");
  return { subject: `Seguimiento: ${base}`, body: paragraphs.join("\n\n") };
}

/** Qué hacer si la tienda no responde o rechaza el reclamo: plataforma, banco y protección al consumidor. */
export function escalationSteps(merchant: MerchantInfo | null): string[] {
  return [
    ...(merchant?.escalation ? [merchant.escalation] : []),
    CARD_DISPUTE_STEP,
    "También puedes presentar una queja ante la oficina de protección al consumidor de tu país con el número de pedido y los correos.",
  ];
}

/** Resumen del caso para copiar (banco, plataforma o una queja). */
export function caseSummary(ctx: {
  merchant: string;
  orderNumber: string | null;
  title: string;
  orderedAt: Date;
  total: number | null;
  currency: string;
  reason: ReturnReasonId;
  sentAt: Date | null;
  followUps: number;
  timeZone: string;
}): string {
  const parts = [
    `Compra en ${ctx.merchant}${ctx.orderNumber ? `, pedido ${ctx.orderNumber}` : ""}: ${ctx.title}, del ${longDate(ctx.orderedAt, ctx.timeZone, false)}${ctx.total ? ` por ${money(ctx.total, ctx.currency, { cents: true })}` : ""}.`,
    `Motivo: ${REASON_LABEL[ctx.reason].toLowerCase()}.`,
  ];
  if (ctx.sentAt) {
    parts.push(
      `Reclamé a la tienda el ${longDate(ctx.sentAt, ctx.timeZone, false)}${ctx.followUps > 0 ? ` y envié ${ctx.followUps} ${ctx.followUps === 1 ? "seguimiento" : "seguimientos"}` : ""} sin una solución.`,
    );
  }
  return parts.join(" ");
}
