import { handle } from "@/lib/http";
import { openAnalysisConversation } from "@/modules/finance/insights/analysis.service";

type Context = { params: Promise<{ id: string }> };

/** Abre el chat con Omni a partir del informe (devuelve el id de la conversación). */
export async function POST(request: Request, { params }: Context) {
  return handle(request, async (auth) => {
    const { id } = await params;
    return openAnalysisConversation(auth.userId, id);
  });
}
