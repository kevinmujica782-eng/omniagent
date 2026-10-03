import { cronRoute } from "@/lib/cron";
import { pruneRateLimits } from "@/lib/rate-limit";
import { runScheduledConciergeJobs } from "@/modules/concierge/jobs";

// Agente de precios en segundo plano (ver vercel.json; también sirve Supabase pg_cron + pg_net, ver README).
// De paso limpia los contadores viejos del límite de tasa.
export const maxDuration = 60;

export const GET = cronRoute("concierge", async () => {
  const result = await runScheduledConciergeJobs({ budgetMs: 50_000 });
  const prunedRateLimits = await pruneRateLimits().catch(() => 0);
  return { ...result, prunedRateLimits };
});
