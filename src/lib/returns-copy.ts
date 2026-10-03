// Textos del módulo de pedidos y devoluciones que comparten el servidor y la interfaz (sin dependencias de servidor).
import { money, shortDate } from "@/lib/format";
import { localDayDiff } from "@/modules/procedures/time/tz";
import type { ReturnCaseStatusId, ReturnCaseView, ReturnOutcomeId, ReturnReasonId, TrackedOrderView } from "@/types/cards";

export const REASONS: ReturnReasonId[] = ["LATE", "NOT_RECEIVED", "DAMAGED", "WRONG_ITEM", "NOT_AS_DESCRIBED", "CHANGED_MIND"];

export const REASON_LABEL: Record<ReturnReasonId, string> = {
  LATE: "No ha llegado",
  NOT_RECEIVED: "No lo recibí",
  DAMAGED: "Llegó dañado o no funciona",
  WRONG_ITEM: "Llegó otro producto",
  NOT_AS_DESCRIBED: "No es como lo describían",
  CHANGED_MIND: "Ya no lo quiero",
};

export const REASON_HINT: Record<ReturnReasonId, string> = {
  LATE: "Pasó la fecha prometida y sigue sin llegar.",
  NOT_RECEIVED: "Figura entregado o se perdió, y no lo tienes.",
  DAMAGED: "Roto, golpeado, incompleto o no enciende.",
  WRONG_ITEM: "Otro producto, talla, color o cantidad.",
  NOT_AS_DESCRIBED: "Material, medidas o funciones distintas al anuncio.",
  CHANGED_MIND: "Está bien, pero quieres devolverlo dentro del plazo.",
};

export const OUTCOME_LABEL: Record<ReturnOutcomeId, string> = {
  REFUND: "Reembolso",
  REPLACEMENT: "Cambio por uno nuevo",
  STORE_CREDIT: "Saldo a favor",
  ARRIVED: "Que llegue",
};

export const CASE_STATUS_LABEL: Record<ReturnCaseStatusId, string> = {
  DRAFT: "Por enviar",
  SENT: "Esperando a la tienda",
  ANSWERED: "Falta un paso tuyo",
  RESOLVED: "Resuelto",
  REJECTED: "Rechazado",
  CLOSED: "Cerrado",
};

/** Lo que se pide por defecto según lo que pasó. */
export function defaultDesired(reason: ReturnReasonId): ReturnOutcomeId {
  return desiredOptions(reason)[0];
}

/** Qué se puede pedir en cada caso (el primero es el sugerido). */
export function desiredOptions(reason: ReturnReasonId): ReturnOutcomeId[] {
  switch (reason) {
    case "LATE":
      return ["ARRIVED", "REFUND"];
    case "WRONG_ITEM":
      return ["REPLACEMENT", "REFUND"];
    case "NOT_AS_DESCRIBED":
      return ["REFUND", "REPLACEMENT", "STORE_CREDIT"];
    case "CHANGED_MIND":
      return ["REFUND", "STORE_CREDIT"];
    default:
      return ["REFUND", "REPLACEMENT"];
  }
}

/** Motivos que tienen sentido para el estado del pedido (no se reclama un retraso de algo ya entregado). */
export function reasonsFor(order: Pick<TrackedOrderView, "delivery">): ReturnReasonId[] {
  return order.delivery === "delivered"
    ? ["DAMAGED", "WRONG_ITEM", "NOT_AS_DESCRIBED", "CHANGED_MIND", "NOT_RECEIVED"]
    : ["LATE", "NOT_RECEIVED"];
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "hoy", "mañana", "ayer" o "el 6 oct" (en la zona del usuario). */
export function dayWord(iso: string, timeZone: string, now: Date = new Date()): string {
  const diff = localDayDiff(now, new Date(iso), timeZone);
  if (diff === 0) return "hoy";
  if (diff === 1) return "mañana";
  if (diff === -1) return "ayer";
  return `el ${shortDate(iso, timeZone)}`;
}

/** "Llega hoy", "Llega el 6 oct", "Va 3 días tarde", "Entregado el 25 sep · devolución hasta el 25 oct". */
export function deliveryLine(order: TrackedOrderView, timeZone: string): string {
  switch (order.delivery) {
    case "canceled":
      // Cancelado por el reclamo: nunca llegó y la tienda devolvió la plata.
      if (order.lastOutcome === "REFUND") return "No llegó: la tienda aprobó el reembolso";
      if (order.lastOutcome === "STORE_CREDIT") return "No llegó: tienes saldo a favor";
      return "Cancelado";
    case "delivered": {
      if (order.lastOutcome === "REFUND") return "Lo devolviste: la tienda aprobó el reembolso";
      if (order.lastOutcome === "STORE_CREDIT") return "Lo devolviste: tienes saldo a favor";
      const when = order.deliveredAt ? `Entregado el ${shortDate(order.deliveredAt, timeZone)}` : "Entregado";
      if (order.returnBy === null || order.returnDaysLeft === null) return when;
      if (order.returnDaysLeft < 0) return `${when} · el plazo para devolver venció`;
      if (order.returnDaysLeft === 0) return `${when} · hoy vence el plazo para devolver`;
      return `${when} · puedes devolverlo hasta el ${shortDate(order.returnBy, timeZone)}`;
    }
    case "late":
      return order.likelyLost
        ? `Va ${plural(order.daysLate ?? 0, "día", "días")} tarde: probablemente se perdió`
        : `Va ${plural(order.daysLate ?? 0, "día", "días")} tarde (llegaba el ${shortDate(order.expectedBy, timeZone)})`;
    case "due_today":
      return "Llega hoy";
    case "on_the_way":
      if (!order.expectedBy) {
        if (order.lastOutcome === "REPLACEMENT") return "La tienda te envía uno nuevo, todavía sin fecha";
        return order.status === "SHIPPED" ? "En camino, sin fecha de entrega" : "Confirmado, sin fecha de entrega";
      }
      return order.daysLeft === 1 ? "Llega mañana" : `Llega el ${shortDate(order.expectedBy, timeZone)}`;
  }
}

/** "$89.00 recuperados" o null. */
export function recoveredText(amount: number, currency: string): string | null {
  return amount > 0 ? `${money(amount, currency, { cents: true })} recuperados` : null;
}

/** En qué va el reclamo, en una o dos frases (tarjeta del reclamo y del chat). */
export function caseStatusLine(c: ReturnCaseView, timeZone: string, now: Date = new Date()): string {
  const m = (n: number | null) => (n ? money(n, c.currency, { cents: true }) : null);
  switch (c.status) {
    case "DRAFT":
      if (c.approval?.status === "PENDING") return `Listo para enviar a ${c.sendTo ?? c.merchant}. Revísalo y apruébalo: sale desde tu correo.`;
      if (c.approval?.status === "REJECTED") return "No aprobaste el envío. Puedes enviarlo tú o pedirle a Omni que lo prepare de nuevo.";
      if (c.approval?.status === "EXPIRED") return "La propuesta venció sin enviarse. Envíalo tú o pídele a Omni que la prepare de nuevo.";
      return c.howToClaim ?? `Envíalo a ${c.merchant} por su página, su chat o su correo con el mensaje de abajo.`;
    case "SENT": {
      if (c.escalated) return `${c.merchant} no respondió${c.followUps > 0 ? ` a ${c.followUps} ${c.followUps === 1 ? "seguimiento" : "seguimientos"}` : ""}. Puedes escalarlo:`;
      const since = c.sentAt ? ` (se lo enviaste ${dayWord(c.sentAt, timeZone, now)})` : "";
      const next = c.followUpAt
        ? c.channel === "EMAIL"
          ? ` Si no responde, ${dayWord(c.followUpAt, timeZone, now)} preparo un seguimiento.`
          : ` ${capitalize(dayWord(c.followUpAt, timeZone, now))} te pregunto si respondió.`
        : "";
      return `Esperando la respuesta de ${c.merchant}${since}.${next}`;
    }
    case "ANSWERED":
      return c.nextStep ?? `${c.merchant} respondió y falta un paso tuyo.`;
    case "RESOLVED":
      switch (c.outcome) {
        case "REFUND":
          return c.refundReceivedAt
            ? `Reembolso${m(c.refundAmount) ? ` de ${m(c.refundAmount)}` : ""} recibido ${dayWord(c.refundReceivedAt, timeZone, now)}.`
            : `Reembolso${m(c.refundAmount) ? ` de ${m(c.refundAmount)}` : ""} aprobado. Reviso tus cuentas para confirmar que llegue.`;
        case "STORE_CREDIT":
          return `${c.merchant} te dio saldo a favor${m(c.refundAmount) ? ` por ${m(c.refundAmount)}` : ""}.`;
        case "REPLACEMENT":
          return `${c.merchant} te envía uno nuevo.`;
        case "ARRIVED":
          return "El pedido llegó: el reclamo quedó resuelto.";
        default:
          return "Resuelto.";
      }
    case "REJECTED":
      return `${c.merchant} rechazó el reclamo. Todavía puedes escalarlo:`;
    case "CLOSED":
      return "Cerraste este reclamo.";
  }
}

/** Abre el mensaje en la app de correo del teléfono o la computadora. */
export function mailtoHref(c: Pick<ReturnCaseView, "sendTo" | "subject" | "body">): string | null {
  if (!c.sendTo) return null;
  return `mailto:${encodeURIComponent(c.sendTo)}?subject=${encodeURIComponent(c.subject)}&body=${encodeURIComponent(c.body)}`;
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
