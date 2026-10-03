import { z } from "zod";
import { handle, readJson } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { reportProblem } from "@/modules/returns/returns.service";

type Context = { params: Promise<{ id: string }> };

const schema = z.object({
  reason: z.enum(["LATE", "NOT_RECEIVED", "DAMAGED", "WRONG_ITEM", "NOT_AS_DESCRIBED", "CHANGED_MIND"]),
  desired: z.enum(["REFUND", "REPLACEMENT", "STORE_CREDIT", "ARRIVED"]).nullish(),
  details: z.string().max(2000).nullish(),
});

/** Reportar un problema: Omni redacta el reclamo y, si la tienda atiende por correo, lo deja para aprobar. */
export async function POST(request: Request, { params }: Context) {
  return handle(request, async (auth) => {
    const { id } = await params;
    await rateLimit(auth.userId, "returns.claim", { limit: 20, windowSeconds: 3600 });
    return reportProblem(auth.userId, id, await readJson(request, schema));
  });
}
