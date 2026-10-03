import { handle } from "@/lib/http";
import { listActions } from "@/modules/actions/actions.service";

/** GET /api/v1/actions?filter=pending|history */
export async function GET(request: Request) {
  return handle(request, (auth) => {
    const filter = new URL(request.url).searchParams.get("filter") === "history" ? "history" : "pending";
    return listActions(auth.userId, filter);
  });
}
