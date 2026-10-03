import { handle } from "@/lib/http";
import { listAlertViews, markAlertsSeen } from "@/modules/concierge/alerts.service";

export async function GET(request: Request) {
  return handle(request, (auth) => listAlertViews(auth.userId));
}

/** Marca como vistas las ofertas nuevas (el contador de Compras vuelve a cero). */
export async function POST(request: Request) {
  return handle(request, async (auth) => {
    await markAlertsSeen(auth.userId);
    return { ok: true };
  });
}
