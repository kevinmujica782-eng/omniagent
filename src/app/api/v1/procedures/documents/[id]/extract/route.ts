import { z } from "zod";
import { Errors } from "@/lib/errors";
import { handle } from "@/lib/http";
import { extractForm } from "@/modules/procedures/documents/documents.service";

// Claude lee el PDF completo (texto e imagen de cada página): puede tardar varios segundos.
export const maxDuration = 60;

type Context = { params: Promise<{ id: string }> };

const bodySchema = z.object({
  preferAI: z.boolean().default(true),
  /** Volver a leerlo aunque ya esté leído. */
  force: z.boolean().default(false),
});

export async function POST(request: Request, { params }: Context) {
  return handle(request, async (auth) => {
    const { id } = await params;
    const text = await request.text().catch(() => "");
    let raw: unknown = {};
    if (text.trim()) {
      try {
        raw = JSON.parse(text);
      } catch {
        throw Errors.badRequest("El cuerpo de la solicitud debe ser JSON válido.");
      }
    }
    return extractForm(auth.userId, id, bodySchema.parse(raw));
  });
}
