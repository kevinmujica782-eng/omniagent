import { handle } from "@/lib/http";
import { listOrderViews } from "@/modules/concierge/tracking.service";

export async function GET(request: Request) {
  return handle(request, (auth) => listOrderViews(auth.userId));
}
