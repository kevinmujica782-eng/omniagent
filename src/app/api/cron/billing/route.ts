import { cronRoute } from "@/lib/cron";
import { runBinanceBillingJobs } from "@/modules/billing/binance";

// Vence los meses de Pro pagados con Binance Pay y avisa antes de que venzan. Cada hora (npm run db:cron).
export const maxDuration = 60;

export const GET = cronRoute("billing", () => runBinanceBillingJobs());
