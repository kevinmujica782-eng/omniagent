import { NextResponse } from "next/server";
import { z } from "zod";
import { cronAuthorized } from "@/lib/cron";
import { env } from "@/lib/env";
import { log } from "@/lib/log";
import { pushAppNotification } from "@/modules/notifications/push.service";

export const maxDuration = 30;

const schema = z.object({ notificationId: z.uuid() });

/**
 * Lo llama la base (trigger on_notification_push con pg_net) cada vez que se crea una notificación para alguien que
 * activó las notificaciones push. Exige el mismo «Bearer CRON_SECRET» que las tareas programadas.
 */
export async function POST(request: Request) {
  const secret = env().CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET no está configurado" }, { status: 503 });
  if (!cronAuthorized(request.headers.get("authorization"), secret)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Falta notificationId" }, { status: 400 });
  try {
    const result = await pushAppNotification(parsed.data.notificationId);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    log.error("push.dispatch_failed", { notificationId: parsed.data.notificationId, error });
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
