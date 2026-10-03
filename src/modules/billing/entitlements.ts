import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import type { BillingProvider, SubscriptionStatus } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { Errors, type AppError, type PlanLimitDetails } from "@/lib/errors";
import { AGENT_FEATURES, PLANS, type AgentFeatureId, type PlanId, type PlanLimits } from "./plans";
import { ENTITLED_STATUSES } from "./status";

export interface Entitlements {
  plan: PlanId;
  limits: PlanLimits;
  model: string;
  source: BillingProvider | null;
  status: SubscriptionStatus | null;
  renewsAt: Date | null;
  cancelAtPeriodEnd: boolean;
}

/** Filtro de Prisma: suscripciones que dan Pro en este momento (misma regla que isEntitled en status.ts). */
export function entitledSubscriptionWhere(now: Date): Prisma.SubscriptionWhereInput {
  return {
    plan: "PRO",
    status: { in: [...ENTITLED_STATUSES] },
    OR: [{ currentPeriodEnd: null }, { currentPeriodEnd: { gt: now } }],
  };
}

/**
 * Fuente única de verdad del plan: tabla subscriptions, alimentada por los webhooks de Stripe (web)
 * y RevenueCat (Google Play). PRO si hay una suscripción vigente en cualquiera de los dos.
 */
export async function getEntitlements(userId: string, now = new Date()): Promise<Entitlements> {
  const subscription = await prisma.subscription.findFirst({
    where: { userId, ...entitledSubscriptionWhere(now) },
    orderBy: { currentPeriodEnd: "desc" },
  });

  const plan: PlanId = subscription ? "PRO" : "FREE";
  const config = env();
  return {
    plan,
    limits: PLANS[plan],
    model: plan === "PRO" ? config.ANTHROPIC_MODEL_PRO : config.ANTHROPIC_MODEL_FREE,
    source: subscription?.provider ?? null,
    status: subscription?.status ?? null,
    renewsAt: subscription?.currentPeriodEnd ?? null,
    cancelAtPeriodEnd: subscription?.cancelAtPeriodEnd ?? false,
  };
}

export function hasFeature(entitlements: Pick<Entitlements, "limits">, feature: AgentFeatureId): boolean {
  return entitlements.limits.features[feature];
}

/** Error 402 con el detalle que la interfaz necesita para ofrecer Pro (o no, si ya lo tiene). */
export function planLimitError(
  entitlements: Pick<Entitlements, "plan">,
  reason: PlanLimitDetails["reason"],
  message: string,
  extra: { limit?: number; feature?: AgentFeatureId } = {},
): AppError {
  return Errors.planLimit(message, { plan: entitlements.plan, reason, ...extra });
}

/** Exige una función avanzada; en Gratis responde 402 con el texto de la función para la hoja de mejora. */
export function requireFeature(entitlements: Pick<Entitlements, "plan" | "limits">, feature: AgentFeatureId): void {
  if (hasFeature(entitlements, feature)) return;
  const info = AGENT_FEATURES[feature];
  throw planLimitError(entitlements, "feature", `${info.title} es parte de Pro. ${info.pro}`, { feature });
}

export function startOfMonthUtc(date = new Date()): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

/** Mensajes de chat usados este mes (los análisis automáticos no consumen cuota). */
export async function monthlyUsage(userId: string, now = new Date()): Promise<number> {
  return prisma.aiUsageLog.count({ where: { userId, kind: "chat", createdAt: { gte: startOfMonthUtc(now) } } });
}

/** Formularios leídos con IA este mes (para el límite del plan). */
export async function monthlyFormReads(userId: string, now = new Date()): Promise<number> {
  return prisma.aiUsageLog.count({ where: { userId, kind: "document", createdAt: { gte: startOfMonthUtc(now) } } });
}

/** Páginas de productos leídas con IA este mes (las que no publican el precio en datos estructurados). */
export async function monthlyPageReads(userId: string, now = new Date()): Promise<number> {
  return prisma.aiUsageLog.count({ where: { userId, kind: "page_read", createdAt: { gte: startOfMonthUtc(now) } } });
}

export type UsageMeter = { used: number; limit: number };

/** Consumo del mes frente a los límites del plan (cuenta y panel de Inicio). */
export async function usageSummary(
  userId: string,
  entitlements: Entitlements,
  now = new Date(),
): Promise<{ messages: UsageMeter; formReads: UsageMeter; pageReads: UsageMeter; watching: UsageMeter; goals: UsageMeter }> {
  const [messages, formReads, pageReads, watching, goals] = await Promise.all([
    monthlyUsage(userId, now),
    monthlyFormReads(userId, now),
    monthlyPageReads(userId, now),
    prisma.watchlistItem.count({ where: { userId, status: "ACTIVE" } }),
    prisma.goal.count({ where: { userId, status: "ACTIVE" } }),
  ]);
  const l = entitlements.limits;
  return {
    messages: { used: messages, limit: l.monthlyMessages },
    formReads: { used: formReads, limit: l.monthlyFormReads },
    pageReads: { used: pageReads, limit: l.monthlyPageReads },
    watching: { used: watching, limit: l.watchlistItems },
    goals: { used: goals, limit: l.activeGoals },
  };
}

export async function assertCanSendMessage(userId: string, entitlements: Entitlements): Promise<void> {
  const used = await monthlyUsage(userId);
  if (used >= entitlements.limits.monthlyMessages) {
    throw planLimitError(
      entitlements,
      "messages",
      entitlements.plan === "FREE"
        ? `Usaste tus ${entitlements.limits.monthlyMessages} mensajes gratis de este mes. Pásate a Pro para seguir.`
        : "Alcanzaste el límite mensual de tu plan. Se renueva el día 1.",
      { limit: entitlements.limits.monthlyMessages },
    );
  }
}
