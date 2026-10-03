import { handle } from "@/lib/http";
import { listNotifications } from "@/modules/notifications/notifications.service";

/** Avisos de Omni (?limit=30). */
export async function GET(request: Request) {
  return handle(request, (auth) => {
    const limit = Number(new URL(request.url).searchParams.get("limit") ?? "30");
    return listNotifications(auth.userId, Number.isFinite(limit) ? limit : 30);
  });
}
