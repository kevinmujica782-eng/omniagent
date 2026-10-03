import { ensureProfile } from "@/lib/auth";
import { handle } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { createProCheckout } from "@/modules/billing/stripe";

/** Crea una sesión de Stripe Checkout para el plan Pro (web). En Android se usa Google Play vía RevenueCat. */
export async function POST(request: Request) {
  return handle(request, async (auth) => {
    await rateLimit(auth.userId, "billing.checkout", { limit: 10, windowSeconds: 3600 });
    await ensureProfile(auth);
    return { url: await createProCheckout({ userId: auth.userId, email: auth.email }) };
  });
}
