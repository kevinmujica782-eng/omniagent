import { z } from "zod";
import { handle, readJson } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { addManualOrder, listOrderViews } from "@/modules/returns/returns.service";

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Usa el formato AAAA-MM-DD.");

const postSchema = z.object({
  merchant: z.string().trim().min(2).max(80),
  title: z.string().trim().min(2).max(160),
  orderNumber: z.string().trim().max(40).nullish(),
  orderedOn: DATE.nullish(),
  expectedOn: DATE.nullish(),
  deliveredOn: DATE.nullish(),
  total: z.number().positive().max(1_000_000).nullish(),
  currency: z.string().length(3).nullish(),
  supportEmail: z.email().max(200).nullish(),
  trackingNumber: z.string().trim().max(40).nullish(),
});

const FILTERS = ["all", "active", "late", "problems", "delivered"] as const;

/** ?filtro=all|active|late|problems|delivered */
export async function GET(request: Request) {
  return handle(request, async (auth) => {
    const value = new URL(request.url).searchParams.get("filtro");
    const filter = FILTERS.find((f) => f === value) ?? "all";
    return listOrderViews(auth.userId, filter);
  });
}

/** Agregar a mano un pedido hecho fuera de OmniAgent. */
export async function POST(request: Request) {
  return handle(request, async (auth) => {
    await rateLimit(auth.userId, "returns.add_order", { limit: 60, windowSeconds: 3600 });
    return addManualOrder(auth.userId, await readJson(request, postSchema));
  });
}
