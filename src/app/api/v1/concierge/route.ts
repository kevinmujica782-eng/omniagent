import { handle } from "@/lib/http";
import { getConciergePage } from "@/modules/concierge/concierge.service";

/** Todo lo de la página de Compras en una llamada (útil para la app nativa). */
export async function GET(request: Request) {
  return handle(request, (auth) => getConciergePage(auth.userId));
}
