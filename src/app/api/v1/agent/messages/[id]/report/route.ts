import { handle, readJson } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { reportMessage, reportSchema } from "@/modules/agent/reports";

type Context = { params: Promise<{ id: string }> };

/** Reportar una respuesta de Omni (ofensiva, peligrosa, incorrecta...) sin salir de la app. */
export async function POST(request: Request, { params }: Context) {
  return handle(request, async (auth) => {
    const { id } = await params;
    const body = await readJson(request, reportSchema);
    await rateLimit(auth.userId, "agent.report", { limit: 30, windowSeconds: 3600 });
    return reportMessage(auth.userId, id, body);
  });
}
