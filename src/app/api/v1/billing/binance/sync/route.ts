import { z } from "zod";
import { handle, readJson } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { syncBinanceOrder } from "@/modules/billing/binance";
import { getEntitlements } from "@/modules/billing/entitlements";

export const maxDuration = 30;

const schema = z.object({ orden: z.string().regex(/^[A-Za-z0-9]{1,32}$/) });

/** Al volver de Binance Pay: confirma la orden en Binance y activa Pro en el momento (el webhook hace lo mismo). */
export async function POST(request: Request) {
  return handle(request, async (auth) => {
    const { orden } = await readJson(request, schema);
    await rateLimit(auth.userId, "billing.binance.sync", { limit: 30, windowSeconds: 600 });
    const result = await syncBinanceOrder(orden, { userId: auth.userId });
    const { plan } = await getEntitlements(auth.userId);
    return { ...result, plan };
  });
}
