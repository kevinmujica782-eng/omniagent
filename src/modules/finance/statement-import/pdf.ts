import path from "node:path";
import { AppError } from "@/lib/errors";
import { MAX_PDF_PAGES, statementError } from "./limits";
import type { PdfTextItem } from "./pdf-layout";

// Texto y posiciones de un PDF con pdf.js (el mismo motor que usa pdf-parse, ya incluido en el proyecto y
// configurado en next.config.ts). Los estados de cuenta llegan de cualquier lado: pdf.js 5 ya no evalúa código
// de las fuentes (CVE-2024-4367) y aquí tampoco usa fuentes del sistema. La contraseña, si la hay, solo vive en
// memoria mientras se abre el archivo.

/** Códigos de PasswordException en pdf.js (PasswordResponses). */
const INCORRECT_PASSWORD = 2;

/**
 * Tope de trozos de texto. Un estado de cuenta de 60 páginas tiene unas decenas de miles; un PDF de 4 MB con
 * flujos comprimidos puede expandirse a millones y agotar la memoria de la función.
 */
const MAX_TEXT_ITEMS = 200_000;

const DESTROY_TIMEOUT_MS = 5_000;

/** Lo que entrega page.streamTextContent() (TextItem o TextMarkedContent de pdf.js). */
type TextChunk = { items: { str?: string; transform?: number[]; width?: number; height?: number }[] };

function openError(error: unknown, triedPassword: boolean): AppError {
  const { name, code } = (error ?? {}) as { name?: string; code?: number };
  if (name === "PasswordException") {
    return code === INCORRECT_PASSWORD || triedPassword
      ? statementError("pdf_password_incorrect", "La contraseña del PDF no es correcta.")
      : statementError(
          "pdf_password_required",
          "El PDF está protegido con contraseña. Escríbela para abrirlo; solo se usa para leerlo y no se guarda.",
        );
  }
  return statementError(
    "corrupted_file",
    "No pude abrir el PDF: está dañado o incompleto. Descárgalo de nuevo desde tu banco.",
  );
}

export async function extractPdfText(bytes: Uint8Array, password?: string): Promise<{ pages: number; items: PdfTextItem[] }> {
  // pdf.js se carga solo en el servidor y solo cuando hace falta (es grande).
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const standardFontDataUrl = `${path.join(process.cwd(), "node_modules/pdfjs-dist/standard_fonts")}/`;
  const task = pdfjs.getDocument({
    data: bytes.slice(),
    password,
    useSystemFonts: false,
    disableFontFace: true,
    standardFontDataUrl,
    verbosity: 0,
  });
  const doc = await task.promise.catch(async (error: unknown) => {
    await task.destroy().catch(() => undefined);
    throw openError(error, Boolean(password));
  });
  try {
    if (doc.numPages > MAX_PDF_PAGES) {
      throw statementError(
        "too_many_pages",
        `El PDF tiene ${doc.numPages} páginas y el máximo es ${MAX_PDF_PAGES}. Descarga un periodo más corto.`,
      );
    }
    const items: PdfTextItem[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      // Por partes: si el texto no tiene fin, se corta antes de juntarlo todo en memoria.
      const reader = (page.streamTextContent() as ReadableStream<TextChunk>).getReader();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        for (const raw of value.items) {
          if (typeof raw.str !== "string" || !raw.str.trim() || !raw.transform) continue;
          if (items.length >= MAX_TEXT_ITEMS) {
            // pdf.js exige un Error como motivo; sin cancelar, su tarea sigue viva y doc.destroy() no termina nunca.
            await reader.cancel(new Error("statement_text_limit")).catch(() => undefined);
            throw statementError(
              "too_many_rows",
              "El PDF tiene demasiado texto para ser un estado de cuenta. Descarga un periodo más corto.",
            );
          }
          const [a, b, , , x, y] = raw.transform;
          items.push({ page: n, str: raw.str, x, y, width: raw.width ?? 0, size: Math.hypot(a, b) || raw.height || 10 });
        }
      }
      page.cleanup();
    }
    return { pages: doc.numPages, items };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw statementError("corrupted_file", "No pude leer el contenido del PDF: puede estar dañado.");
  } finally {
    // Con tope de tiempo: un cierre de pdf.js que no termina no debe dejar colgada la solicitud.
    await Promise.race([doc.destroy().catch(() => undefined), new Promise((resolve) => setTimeout(resolve, DESTROY_TIMEOUT_MS).unref())]);
  }
}
