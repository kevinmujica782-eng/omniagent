import { handle } from "@/lib/http";
import { listRecentConversations } from "@/modules/agent/conversations";

export async function GET(request: Request) {
  return handle(request, (auth) => listRecentConversations(auth.userId, 20));
}
