import { z } from "zod";
import { handle, readJson } from "@/lib/http";
import { extractForm } from "@/modules/procedures/documents/documents.service";
import { fillProcedureForm } from "@/modules/procedures/plan";

export const maxDuration = 30;

type Context = { params: Promise<{ id: string }> };

const bodySchema = z.object({
  /** id del campo → texto, casilla (true/false) o null. */
  values: z.record(z.string().max(10), z.union([z.string().max(500), z.boolean(), z.null()])),
  /** Guardar en "Mis datos" lo que el usuario escribió (nunca firmas ni casillas). */
  saveToProfile: z.boolean().default(true),
});

/** Genera la copia rellenada del PDF con los valores revisados por el usuario. */
export async function POST(request: Request, { params }: Context) {
  return handle(request, async (auth) => {
    const { id } = await params;
    const body = await readJson(request, bodySchema);
    const result = await fillProcedureForm(auth.userId, id, body);
    const extraction = await extractForm(auth.userId, id);
    return { ...result, extraction };
  });
}
