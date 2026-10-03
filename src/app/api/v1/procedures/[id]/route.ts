import { z } from "zod";
import { handle, readJson } from "@/lib/http";
import { getProcedure, parsePlanOverrides, rescheduleProcedure } from "@/modules/procedures/plan";

type Context = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  title: z.string().trim().min(3).max(140).optional(),
  /** Hora local: "2026-10-02" o "2026-10-02T19:00"; null quita la fecha. */
  due: z.string().max(20).nullable().optional(),
  plannedAt: z.string().max(20).nullable().optional(),
  remindAt: z.string().max(20).nullable().optional(),
  /** Pedir a Omni otra fecha sugerida. */
  recompute: z.boolean().default(false),
});

export async function GET(request: Request, { params }: Context) {
  return handle(request, async (auth) => {
    const { id } = await params;
    return getProcedure(auth.userId, id);
  });
}

/** Cambiar fechas o pedir otra sugerencia. Si ya estaba agendado, el calendario se actualiza. */
export async function PATCH(request: Request, { params }: Context) {
  return handle(request, async (auth) => {
    const { id } = await params;
    const { recompute, ...raw } = await readJson(request, patchSchema);
    const overrides = await parsePlanOverrides(auth.userId, raw);
    return rescheduleProcedure(auth.userId, id, overrides, { recompute });
  });
}
