import { handle } from "@/lib/http";
import { billingOverview } from "@/modules/billing/overview";

/** Plan, funciones de los agentes, consumo del mes y estado del cobro (web y app nativa). */
export async function GET(request: Request) {
  return handle(request, (auth) => billingOverview(auth.userId));
}
