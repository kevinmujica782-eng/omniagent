import { z } from "zod";
import { handle, readJson } from "@/lib/http";
import { markNotificationsRead } from "@/modules/notifications/notifications.service";

const schema = z.object({ ids: z.array(z.string()).max(100).nullable().optional() });

/** Marca avisos como leídos: { ids } o, sin ids, todos. */
export async function POST(request: Request) {
  return handle(request, async (auth) => {
    const { ids } = await readJson(request, schema);
    return { updated: await markNotificationsRead(auth.userId, ids ?? null) };
  });
}
