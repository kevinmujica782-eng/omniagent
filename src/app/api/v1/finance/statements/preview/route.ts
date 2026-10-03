import { handle } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { previewStatement } from "@/modules/finance/statement-import/statements.service";
import { readStatementUpload } from "@/modules/finance/statement-import/upload";

export const maxDuration = 30;

/**
 * POST /api/v1/finance/statements/preview — lee el estado de cuenta y devuelve lo que se importaría (periodo,
 * totales, primeras filas, filas omitidas y avisos) sin guardar nada. Mismo cuerpo que /import.
 */
export async function POST(request: Request) {
  return handle(request, async (auth) => {
    await rateLimit(auth.userId, "statements.preview", { limit: 60, windowSeconds: 3600 });
    const upload = await readStatementUpload(request);
    return previewStatement(auth.userId, upload);
  });
}
