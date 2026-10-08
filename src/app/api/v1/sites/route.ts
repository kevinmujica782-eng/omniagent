import { handle } from "@/lib/http";
import { listSites } from "@/modules/sites/sites.service";

/** Las páginas web que Omni creó para la persona (crearlas y cambiarlas va por el motor: /api/v1/engine/jobs). */
export async function GET(request: Request) {
  return handle(request, async (auth) => ({ sites: await listSites(auth.userId) }));
}
