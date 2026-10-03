import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { Errors } from "@/lib/errors";
import { getEntitlements } from "@/modules/billing/entitlements";
import type { ConciergeSettingsView } from "@/types/cards";
import { paymentProvider } from "./payments";
import { DEFAULT_LIMITS } from "./rules/checkout";

// Límites de compra (por pedido y por mes) guardados en profiles.preferences.concierge, y gasto del mes.

type Preferences = { concierge?: { perOrderLimit?: number; monthlyLimit?: number } } & Record<string, unknown>;

const round2 = (n: number) => Math.round(n * 100) / 100;

export async function getPurchaseLimits(userId: string): Promise<{ perOrder: number; monthly: number; currency: string }> {
  const profile = await prisma.profile.findUnique({ where: { id: userId }, select: { preferences: true, currency: true } });
  const prefs = (profile?.preferences ?? {}) as Preferences;
  const perOrder = Number(prefs.concierge?.perOrderLimit);
  const monthly = Number(prefs.concierge?.monthlyLimit);
  return {
    perOrder: Number.isFinite(perOrder) && perOrder > 0 ? perOrder : DEFAULT_LIMITS.perOrder,
    monthly: Number.isFinite(monthly) && monthly > 0 ? monthly : DEFAULT_LIMITS.monthly,
    currency: profile?.currency ?? "USD",
  };
}

/** Lo pagado este mes (pedidos confirmados), en la moneda del usuario. */
export async function spentThisMonth(userId: string, currency: string, now = new Date()): Promise<number> {
  const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const orders = await prisma.purchaseOrder.findMany({
    where: { userId, status: "PLACED", currency, createdAt: { gte: since } },
    select: { total: true },
  });
  return round2(orders.reduce((sum, order) => sum + Number(order.total), 0));
}

export async function updatePurchaseLimits(userId: string, input: { perOrderLimit: number; monthlyLimit: number }): Promise<ConciergeSettingsView> {
  const perOrder = round2(input.perOrderLimit);
  const monthly = round2(input.monthlyLimit);
  if (!(perOrder >= 1 && perOrder <= 100_000) || !(monthly >= 1 && monthly <= 500_000)) {
    throw Errors.badRequest("Elige límites entre 1 y 100.000 por compra y hasta 500.000 al mes.");
  }
  if (perOrder > monthly) throw Errors.badRequest("El límite por compra no puede ser mayor que el mensual.");
  const profile = await prisma.profile.findUnique({ where: { id: userId }, select: { preferences: true } });
  const prefs = { ...((profile?.preferences ?? {}) as Preferences) };
  prefs.concierge = { ...(prefs.concierge ?? {}), perOrderLimit: perOrder, monthlyLimit: monthly };
  await prisma.profile.update({ where: { id: userId }, data: { preferences: prefs as unknown as Prisma.InputJsonValue } });
  await audit({ userId, actor: "user", action: "concierge.limits", metadata: { perOrder, monthly } });
  return getConciergeSettings(userId);
}

export async function getConciergeSettings(userId: string, now = new Date()): Promise<ConciergeSettingsView> {
  const [limits, entitlements] = await Promise.all([getPurchaseLimits(userId), getEntitlements(userId)]);
  return {
    currency: limits.currency,
    perOrderLimit: limits.perOrder,
    monthlyLimit: limits.monthly,
    spentThisMonth: await spentThisMonth(userId, limits.currency, now),
    methods: paymentProvider().methods(),
    webChecks: env().WEB_PRICE_CHECKS === "on",
    plan: entitlements.plan,
    maxItems: entitlements.limits.watchlistItems,
    checkEveryMinutes: entitlements.limits.priceCheckMinutes,
  };
}
