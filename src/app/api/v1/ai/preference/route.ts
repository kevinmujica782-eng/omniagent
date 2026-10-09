import { z } from "zod";
import { ensureProfile } from "@/lib/auth";
import { handle, readJson } from "@/lib/http";
import { setPreferredProvider } from "@/modules/ai/ai.service";
import { AI_PROVIDER_IDS } from "@/types/ai";

const bodySchema = z.object({ provider: z.enum(["auto", ...AI_PROVIDER_IDS] as const) });

/** Elegir el modelo de IA de la persona (Cuenta → Modelo de IA). Devuelve la vista de modelos actualizada. */
export async function PUT(request: Request) {
  return handle(request, async (auth) => {
    const body = await readJson(request, bodySchema);
    await ensureProfile(auth);
    return setPreferredProvider(auth.userId, body.provider);
  });
}
