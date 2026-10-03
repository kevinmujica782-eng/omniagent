// Reglas puras de suscripción (sin base de datos ni SDK): qué estados dan acceso a Pro y cómo se traducen
// los estados de Stripe. Las usan los webhooks, los permisos y las pruebas unitarias.
import type { SubscriptionStatus } from "@/generated/prisma/enums";
import type { PlanId } from "./plans";

/**
 * Estados que mantienen Pro mientras el periodo esté vigente. PAST_DUE incluido: mientras Stripe reintenta
 * el cobro (según tu configuración de reintentos) el usuario conserva el acceso y ve un aviso para
 * actualizar la tarjeta; si Stripe termina cancelando o marcando la suscripción como impaga, se pierde.
 */
export const ENTITLED_STATUSES = ["ACTIVE", "TRIALING", "PAST_DUE"] as const satisfies readonly SubscriptionStatus[];

export type SubscriptionLike = { plan: string; status: string; currentPeriodEnd: Date | null };

export function mapStripeStatus(status: string): SubscriptionStatus {
  switch (status) {
    case "active":
      return "ACTIVE";
    case "trialing":
      return "TRIALING";
    case "past_due":
      return "PAST_DUE";
    case "canceled":
      return "CANCELED";
    case "incomplete":
      return "INCOMPLETE";
    default:
      // unpaid, incomplete_expired, paused: sin acceso
      return "EXPIRED";
  }
}

/** ¿Esta suscripción da Pro en este momento? (la misma regla que entitledSubscriptionWhere en la base). */
export function isEntitled(subscription: SubscriptionLike, now: Date): boolean {
  if (subscription.plan !== "PRO") return false;
  if (!(ENTITLED_STATUSES as readonly string[]).includes(subscription.status)) return false;
  return subscription.currentPeriodEnd === null || subscription.currentPeriodEnd.getTime() > now.getTime();
}

/** Plan efectivo: Pro si cualquiera de sus suscripciones (web o Google Play) está vigente. */
export function planFrom(subscriptions: SubscriptionLike[], now: Date): PlanId {
  return subscriptions.some((s) => isEntitled(s, now)) ? "PRO" : "FREE";
}

/** Aviso para la cuenta y el panel cuando hay algo que resolver con el pago. */
export function billingNotice(subscription: { status: string; cancelAtPeriodEnd: boolean } | null): "past_due" | "canceling" | null {
  if (!subscription) return null;
  if (subscription.status === "PAST_DUE") return "past_due";
  if (subscription.cancelAtPeriodEnd) return "canceling";
  return null;
}
