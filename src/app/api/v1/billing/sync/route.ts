import { z } from "zod";
import { handle, readJson } from "@/lib/http";
import { syncCheckoutSession } from "@/modules/billing/stripe";

const schema = z.object({ sessionId: z.string().min(8).max(255) });

/** Al volver de Stripe Checkout: activa Pro en el momento (sin esperar al webhook). */
export async function POST(request: Request) {
  return handle(request, async (auth) => {
    const { sessionId } = await readJson(request, schema);
    return syncCheckoutSession(auth.userId, sessionId);
  });
}
