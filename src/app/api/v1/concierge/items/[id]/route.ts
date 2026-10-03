import { z } from "zod";
import { handle, readJson } from "@/lib/http";
import { archiveTracking, getTrackedDetail, updateTracking } from "@/modules/concierge/tracking.service";

type Context = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  title: z.string().trim().min(2).max(160).optional(),
  targetPrice: z.number().positive().max(10_000_000).nullable().optional(),
  dropAlertPct: z.number().int().min(5).max(80).optional(),
  quantity: z.number().int().min(1).max(10).optional(),
  status: z.enum(["ACTIVE", "PAUSED"]).optional(),
});

/** Detalle con el historial de precios (hasta 90 días). */
export async function GET(request: Request, { params }: Context) {
  return handle(request, async (auth) => {
    const { id } = await params;
    return getTrackedDetail(auth.userId, id);
  });
}

export async function PATCH(request: Request, { params }: Context) {
  return handle(request, async (auth) => {
    const { id } = await params;
    return updateTracking(auth.userId, id, await readJson(request, patchSchema));
  });
}

/** Dejar de seguir (se archiva: los pedidos y el historial se conservan). */
export async function DELETE(request: Request, { params }: Context) {
  return handle(request, async (auth) => {
    const { id } = await params;
    return archiveTracking(auth.userId, id);
  });
}
