import { z } from "zod";
import { ensureProfile } from "@/lib/auth";
import { handle, readJson } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { runAgent } from "@/modules/agent/run-agent";
import { setSuggestionStatus } from "@/modules/ideas/ideas.service";

// El agente puede encadenar varias herramientas: damos margen en plataformas serverless.
export const maxDuration = 60;

const bodySchema = z.object({
  message: z.string().trim().min(1).max(4000),
  conversationId: z.uuid().optional(),
  module: z.enum(["GENERAL", "FINANCE", "PROCEDURES", "CONCIERGE", "GOALS"]).optional(),
  ideaId: z.uuid().optional(),
});

export async function POST(request: Request) {
  return handle(request, async (auth) => {
    const body = await readJson(request, bodySchema);
    // Ráfagas y scripts: la cuota mensual cuida el costo; esto cuida la plataforma.
    await rateLimit(auth.userId, "agent.chat", { limit: 20, windowSeconds: 60 });
    await ensureProfile(auth);
    const result = await runAgent({
      userId: auth.userId,
      message: body.message,
      conversationId: body.conversationId,
      module: body.module,
    });
    if (body.ideaId) {
      await setSuggestionStatus(auth.userId, body.ideaId, "ACCEPTED").catch(() => undefined);
    }
    return result;
  });
}
