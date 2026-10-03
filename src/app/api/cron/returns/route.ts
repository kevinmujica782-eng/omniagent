import { cronRoute } from "@/lib/cron";
import { runScheduledReturnJobs } from "@/modules/returns/jobs";

// Pone al día pedidos y devoluciones: retrasos (prepara el reclamo), seguimientos que tocan, respuestas de las
// tiendas en el correo y reembolsos que ya se ven en las cuentas.
export const maxDuration = 60;

export const GET = cronRoute("returns", () => runScheduledReturnJobs());
