import { AppError } from "@/lib/errors";

// Límites y errores del importador. Los errores son AppError: la API los devuelve con su código y un mensaje
// que la interfaz muestra tal cual.

/** Vercel acepta cuerpos de hasta 4,5 MB: los archivos se limitan a 4 MB (igual que los PDF de trámites). */
export const MAX_STATEMENT_BYTES = 4 * 1024 * 1024;
/** Más de un año de movimientos de una cuenta muy activa. */
export const MAX_STATEMENT_ROWS = 5_000;
export const MAX_PDF_PAGES = 60;

export type StatementErrorCode =
  | "file_required"
  | "file_too_large"
  | "empty_file"
  | "unsupported_file_type"
  | "corrupted_file"
  | "pdf_password_required"
  | "pdf_password_incorrect"
  | "scanned_pdf"
  | "too_many_pages"
  | "columns_not_found"
  | "invalid_mapping"
  | "no_transactions_found"
  | "too_many_rows";

const STATUS: Record<StatementErrorCode, number> = {
  file_required: 400,
  file_too_large: 413,
  empty_file: 400,
  unsupported_file_type: 415,
  corrupted_file: 422,
  pdf_password_required: 422,
  pdf_password_incorrect: 422,
  scanned_pdf: 422,
  too_many_pages: 422,
  columns_not_found: 422,
  invalid_mapping: 422,
  no_transactions_found: 422,
  too_many_rows: 422,
};

export function statementError(code: StatementErrorCode, message: string, details?: unknown): AppError {
  return new AppError(STATUS[code], code, message, details);
}
