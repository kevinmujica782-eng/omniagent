import { z } from "zod";
import { handle, readJson } from "@/lib/http";
import { previewLink } from "@/modules/concierge/tracking.service";

export const maxDuration = 30;

const schema = z.object({
  url: z.string().trim().min(4).max(2000),
  /** Leer la página con IA si no publica datos de producto (cuenta en el cupo del plan). */
  useAI: z.boolean().default(false),
});

/** Vista previa de un enlace antes de seguirlo: qué es, cuánto cuesta y si se puede revisar solo. */
export async function POST(request: Request) {
  return handle(request, async (auth) => {
    const input = await readJson(request, schema);
    return previewLink(auth.userId, input.url, { useAI: input.useAI });
  });
}
