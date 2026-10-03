import { z } from "zod";
import { handle, readJson } from "@/lib/http";
import { getOrderView, updateOrder } from "@/modules/returns/returns.service";

type Context = { params: Promise<{ id: string }> };

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Usa el formato AAAA-MM-DD.");

const patchSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("delivered"), deliveredOn: DATE.nullish() }),
  z.object({ action: z.literal("dismiss") }),
  z.object({ action: z.literal("restore") }),
  z.object({
    action: z.literal("edit"),
    merchant: z.string().trim().min(2).max(80).optional(),
    title: z.string().trim().min(2).max(160).optional(),
    orderNumber: z.string().trim().max(40).nullable().optional(),
    expectedOn: DATE.nullable().optional(),
    supportEmail: z.email().max(200).nullable().optional(),
    total: z.number().positive().max(1_000_000).nullable().optional(),
  }),
]);

export async function GET(request: Request, { params }: Context) {
  return handle(request, async (auth) => {
    const { id } = await params;
    return getOrderView(auth.userId, id);
  });
}

/** Entregado, dejar de seguir, volver a seguir o corregir datos (tienda, correo de atención, fecha prometida…). */
export async function PATCH(request: Request, { params }: Context) {
  return handle(request, async (auth) => {
    const { id } = await params;
    return updateOrder(auth.userId, id, await readJson(request, patchSchema));
  });
}

/** Solo pedidos agregados a mano o de ejemplo (los demás se dejan de seguir). */
export async function DELETE(request: Request, { params }: Context) {
  return handle(request, async (auth) => {
    const { id } = await params;
    return updateOrder(auth.userId, id, { action: "delete" });
  });
}
