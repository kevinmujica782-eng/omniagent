import { z } from "zod";
import { handle, readJson } from "@/lib/http";
import { decideAction, getActionCard } from "@/modules/actions/actions.service";

type Context = { params: Promise<{ id: string }> };

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
