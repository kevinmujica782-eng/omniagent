import { handle } from "@/lib/http";
import { getReturnsOverview } from "@/modules/returns/returns.service";

/** Pedidos, reclamos y lo recuperado (antes, pone al día correos, retrasos, seguimientos y reembolsos). */
export async function GET(request: Request) {
  return handle(request, (auth) => getReturnsOverview(auth.userId));
}
