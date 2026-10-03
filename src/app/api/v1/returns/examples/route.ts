import { handle } from "@/lib/http";
import { addExampleOrders } from "@/modules/returns/returns.service";

/** Pedidos de ejemplo en tiendas de prueba (.test): uno retrasado, uno entregado y uno en camino. */
export async function POST(request: Request) {
  return handle(request, (auth) => addExampleOrders(auth.userId));
}
