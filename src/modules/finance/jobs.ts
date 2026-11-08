import "server-only";
import { runBatch, timeLeft } from "@/lib/batch";
import { prisma } from "@/lib/db";
import { entitledSubscriptionWhere } from "@/modules/billing/entitlements";
import { DAY_MS } from "./analyzers";
import { runFinancialAnalysis } from "./insights/analysis.service";
import { purgeExpiredScans } from "./statement-import/scan.service";
import { syncConnection } from "./sync.service";

// Trabajo programado: sincroniza conexiones atrasadas, hace el análisis mensual automático (Pro) y borra las lecturas
// con IA de estados de cuenta que vencieron sin importarse. Todo con tiempo máximo para caber en los 60 s de la
// función: las conexiones van por lotes (varias a la vez) y un análisis solo empieza si cabe entero. Lo que no alcanza
// sigue en la próxima corrida.

/** Tiempo de la corrida para empezar trabajo (deja margen al arranque y al cierre dentro de los 60 s). */
const FINANCE_BUDGET_MS = 50_000;
/** Lo que puede tardar un análisis con IA (su propio tope es de 42 s): solo se empieza si queda este tiempo. */
const ANALYSIS_NEEDS_MS = 42_000;
/** Si hay un informe por hacer, las conexiones dejan su tiempo y un margen. */
const ANALYSIS_RESERVE_MS = ANALYSIS_NEEDS_MS + 5_000;
/** Conexiones que se sincronizan a la vez. */
const SYNC_CONCURRENCY = 3;

export async function runScheduledFinanceJobs(opts: { syncLimit?: number; analysisLimit?: number; now?: Date; budgetMs?: number } = {}) {
  const deadline = Date.now() + (opts.budgetMs ?? FINANCE_BUDGET_MS);
  const syncLimit = opts.syncLimit ?? 25;
  const analysisLimit = opts.analysisLimit ?? 3;
  const now = (opts.now ?? new Date()).getTime();
  const result = { synced: 0, analyzed: 0, scansPurged: 0, errors: 0, pendingSyncs: 0, pendingAnalyses: 0 };

  try {
    result.scansPurged = await purgeExpiredScans(new Date(now));
  } catch (error) {
    result.errors += 1;
    console.error("[cron] limpieza de lecturas con IA fallida", error);
  }

  // Informe mensual automático: función de Pro (en Gratis el análisis se pide a mano). Se busca antes de sincronizar
  // para guardarle tiempo.
  const due = await prisma.profile.findMany({
    where: {
      financialAccounts: { some: {} },
      analyses: { none: { createdAt: { gte: new Date(now - 30 * DAY_MS) } } },
      subscriptions: { some: entitledSubscriptionWhere(new Date(now)) },
    },
    take: analysisLimit,
    select: { id: true },
  });

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
  const sync = await runBatch(stale, (connection) => syncConnection(connection.userId, connection.id), {
    budgetMs: timeLeft(deadline) - (due.length > 0 ? ANALYSIS_RESERVE_MS : 0),
    concurrency: SYNC_CONCURRENCY,
    onError: (connection, error) => console.error("[cron] sincronización fallida", connection.id, error),
  });
  result.synced = sync.done;
  result.errors += sync.failed;
  result.pendingSyncs = sync.pending;

  for (const [index, user] of due.entries()) {
    if (timeLeft(deadline) < ANALYSIS_NEEDS_MS) {
      result.pendingAnalyses = due.length - index;
      break;
    }
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
