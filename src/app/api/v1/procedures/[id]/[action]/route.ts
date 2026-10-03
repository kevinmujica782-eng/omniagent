import { z } from "zod";
import { Errors } from "@/lib/errors";
import { handle } from "@/lib/http";
import {
  completeProcedure,
  confirmProcedure,
  dismissProcedure,
  parsePlanOverrides,
  restoreProcedure,
  snoozeProcedure,
} from "@/modules/procedures/plan";

export const maxDuration = 30;

type Context = { params: Promise<{ id: string; action: string }> };

const confirmSchema = z.object({
  title: z.string().trim().min(3).max(140).optional(),
  due: z.string().max(20).nullable().optional(),
  plannedAt: z.string().max(20).nullable().optional(),
  remindAt: z.string().max(20).nullable().optional(),
});
const snoozeSchema = z.object({ preset: z.enum(["1h", "tonight", "tomorrow"]).default("tomorrow") });

/** El cuerpo es opcional (el toque de "Confirmar" no manda nada). */
async function optionalJson(request: Request): Promise<unknown> {
  const text = await request.text().catch(() => "");
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw Errors.badRequest("El cuerpo de la solicitud debe ser JSON válido.");
  }
}

/**
 * POST /api/v1/procedures/:id/confirm | dismiss | restore | complete | snooze
 * Confirmar es el "toque" que agenda el trámite con las fechas sugeridas (o las ajustadas).
 */
export async function POST(request: Request, { params }: Context) {
  return handle(request, async (auth) => {
    const { id, action } = await params;
    switch (action) {
      case "confirm": {
        const body = confirmSchema.parse(await optionalJson(request));
        const overrides = await parsePlanOverrides(auth.userId, body);
        return confirmProcedure(auth.userId, id, overrides);
      }
      case "dismiss":
        return dismissProcedure(auth.userId, id);
      case "restore":
        return restoreProcedure(auth.userId, id);
      case "complete":
        return completeProcedure(auth.userId, id);
      case "snooze": {
        const { preset } = snoozeSchema.parse(await optionalJson(request));
        return snoozeProcedure(auth.userId, id, preset);
      }
      default:
        throw Errors.notFound("La acción");
    }
  });
}
