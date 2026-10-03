import { ensureProfile } from "@/lib/auth";
import { handle } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { importStatement } from "@/modules/finance/statement-import/statements.service";
import { readStatementUpload } from "@/modules/finance/statement-import/upload";

// Los PDF largos tardan unos segundos en leerse.
export const maxDuration = 30;

/**
 * POST /api/v1/finance/statements/import — importa un estado de cuenta (CSV o PDF, hasta 4 MB).
 *
 * multipart/form-data:
 * - file: el archivo.
 * - options (JSON, opcional): { accountId } de una cuenta manual, o { newAccount: { institutionName, type,
 *   currency?, name?, mask? } }; además { mapping, dateOrder, signConvention, password } si la vista previa
 *   pidió corregir columnas, fechas, signos o abrir un PDF protegido.
 *
 * Respuesta: { data: StatementImportResultView }. Errores: file_required, file_too_large, empty_file,
 * unsupported_file_type, corrupted_file, pdf_password_required, pdf_password_incorrect, scanned_pdf,
 * too_many_pages, columns_not_found, invalid_mapping, no_transactions_found, too_many_rows, account_synced.
 */
export async function POST(request: Request) {
  return handle(request, async (auth) => {
    await rateLimit(auth.userId, "statements.import", { limit: 20, windowSeconds: 3600 });
    const upload = await readStatementUpload(request);
    await ensureProfile(auth);
    return importStatement(auth.userId, upload);
  });
}
