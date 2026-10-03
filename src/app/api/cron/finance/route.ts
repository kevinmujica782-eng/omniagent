import { cronRoute } from "@/lib/cron";
import { runScheduledFinanceJobs } from "@/modules/finance/jobs";

// Sincroniza las cuentas atrasadas y hace el informe mensual automático (Pro). Ver vercel.json.
export const maxDuration = 60;

export const GET = cronRoute("finance", () => runScheduledFinanceJobs());
