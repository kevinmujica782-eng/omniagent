import { handle } from "@/lib/http";
import { createPortalSession } from "@/modules/billing/stripe";

/** Portal de Stripe para cambiar tarjeta, ver facturas o cancelar la suscripción web. */
export async function POST(request: Request) {
  return handle(request, async (auth) => ({ url: await createPortalSession(auth.userId) }));
}
