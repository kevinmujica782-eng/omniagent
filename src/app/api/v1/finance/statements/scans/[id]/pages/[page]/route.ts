import { handle } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { readScanPage } from "@/modules/finance/statement-import/scan.service";

// Una página por petición: la lectura con IA tiene un tope de 54 s y la función, de 60 s.
export const maxDuration = 60;

type Context = { params: Promise<{ id: string; page: string }> };

/**
 * POST /api/v1/finance/statements/scans/:id/pages/:page — lee esa página con IA (idempotente). Responde
 * { data: StatementScanPageView }: DONE con los movimientos leídos, FAILED con el motivo (`canRetry` si quedan
 * intentos) o READING si otra petición la está leyendo (vuelve a preguntar en unos segundos).
 */
export async function POST(request: Request, { params }: Context) {
  return handle(request, async (auth) => {
    await rateLimit(auth.userId, "statements.scan_page", { limit: 300, windowSeconds: 3600 });
    const { id, page } = await params;
    return readScanPage(auth.userId, id, Number(page));
  });
}
