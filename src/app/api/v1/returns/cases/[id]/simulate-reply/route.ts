import { handle } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { simulateStoreReply } from "@/modules/returns/returns.service";

type Context = { params: Promise<{ id: string }> };

/** Solo tiendas de prueba (.test): la tienda responde el reclamo, como lo haría una real, para probar el ciclo. */
export async function POST(request: Request, { params }: Context) {
  return handle(request, async (auth) => {
    const { id } = await params;
    await rateLimit(auth.userId, "returns.simulate", { limit: 30, windowSeconds: 600 });
    return simulateStoreReply(auth.userId, id);
  });
}
