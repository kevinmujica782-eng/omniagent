import { Errors } from "@/lib/errors";
import { handle } from "@/lib/http";
import { getConversationView } from "@/modules/agent/conversations";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Context) {
  return handle(request, async (auth) => {
    const { id } = await params;
    const conversation = await getConversationView(auth.userId, id);
    if (!conversation) throw Errors.notFound("La conversación");
    return conversation;
  });
}
