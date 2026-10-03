import { handle } from "@/lib/http";
import { syncAllConnections } from "@/modules/finance/sync.service";

export const maxDuration = 60;

/** Sincroniza todas las cuentas del usuario. */
export async function POST(request: Request) {
  return handle(request, (auth) => syncAllConnections(auth.userId));
}
