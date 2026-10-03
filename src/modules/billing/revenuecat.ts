import "server-only";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { SubscriptionStatus } from "@/generated/prisma/enums";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { isUuid } from "@/lib/validation";
import { getEntitlements } from "./entitlements";
import { applyPlanChange } from "./plan-change";

// RevenueCat gestiona Google Play Billing en la app Android. app_user_id = id de Supabase del usuario
// (se configura con Purchases.logIn(userId) en la app).

export const revenueCatWebhookSchema = z.object({
  event: z.object({
    id: z.string(),
    type: z.string(),
    app_user_id: z.string(),
    original_app_user_id: z.string().nullish(),
    product_id: z.string().nullish(),
    entitlement_ids: z.array(z.string()).nullish(),
    expiration_at_ms: z.number().nullish(),
    environment: z.string().nullish(),
    original_transaction_id: z.string().nullish(),
    transaction_id: z.string().nullish(),
  }),
});

export type RevenueCatEvent = z.infer<typeof revenueCatWebhookSchema>["event"];

const GRANTING_EVENTS = new Set([
  "INITIAL_PURCHASE",
  "RENEWAL",
  "UNCANCELLATION",
  "PRODUCT_CHANGE",
  "NON_RENEWING_PURCHASE",
  "SUBSCRIPTION_EXTENDED",
  "TEMPORARY_ENTITLEMENT_GRANT",
]);

export function isAuthorizedRevenueCat(header: string | null, expected: string): boolean {
  if (!header) return false;
  const candidates = [expected, `Bearer ${expected}`];
  return candidates.some((candidate) => {
    const a = Buffer.from(header);
    const b = Buffer.from(candidate);
    return a.length === b.length && timingSafeEqual(a, b);
  });
}

export async function syncRevenueCatEvent(event: RevenueCatEvent): Promise<string | null> {
  const userId = isUuid(event.app_user_id) ? event.app_user_id : null;
  if (!userId) return null; // usuario anónimo de RevenueCat: aún no inició sesión en la app

  if (event.environment === "SANDBOX" && process.env.NODE_ENV === "production") return userId;

  const entitlement = env().REVENUECAT_PRO_ENTITLEMENT;
  if (event.entitlement_ids && !event.entitlement_ids.includes(entitlement)) return userId;

  let status: SubscriptionStatus;
  let cancelAtPeriodEnd: boolean | undefined;
  if (GRANTING_EVENTS.has(event.type)) {
    status = "ACTIVE";
    cancelAtPeriodEnd = false;
  } else if (event.type === "CANCELLATION") {
    status = "ACTIVE"; // sigue vigente hasta expiration_at_ms
    cancelAtPeriodEnd = true;
  } else if (event.type === "BILLING_ISSUE") {
    status = "PAST_DUE";
  } else if (event.type === "EXPIRATION") {
    status = "EXPIRED";
  } else {
    return userId; // TEST, TRANSFER, SUBSCRIBER_ALIAS...: nada que sincronizar
  }

  const profile = await prisma.profile.findUnique({ where: { id: userId }, select: { id: true } });
  if (!profile) return null;

  const now = new Date();
  const before = (await getEntitlements(userId, now)).plan;
  const providerSubscriptionId =
    event.original_transaction_id ?? event.transaction_id ?? `${userId}:${event.product_id ?? "pro"}`;
  const currentPeriodEnd = event.expiration_at_ms ? new Date(event.expiration_at_ms) : null;

  await prisma.subscription.upsert({
    where: { provider_providerSubscriptionId: { provider: "REVENUECAT", providerSubscriptionId } },
    create: {
      userId,
      provider: "REVENUECAT",
      plan: "PRO",
      status,
      productId: event.product_id ?? null,
      providerCustomerId: event.original_app_user_id ?? event.app_user_id,
      providerSubscriptionId,
      currentPeriodEnd,
      cancelAtPeriodEnd: cancelAtPeriodEnd ?? false,
    },
    update: {
      status,
      currentPeriodEnd,
      ...(event.product_id ? { productId: event.product_id } : {}),
      ...(cancelAtPeriodEnd !== undefined ? { cancelAtPeriodEnd } : {}),
    },
  });
  await audit({
    userId,
    actor: "webhook",
    action: "billing.revenuecat.sync",
    entity: "subscription",
    entityId: providerSubscriptionId,
    metadata: { type: event.type },
  });
  const after = (await getEntitlements(userId, now)).plan;
  if (after !== before) await applyPlanChange(userId, before, after, now);
  return userId;
}
