import { z } from "zod";
import { handle, readJson } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { authorizeCheckout, getCheckout } from "@/modules/concierge/checkout.service";

export const maxDuration = 30;

type Context = { params: Promise<{ id: string }> };

const schema = z.object({
  decision: z.enum(["allow", "deny"]),
  /** Huella de la cotización que el usuario vio: Permitir solo vale para ese total. */
  quoteId: z.string().max(64).nullable().optional(),
  methodId: z.string().max(64).nullable().optional(),
});

export async function GET(request: Request, { params }: Context) {
  return handle(request, async (auth) => {
    const { id } = await params;
    return getCheckout(auth.userId, id);
  });
}

/** Permitir (cobra, simulado, y crea el pedido) o Denegar (no hace nada más). */
export async function POST(request: Request, { params }: Context) {
  return handle(request, async (auth) => {
    const { id } = await params;
    await rateLimit(auth.userId, "purchase.decide", { limit: 30, windowSeconds: 600 });
    return authorizeCheckout(auth.userId, id, await readJson(request, schema));
  });
}
