import { z } from "zod";
import { ensureProfile } from "@/lib/auth";
import { handle, readJson } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { removeSubscription, saveSubscription } from "@/modules/notifications/push.service";

const endpoint = z
  .string()
  .url()
  .max(2048)
  .refine((value) => value.startsWith("https://"), "El endpoint debe ser HTTPS");

const saveSchema = z.object({
  endpoint,
  keys: z.object({ p256dh: z.string().min(10).max(512), auth: z.string().min(8).max(256) }),
});

/** Activa las notificaciones push en este teléfono o navegador. */
export async function POST(request: Request) {
  return handle(request, async (auth) => {
    const body = await readJson(request, saveSchema);
    await rateLimit(auth.userId, "push.subscribe", { limit: 20, windowSeconds: 3600 });
    await ensureProfile(auth);
    await saveSubscription(auth.userId, { ...body, userAgent: request.headers.get("user-agent")?.slice(0, 300) ?? null });
    return { enabled: true };
  });
}

/** Las apaga en este aparato. */
export async function DELETE(request: Request) {
  return handle(request, async (auth) => {
    const body = await readJson(request, z.object({ endpoint }));
    await removeSubscription(auth.userId, body.endpoint);
    return { enabled: false };
  });
}
