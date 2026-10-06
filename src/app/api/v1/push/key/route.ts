import { handle } from "@/lib/http";
import { vapidKeys } from "@/modules/notifications/push.service";

/** Llave pública VAPID: el navegador la necesita para suscribirse a las notificaciones push. */
export async function GET(request: Request) {
  return handle(request, async () => ({ publicKey: (await vapidKeys()).publicKey }));
}
