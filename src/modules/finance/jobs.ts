import "server-only";
import { prisma } from "@/lib/db";
import { entitledSubscriptionWhere } from "@/modules/billing/entitlements";
import { DAY_MS } from "./analyzers";
import { runFinancialAnalysis } from "./insights/analysis.service";
import { syncConnection } from "./sync.service";

// Trabajo programado (cron diario): sincroniza conexiones atrasadas y hace el análisis mensual automático.
// Lotes pequeños para caber en el tiempo máximo de una función serverless; si crece, pasar a una cola.

export async function runScheduledFinanceJobs(opts: { syncLimit?: number; analysisLimit?: number; now?: Date } = {}) {
  const syncLimit = opts.syncLimit ?? 25;
  const analysisLimit = opts.analysisLimit ?? 3;
  const now = (opts.now ?? new Date()).getTime();
  const result = { synced: 0, analyzed: 0, errors: 0 };

  const stale = await prisma.integrationConnection.findMany({
    where: {
      provider: { in: ["BANK_DEMO", "BANK_AGGREGATOR"] },
      status: "ACTIVE",
      OR: [{ lastSyncedAt: null }, { lastSyncedAt: { lt: new Date(now - 20 * 3_600_000) } }],
    },
    orderBy: { lastSyncedAt: "asc" },
    take: syncLimit,
    select: { id: true, userId: true },
  });
  for (const connection of stale) {
    try {
      await syncConnection(connection.userId, connection.id);
      result.synced += 1;
    } catch (error) {
      result.errors += 1;
      console.error("[cron] sincronización fallida", connection.id, error);
    }
  }

  // Informe mensual automático: función de Pro (en Gratis el análisis se pide a mano).
  const due = await prisma.profile.findMany({
    where: {
      financialAccounts: { some: {} },
      analyses: { none: { createdAt: { gte: new Date(now - 30 * DAY_MS) } } },
      subscriptions: { some: entitledSubscriptionWhere(new Date(now)) },
    },
    take: analysisLimit,
    select: { id: true },
  });
  for (const user of due) {
    try {
      await runFinancialAnalysis(user.id, { trigger: "SCHEDULED", force: true });
      result.analyzed += 1;
    } catch (error) {
      result.errors += 1;
      console.error("[cron] análisis fallido", user.id, error);
    }
  }
  return result;
}
