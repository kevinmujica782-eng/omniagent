import { PDFDocument } from "pdf-lib";
import { MAX_SCAN_IMAGES, MAX_SCAN_PAGES, MAX_STATEMENT_BYTES, statementError } from "./limits";
import { imageTypeOf, unsupportedImageError, type ImageKind } from "./sniff";

// Las páginas que lee la IA: cada foto es una página y un PDF escaneado se parte en PDF de una página (con pdf-lib),
// para leer cada una en su propia petición (Netlify corta a los 60 s). Sin red ni base de datos.

export type ScanMediaType = ImageKind | "application/pdf";

export interface ScanFile {
  bytes: Uint8Array;
  fileName: string;
  mimeType?: string | null;
}

export interface ScanPageInput {
  /** Desde 1. */
  page: number;
  mediaType: ScanMediaType;
  bytes: Uint8Array;
}

export interface ScanDocument {
  source: "pdf" | "images";
  pages: ScanPageInput[];
}

const isPdf = (bytes: Uint8Array) => new TextDecoder("latin1").decode(bytes.subarray(0, 1024)).includes("%PDF-");

/** Un PDF de N páginas → N PDF de una página. Un PDF protegido no se puede partir (pdf-lib no descifra). */
async function splitPdf(bytes: Uint8Array): Promise<ScanPageInput[]> {
  let source: PDFDocument;
  try {
    source = await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (error) {
    const { name, message } = (error ?? {}) as { name?: string; message?: string };
    if (name === "EncryptedPDFError" || /encrypt/i.test(message ?? "")) {
      throw statementError(
        "scan_protected_pdf",
        "Este PDF está protegido con contraseña y es una imagen escaneada, así que no lo puedo abrir. Toma fotos o capturas de las páginas de movimientos y súbelas.",
      );
    }
    throw statementError("corrupted_file", "No pude abrir el PDF: está dañado o incompleto. Descárgalo de nuevo desde tu banco.");
  }
  const count = source.getPageCount();
  if (count === 0) throw statementError("corrupted_file", "El PDF no tiene páginas.");
  if (count > MAX_SCAN_PAGES) {
    throw statementError(
      "too_many_pages",
      `El PDF tiene ${count} páginas y leo con IA hasta ${MAX_SCAN_PAGES}. Sube solo las páginas con movimientos o un periodo más corto.`,
    );
  }
  const pages: ScanPageInput[] = [];
  for (let index = 0; index < count; index++) {
    const single = await PDFDocument.create({ updateMetadata: false });
    const [copied] = await single.copyPages(source, [index]);
    single.addPage(copied);
    pages.push({ page: index + 1, mediaType: "application/pdf", bytes: await single.save() });
  }
  return pages;
}

/** Las páginas de lo que se subió: un PDF (escaneado) o de 1 a 10 fotos. */
export async function scanPagesFromFiles(files: ScanFile[]): Promise<ScanDocument> {
  if (files.length === 0) throw statementError("file_required", "Adjunta las fotos o el PDF de tu estado de cuenta.");
  const total = files.reduce((sum, file) => sum + file.bytes.byteLength, 0);
  if (total > MAX_STATEMENT_BYTES) {
    throw statementError("file_too_large", "Entre todos los archivos pasan de 4 MB. Sube menos fotos a la vez o fotos más livianas.");
  }
  if (files.some((file) => file.bytes.byteLength === 0)) throw statementError("empty_file", "Uno de los archivos está vacío.");

  const pdfs = files.filter((file) => isPdf(file.bytes));
  if (pdfs.length > 0) {
    if (files.length > 1) {
      throw statementError("unsupported_file_type", "Sube un solo PDF, o solo fotos: no los dos a la vez.");
    }
    return { source: "pdf", pages: await splitPdf(files[0].bytes) };
  }

  if (files.length > MAX_SCAN_IMAGES) {
    throw statementError("too_many_pages", `Sube hasta ${MAX_SCAN_IMAGES} fotos a la vez.`);
  }
  const pages: ScanPageInput[] = files.map((file, index) => {
    const type = imageTypeOf(file.bytes);
    if (type === "heic") throw unsupportedImageError("heic");
    if (!type) {
      // Ni PDF ni imagen: probablemente un CSV o un Excel subido por aquí.
      throw statementError(
        "unsupported_file_type",
        files.length === 1
          ? "Ese archivo no es una foto ni un PDF. Los CSV se suben directo, sin lectura con IA."
          : `«${file.fileName}» no es una foto. Sube fotos en JPG o PNG.`,
      );
    }
    return { page: index + 1, mediaType: type, bytes: file.bytes };
  });
  return { source: "images", pages };
}
