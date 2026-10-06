import { ensureProfile } from "@/lib/auth";
import { handle } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { createProOrder } from "@/modules/billing/binance";

export const maxDuration = 30;

/** Crea la orden de Binance Pay de un mes de Pro y devuelve la página de pago (Omni nunca ve los datos de pago). */
export async function POST(request: Request) {
  return handle(request, async (auth) => {
    await ensureProfile(auth);
    await rateLimit(auth.userId, "billing.binance.checkout", { limit: 10, windowSeconds: 3600 });
    return createProOrder(auth.userId);
  });
}
