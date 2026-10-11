import { ensureProfile } from "@/lib/auth";
import { handle, readJson } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { createAssistant, listAssistants } from "@/modules/assistants/assistants.service";
import { assistantCreateSchema } from "@/modules/assistants/assistants.types";

/** Los Dots de la persona. */
export async function GET(request: Request) {
  return handle(request, async (auth) => {
    const assistants = await listAssistants(auth.userId);
    return { assistants };
  });
}

/** Crea un Dot. */
export async function POST(request: Request) {
  return handle(request, async (auth) => {
    const body = await readJson(request, assistantCreateSchema);
    await rateLimit(auth.userId, "assistant.create", { limit: 30, windowSeconds: 3600 });
    await ensureProfile(auth);
    const assistant = await createAssistant(auth.userId, body);
    return { assistant };
  });
}
