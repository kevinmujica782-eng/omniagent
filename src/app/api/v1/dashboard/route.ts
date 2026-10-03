import { ensureProfile } from "@/lib/auth";
import { handle } from "@/lib/http";
import { getDashboard } from "@/modules/dashboard/dashboard.service";

/** Panel de Inicio en una llamada: lo urgente, finanzas, trámites, compras, agentes, avisos y plan. */
export async function GET(request: Request) {
  return handle(request, async (auth) => {
    await ensureProfile(auth);
    return getDashboard(auth.userId);
  });
}
