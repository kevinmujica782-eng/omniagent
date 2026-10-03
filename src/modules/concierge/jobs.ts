import "server-only";
import { prisma } from "@/lib/db";
import { expireStaleAlerts } from "./alerts.service";
import { runPriceChecks, type CheckRunSummary } from "./checker";

// Tarea programada del agente de precios (vercel.json → /api/cron/concierge): revisa los precios que ya tocan,
// vence las alertas viejas y las compras preparadas que nadie autorizó.

export async function runScheduledConciergeJobs(opts: { now?: Date; limit?: number; budgetMs?: number } = {}): Promise<
  CheckRunSummary & { expiredAlerts: number; expiredCheckouts: number }
> {
  const now = opts.now ?? new Date();
  const checks = await runPriceChecks({ now, limit: opts.limit ?? 40, budgetMs: opts.budgetMs ?? 45_000 });
  const expiredAlerts = await expireStaleAlerts(now);
  const expired = await prisma.agentAction.updateMany({
    where: { type: "PURCHASE", status: "PENDING", expiresAt: { lt: now } },
    data: { status: "EXPIRED" },
  });
  return { ...checks, expiredAlerts, expiredCheckouts: expired.count };
}
