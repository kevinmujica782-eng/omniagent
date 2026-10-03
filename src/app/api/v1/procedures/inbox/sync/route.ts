import { handle } from "@/lib/http";
import { syncAllMailboxes } from "@/modules/procedures/mail/mail.service";
import { listProcedures } from "@/modules/procedures/plan";

export const maxDuration = 60;

/** "Revisar correo": sincroniza todas las bandejas, clasifica lo nuevo y devuelve lo que falta confirmar. */
export async function POST(request: Request) {
  return handle(request, async (auth) => {
    const sync = await syncAllMailboxes(auth.userId);
    const suggested = await listProcedures(auth.userId, "suggested");
    return { sync, suggested };
  });
}
