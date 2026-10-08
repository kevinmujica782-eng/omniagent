import "server-only";
import { z } from "zod";
import { AppError } from "@/lib/errors";
import { money, plural } from "@/lib/format";
import { getAntExpenses, getSubscriptions, refreshRecurringCharges } from "@/modules/finance/finance.service";
import { getLatestAnalysis, runFinancialAnalysis, toInsightsCard } from "@/modules/finance/insights/analysis.service";
import { countActiveBankConnections, syncAllConnections } from "@/modules/finance/sync.service";
import type { InsightsCard } from "@/types/cards";
import { defineStep, done, skip } from "../engine.types";

// Pasos del módulo de finanzas. Cada uno llama al servicio del módulo (las mismas reglas que el chat y las pantallas)
// y deja una nota corta para la tarjeta.

/** Trae los movimientos nuevos de los bancos conectados. Si el banco no responde, se sigue con lo guardado. */
export const syncAccounts = defineStep({
  key: "finance.sync_accounts",
  title: "Actualizar tus cuentas",
  module: "FINANCE",
  output: z.object({ connections: z.number().int(), added: z.number().int(), errors: z.number().int() }),
  timeoutMs: 40_000,
  maxAttempts: 2,
  optional: true,
  async run({ userId }) {
    if ((await countActiveBankConnections(userId)) === 0) return skip("No tienes bancos conectados: uso lo que ya está guardado.");
    const totals = await syncAllConnections(userId);
    if (totals.connections === 0) throw new AppError(503, "bank_unavailable", "Tu banco no respondió. Uso lo que ya está guardado.");
    const added = totals.added === 0 ? "sin movimientos nuevos" : plural(totals.added, "movimiento nuevo", "movimientos nuevos");
    return done(
      { connections: totals.connections, added: totals.added, errors: totals.errors },
      `${plural(totals.connections, "banco al día", "bancos al día")}, ${added}.`,
    );
  },
});

/** Suscripciones y cobros fijos: cuántos hay y cuáles parecen sin uso. */
export const reviewSubscriptions = defineStep({
  key: "finance.subscriptions",
  title: "Revisar tus suscripciones",
  module: "FINANCE",
  output: z.object({ count: z.number().int(), unused: z.number().int(), unusedMonthly: z.number(), currency: z.string() }),
  timeoutMs: 30_000,
  maxAttempts: 2,
  optional: true,
  async run(ctx) {
    // Al sincronizar un banco ya se recalculan; con estados de cuenta subidos a mano, se recalculan aquí.
    if (!ctx.outputOf(syncAccounts)?.connections) await refreshRecurringCharges(ctx.userId);
    const card = await getSubscriptions(ctx.userId);
    if (!card) return skip("No encontré suscripciones ni cobros fijos.");
    const unused = card.items.filter((item) => item.status === "UNUSED_SUSPECTED").length;
    const count = plural(card.items.length, "suscripción", "suscripciones");
    const note =
      unused > 0
        ? `${count}; ${plural(unused, "parece sin uso", "parecen sin uso")} (${money(card.unusedMonthlyTotal, card.currency)} al mes).`
        : `${count}, todas en uso.`;
    return done({ count: card.items.length, unused, unusedMonthly: card.unusedMonthlyTotal, currency: card.currency }, note);
  },
});

/** Compras pequeñas y repetidas del último mes. */
export const findAntExpenses = defineStep({
  key: "finance.ant_expenses",
  title: "Buscar gastos hormiga",
  module: "FINANCE",
  output: z.object({ merchants: z.number().int(), monthly: z.number(), currency: z.string() }),
  timeoutMs: 20_000,
  maxAttempts: 2,
  optional: true,
  async run({ userId }) {
    const card = await getAntExpenses(userId);
    if (!card || card.items.length === 0) return skip("No encontré gastos hormiga este mes.");
    return done(
      { merchants: card.items.length, monthly: card.monthlyProjection, currency: card.currency },
      `${money(card.monthlyProjection, card.currency)} al mes en compras pequeñas.`,
    );
  },
});

const reportOutput = z.object({
  analysisId: z.string(),
  headline: z.string(),
  totalMonthlySavings: z.number(),
  currency: z.string(),
  recommendations: z.number().int(),
});

function reportOf(card: InsightsCard): z.output<typeof reportOutput> {
  return {
    analysisId: card.analysisId,
    headline: card.headline,
    totalMonthlySavings: card.totalMonthlySavings,
    currency: card.currency,
    recommendations: card.recommendations.length,
  };
}

/** El informe de ahorro con IA (o por reglas, si la IA no está). El módulo avisa cuando queda listo. */
export const buildReport = defineStep({
  key: "finance.report",
  title: "Preparar tu informe con IA",
  module: "FINANCE",
  output: reportOutput,
  timeoutMs: 45_000,
  maxAttempts: 2,
  async run(ctx) {
    // Si un intento anterior alcanzó a guardar el informe antes de cortarse, se usa ese (no se duplica).
    const latest = await getLatestAnalysis(ctx.userId);
    if (latest && latest.createdAt.getTime() >= ctx.startedAt.getTime()) {
      const card = toInsightsCard(latest);
      return done(reportOf(card), card.headline);
    }
    const { card } = await runFinancialAnalysis(ctx.userId, { trigger: "MANUAL", force: true, signal: ctx.signal });
    return done(reportOf(card), card.headline);
  },
});
