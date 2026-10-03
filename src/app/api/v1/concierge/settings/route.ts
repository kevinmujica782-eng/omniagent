import { z } from "zod";
import { handle, readJson } from "@/lib/http";
import { getConciergeSettings, updatePurchaseLimits } from "@/modules/concierge/settings.service";

const schema = z.object({
  perOrderLimit: z.number().positive().max(100_000),
  monthlyLimit: z.number().positive().max(500_000),
});

export async function GET(request: Request) {
  return handle(request, (auth) => getConciergeSettings(auth.userId));
}

/** Límites de compra: por pedido y por mes. */
export async function PUT(request: Request) {
  return handle(request, async (auth) => updatePurchaseLimits(auth.userId, await readJson(request, schema)));
}
