import { ensureProfile } from "@/lib/auth";
import { handle, readJson } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { chatForApp } from "@/modules/ai/ai.service";
import { AI_CHAT_MAX_BYTES, aiChatBodySchema } from "@/modules/ai/ai.validation";

// Router de IA para la app: un turno con OpenAI, Claude, Gemini o Grok (o el que elija el router). La respuesta
// tiene siempre la misma forma (AIResponse, en src/types/ai.ts); los errores, { error: { code: "ai_*", ... } }.
export const maxDuration = 60;

export async function POST(request: Request) {
  return handle(request, async (auth) => {
    const body = await readJson(request, aiChatBodySchema, { maxBytes: AI_CHAT_MAX_BYTES });
    // Ráfagas y scripts: la cuota mensual cuida el costo; esto cuida la plataforma.
    await rateLimit(auth.userId, "ai.chat", { limit: 20, windowSeconds: 60 });
    await ensureProfile(auth);
    // Si la persona cierra la app, se corta la llamada al proveedor.
    return chatForApp(auth.userId, body, { signal: request.signal });
  });
}
