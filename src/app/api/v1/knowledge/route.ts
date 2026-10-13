import { handle } from "@/lib/http";
import { listKnowledge } from "@/modules/knowledge/knowledge.service";

/** El conocimiento base de la persona: las cinco categorías con sus líneas. */
export async function GET(request: Request) {
  return handle(request, async (auth) => {
    const knowledge = await listKnowledge(auth.userId);
    return { knowledge };
  });
}
