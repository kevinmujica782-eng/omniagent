import "server-only";
import { env } from "@/lib/env";
import type { BillingOverview } from "@/types/billing";
import { binanceConfigured } from "./binance";
import { transferConfigured } from "./binance-transfer";
import { getEntitlements, usageSummary } from "./entitlements";
import { AGENT_FEATURE_ORDER, AGENT_FEATURES, PLANS } from "./plans";
import { billingNotice } from "./status";

/** Todo lo del plan en una llamada: la cuenta, el panel y la app nativa lo usan igual. */
export async function billingOverview(userId: string, now = new Date()): Promise<BillingOverview> {
  const entitlements = await getEntitlements(userId, now);
  const usage = await usageSummary(userId, entitlements, now);
  const limits = PLANS[entitlements.plan];
  const config = env();
  // Con cuenta de comercio, Binance Pay abre su página de pago; sin ella, la persona envía al Pay ID y pega el ID de la orden.
  const binanceMode = binanceConfigured() ? "merchant" : transferConfigured() ? "transfer" : null;
  return {
    plan: entitlements.plan,
    planName: limits.name,
    priceLabel: limits.priceLabel,
    source: entitlements.source,
    status: entitlements.status,
    renewsAt: entitlements.renewsAt?.toISOString() ?? null,
    cancelAtPeriodEnd: entitlements.cancelAtPeriodEnd,
    notice: entitlements.status ? billingNotice({ status: entitlements.status, cancelAtPeriodEnd: entitlements.cancelAtPeriodEnd }) : null,
    features: AGENT_FEATURE_ORDER.map((id) => ({
      id,
      title: AGENT_FEATURES[id].title,
      enabled: limits.features[id],
      detail: limits.features[id] ? AGENT_FEATURES[id].pro : AGENT_FEATURES[id].free,
    })),
    usage,
    checkoutAvailable: Boolean(config.STRIPE_SECRET_KEY && config.STRIPE_PRICE_PRO_MONTHLY),
    binanceAvailable: binanceMode !== null,
    binanceMode,
  };
}
