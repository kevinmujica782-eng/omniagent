import { z } from "zod";
import { handle, readJson } from "@/lib/http";
import { getCaseView, updateCase } from "@/modules/returns/returns.service";

type Context = { params: Promise<{ id: string }> };

const patchSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("sent") }),
  z.object({ action: z.literal("propose") }),
  z.object({ action: z.literal("edit"), subject: z.string().max(200), body: z.string().max(6000) }),
  z.object({
    action: z.literal("reply"),
    text: z.string().max(8000).nullish(),
    kind: z.enum(["refund", "replacement", "store_credit", "return_label", "needs_info", "rejected", "shipping_update", "ack"]).nullish(),
    amount: z.number().positive().max(1_000_000).nullish(),
  }),
  z.object({ action: z.literal("package_sent") }),
  z.object({ action: z.literal("info_sent") }),
  z.object({ action: z.literal("refund_received"), amount: z.number().positive().max(1_000_000).nullish() }),
  z.object({ action: z.literal("close") }),
  z.object({ action: z.literal("reopen") }),
]);

export async function GET(request: Request, { params }: Context) {
  return handle(request, async (auth) => {
    const { id } = await params;
    return getCaseView(auth.userId, id);
  });
}

/**
 * Lo que pasa con el reclamo: lo enviaste tú, prepararlo para aprobar, editar el mensaje, qué respondió la tienda,
 * devolviste el paquete o mandaste los datos, llegó el dinero, cerrar o reabrir.
 */
export async function PATCH(request: Request, { params }: Context) {
  return handle(request, async (auth) => {
    const { id } = await params;
    return updateCase(auth.userId, id, await readJson(request, patchSchema));
  });
}
