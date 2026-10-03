import { handle } from "@/lib/http";
import { searchOffers } from "@/modules/concierge/tracking.service";

/** Búsqueda en las tiendas de prueba: /api/v1/concierge/search?q=audífonos */
export async function GET(request: Request) {
  return handle(request, async () => {
    const q = new URL(request.url).searchParams.get("q")?.slice(0, 120) ?? "";
    return searchOffers(q);
  });
}
