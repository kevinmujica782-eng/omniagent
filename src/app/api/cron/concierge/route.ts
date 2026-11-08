import { cronRoute } from "@/lib/cron";
import { pruneRateLimits } from "@/lib/rate-limit";
import { runScheduledConciergeJobs } from "@/modules/concierge/jobs";

// Agente de precios en segundo plano (Supabase pg_cron + pg_net, ver scripts/db-cron.mjs). Revisa por lotes con
// tiempo máximo (ver src/lib/batch.ts) y de paso limpia los contadores viejos del límite de tasa.
export const maxDuration = 60;

export const GET = cronRoute("concierge", async () => {
  const result = await runScheduledConciergeJobs();
  const prunedRateLimits = await pruneRateLimits().catch(() => 0);
  return { ...result, prunedRateLimits };
});
