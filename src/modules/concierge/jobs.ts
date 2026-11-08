import "server-only";
import { CRON_BUDGET_MS } from "@/lib/batch";
import { prisma } from "@/lib/db";
import { expireStaleAlerts } from "./alerts.service";
import { runPriceChecks, type CheckRunSummary } from "./checker";

// Tarea programada del agente de precios (/api/cron/concierge): revisa los precios que ya tocan, vence las alertas
// viejas y las compras preparadas que nadie autorizó. Los precios van por lotes: los más atrasados primero, varias
// páginas a la vez y sin empezar otra cuando se acaba el tiempo; lo que no alcanza sigue en la próxima corrida.

/** Precios que se toman por corrida (el tiempo máximo corta antes si hace falta). */
const PRICE_CHECKS_PER_RUN = 200;
/** Páginas que se leen a la vez. */
const PRICE_CHECK_CONCURRENCY = 6;

export async function runScheduledConciergeJobs(opts: { now?: Date; limit?: number; budgetMs?: number } = {}): Promise<
  CheckRunSummary & { expiredAlerts: number; expiredCheckouts: number }
> {
  const now = opts.now ?? new Date();
  const checks = await runPriceChecks({
    now,
    limit: opts.limit ?? PRICE_CHECKS_PER_RUN,
    budgetMs: opts.budgetMs ?? CRON_BUDGET_MS,
    concurrency: PRICE_CHECK_CONCURRENCY,
  });
  const expiredAlerts = await expireStaleAlerts(now);
  const expired = await prisma.agentAction.updateMany({
    where: { type: "PURCHASE", status: "PENDING", expiresAt: { lt: now } },
    data: { status: "EXPIRED" },
  });
  return { ...checks, expiredAlerts, expiredCheckouts: expired.count };
}
