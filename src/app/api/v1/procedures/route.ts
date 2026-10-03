import { z } from "zod";
import { ensureProfile } from "@/lib/auth";
import { handle, readJson } from "@/lib/http";
import { createProcedure, listProcedures, parsePlanOverrides } from "@/modules/procedures/plan";

export const maxDuration = 30;

const scopeSchema = z.enum(["suggested", "active", "done", "canceled"]);

const createSchema = z.object({
  title: z.string().trim().min(3).max(140),
  type: z.enum(["FORM_FILL", "EMAIL", "APPOINTMENT", "REMINDER", "DOCUMENT", "OTHER"]).default("OTHER"),
  notes: z.string().max(1000).optional(),
  /** Hora local: "2026-10-02" o "2026-10-02T19:00". */
  due: z.string().max(20).nullable().optional(),
  remindAt: z.string().max(20).nullable().optional(),
  /** true = confirmar de una vez (se agenda en el calendario). */
  confirm: z.boolean().default(false),
});

/** GET /api/v1/procedures?scope=suggested|active|done|canceled (por defecto: sugeridos y activos). */
export async function GET(request: Request) {
  return handle(request, async (auth) => {
    const raw = new URL(request.url).searchParams.get("scope");
    if (raw) return listProcedures(auth.userId, scopeSchema.parse(raw));
    const [suggested, active] = await Promise.all([
      listProcedures(auth.userId, "suggested"),
      listProcedures(auth.userId, "active"),
    ]);
    return { suggested, active };
  });
}

/** Trámite nuevo: Omni propone cuándo hacerlo y cuándo avisar. */
export async function POST(request: Request) {
  return handle(request, async (auth) => {
    const body = await readJson(request, createSchema);
    await ensureProfile(auth);
    const dates = await parsePlanOverrides(auth.userId, { due: body.due, remindAt: body.remindAt });
    return createProcedure(auth.userId, {
      title: body.title,
      type: body.type,
      notes: body.notes ?? null,
      due: dates.due ?? null,
      remindAt: dates.remindAt ?? null,
      source: "user",
      confirm: body.confirm,
    });
  });
}
