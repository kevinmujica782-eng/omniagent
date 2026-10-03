import { cronRoute } from "@/lib/cron";
import { runScheduledProcedureJobs } from "@/modules/procedures/jobs";

// Revisa las bandejas que tocan según el plan (crea sugerencias) y entrega los recordatorios vencidos.
export const maxDuration = 60;

export const GET = cronRoute("procedures", () => runScheduledProcedureJobs());
