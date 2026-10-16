import { ensureProfile } from "@/lib/auth";
import { handle } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { createScan } from "@/modules/finance/statement-import/scan.service";
import { readScanUpload } from "@/modules/finance/statement-import/upload";

// Partir un PDF de 20 páginas y guardarlas cifradas toma unos segundos.
export const maxDuration = 30;

/**
 * POST /api/v1/finance/statements/scans — lectura con IA de un estado de cuenta en fotos o escaneado.
 *
 * multipart/form-data: «file» una vez por archivo (un PDF escaneado de hasta 20 páginas, o de 1 a 10 fotos JPG, PNG o
 * WebP; hasta 4 MB entre todos). Guarda las páginas cifradas y responde { data: StatementScanView }; después se pide
 * cada página con POST …/scans/:id/pages/:page y, cuando `ready`, la vista previa y la importación con
 * options.scanId. Subir otra vez el mismo documento retoma la lectura anterior. Cada página leída cuenta contra
 * el cupo mensual del plan (402 plan_limit si no alcanza).
 */
export async function POST(request: Request) {
  return handle(request, async (auth) => {
    await rateLimit(auth.userId, "statements.scan", { limit: 20, windowSeconds: 3600 });
    const upload = await readScanUpload(request);
    await ensureProfile(auth);
    return createScan(auth.userId, upload);
  });
}
