import { ensureProfile } from "@/lib/auth";
import { handle } from "@/lib/http";
import { createLinkSession } from "@/modules/finance/sync.service";

/** Abre una sesión de conexión (como el link token de Plaid). En sandbox incluye las instituciones y sus cuentas. */
export async function POST(request: Request) {
  return handle(request, async (auth) => {
    await ensureProfile(auth);
    return createLinkSession(auth.userId);
  });
}
