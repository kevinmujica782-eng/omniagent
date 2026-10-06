import { handle } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { sendPushToUser } from "@/modules/notifications/push.service";

/** Manda una notificación de prueba a todos los aparatos donde la persona activó las notificaciones. */
export async function POST(request: Request) {
  return handle(request, async (auth) => {
    await rateLimit(auth.userId, "push.test", { limit: 5, windowSeconds: 600 });
    return sendPushToUser(auth.userId, {
      title: "Notificaciones activadas",
      body: "Así te avisará Omni cuando un precio baje o algo necesite tu visto bueno.",
      url: "/inicio",
      tag: "push-test",
    });
  });
}
