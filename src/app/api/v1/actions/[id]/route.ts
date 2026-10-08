import { z } from "zod";
import { handle, readJson } from "@/lib/http";
import { decideAction, getActionCard } from "@/modules/actions/actions.service";

type Context = { params: Promise<{ id: string }> };

// Al decidir, un trabajo del motor que esperaba esta aprobación sigue después de responder (por ejemplo, guardar en la
// memoria la página que se acaba de publicar): se le da el tiempo completo de la función.
export const maxDuration = 60;

const decisionSchema = z.object({ decision: z.enum(["approve", "reject"]) });

export async function GET(request: Request, { params }: Context) {
  return handle(request, async (auth) => {
    const { id } = await params;
    return getActionCard(auth.userId, id);
  });
}

/** Aprobar o rechazar lo que propuso el agente. Solo el dueño puede decidir y una sola vez. */
export async function POST(request: Request, { params }: Context) {
  return handle(request, async (auth) => {
    const { id } = await params;
    const { decision } = await readJson(request, decisionSchema);
    return decideAction(auth.userId, id, decision);
  });
}
