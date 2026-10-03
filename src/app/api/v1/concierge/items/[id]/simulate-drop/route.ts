import { handle } from "@/lib/http";
import { simulateDrop } from "@/modules/concierge/tracking.service";

type Context = { params: Promise<{ id: string }> };

/** Solo tiendas de prueba: oferta relámpago de 6 horas para probar la alerta y la compra. */
export async function POST(request: Request, { params }: Context) {
  return handle(request, async (auth) => {
    const { id } = await params;
    return simulateDrop(auth.userId, id);
  });
}
