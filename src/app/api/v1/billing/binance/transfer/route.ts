import { ensureProfile } from "@/lib/auth";
import { handle } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { startTransfer } from "@/modules/billing/binance-transfer";

/**
 * Empieza el pago con Binance Pay a la cuenta personal: guarda cuándo empezó la persona (solo cuentan los pagos desde
 * ese momento, con 48 horas de margen) y devuelve el Pay ID, el nombre y el precio.
 */
export async function POST(request: Request) {
  return handle(request, async (auth) => {
    await ensureProfile(auth);
    await rateLimit(auth.userId, "billing.binance.transfer", { limit: 30, windowSeconds: 3600 });
    return startTransfer(auth.userId);
  });
}
