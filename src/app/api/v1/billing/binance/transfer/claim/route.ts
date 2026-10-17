import { z } from "zod";
import { ensureProfile } from "@/lib/auth";
import { handle, readJson } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { claimTransfer } from "@/modules/billing/binance-transfer";
import { getEntitlements } from "@/modules/billing/entitlements";

export const maxDuration = 30;

const schema = z.object({ codigo: z.string().trim().min(1).max(200) });

/**
 * Con el ID de la orden que muestra Binance: busca el pago en el historial de Binance Pay de la cuenta que cobra y, si
 * sirve, suma sus meses de Pro (cada consulta a Binance pesa, por eso el límite).
 */
export async function POST(request: Request) {
  return handle(request, async (auth) => {
    await ensureProfile(auth);
    const { codigo } = await readJson(request, schema);
    await rateLimit(auth.userId, "billing.binance.transfer.claim", { limit: 20, windowSeconds: 600 });
    const result = await claimTransfer(auth.userId, codigo);
    const { plan } = await getEntitlements(auth.userId);
    return { ...result, plan };
  });
}
