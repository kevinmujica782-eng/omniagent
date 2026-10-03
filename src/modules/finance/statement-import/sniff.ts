import { MAX_STATEMENT_BYTES, statementError } from "./limits";
import type { StatementFormat } from "./types";

// Qué es el archivo lo decide su contenido, no su extensión: un PDF renombrado se lee como PDF, un Excel
// renombrado a .csv se rechaza con una pista útil y un ".pdf" que no es PDF se reporta como dañado.

const TEXT_EXTENSIONS = new Set(["csv", "txt", "tsv", ""]);
const EXCEL_EXTENSIONS = new Set(["xlsx", "xls", "xlsm", "ods", "numbers"]);

function startsWith(bytes: Uint8Array, signature: number[]): boolean {
  return signature.every((byte, i) => bytes[i] === byte);
}

function extensionOf(fileName: string): string {
  const match = /\.([A-Za-z0-9]{1,8})$/.exec(fileName.trim());
  return match ? match[1].toLowerCase() : "";
}

const EXCEL_HINT = "Parece un archivo de Excel. Ábrelo y usa «Guardar como» → CSV, o descarga el estado de cuenta en PDF.";

export function sniffFormat(bytes: Uint8Array, fileName: string, mimeType = ""): StatementFormat {
  if (bytes.byteLength === 0) throw statementError("empty_file", "El archivo está vacío.");
  if (bytes.byteLength > MAX_STATEMENT_BYTES) {
    throw statementError("file_too_large", "El archivo supera los 4 MB. Descarga un periodo más corto.");
  }
  const ext = extensionOf(fileName);
  const mime = mimeType.toLowerCase();

  // Un PDF de verdad empieza con "%PDF-" (a veces tras unos bytes de basura).
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, 1024));
  if (head.includes("%PDF-")) return "pdf";
  if (ext === "pdf" || mime === "application/pdf") {
    throw statementError("corrupted_file", "El archivo dice ser PDF pero no lo es: puede estar dañado o incompleto. Descárgalo de nuevo desde tu banco.");
  }

  // ZIP (xlsx, ods, docx) y OLE2 (xls antiguos).
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]) || startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) {
    throw statementError("unsupported_file_type", EXCEL_HINT);
  }
  if (EXCEL_EXTENSIONS.has(ext)) throw statementError("unsupported_file_type", EXCEL_HINT);
  const image =
    startsWith(bytes, [0x89, 0x50, 0x4e, 0x47]) || startsWith(bytes, [0xff, 0xd8, 0xff]) || head.startsWith("GIF8") || head.slice(8, 12) === "WEBP";
  if (image || mime.startsWith("image/")) {
    throw statementError(
      "unsupported_file_type",
      "Sube el estado de cuenta en PDF o CSV, no una foto. Puedes descargarlo desde la banca en línea de tu banco.",
    );
  }
  if (!TEXT_EXTENSIONS.has(ext)) {
    throw statementError("unsupported_file_type", `No leo archivos .${ext}. Sube el estado de cuenta en CSV o PDF.`);
  }
  if (!looksLikeText(bytes)) {
    throw statementError("corrupted_file", "El archivo no parece un CSV de texto: puede estar dañado.");
  }
  return "csv";
}

/** Texto (UTF-8, Latin-1 o UTF-16) y no un binario: casi sin caracteres de control. */
function looksLikeText(bytes: Uint8Array): boolean {
  const sample = bytes.subarray(0, 4096);
  if (isUtf16(sample)) return true;
  let control = 0;
  for (const byte of sample) {
    if (byte === 0 || (byte < 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d && byte !== 0x0c)) control++;
  }
  return control <= sample.length * 0.01;
}

function isUtf16(bytes: Uint8Array): boolean {
  if (startsWith(bytes, [0xff, 0xfe]) || startsWith(bytes, [0xfe, 0xff])) return true;
  // Sin BOM: letras ASCII con un byte nulo intercalado ("F\0e\0c\0h\0a\0").
  const pairs = Math.min(64, Math.floor(bytes.length / 2));
  if (pairs < 4) return false;
  let zeros = 0;
  for (let i = 0; i < pairs; i++) if (bytes[i * 2 + 1] === 0 && bytes[i * 2] !== 0) zeros++;
  return zeros >= pairs * 0.9;
}

export type TextEncoding = "utf-8" | "utf-16le" | "utf-16be" | "windows-1252";

/**
 * Decodifica el CSV. Muchos bancos exportan en Windows-1252 ("Descripción" con ó de un byte): si el archivo
 * no es UTF-8 válido, se lee así en lugar de mostrar "Descripci�n".
 */
export function decodeText(bytes: Uint8Array): { text: string; encoding: TextEncoding } {
  let encoding: TextEncoding;
  let body = bytes;
  if (startsWith(bytes, [0xef, 0xbb, 0xbf])) {
    encoding = "utf-8";
    body = bytes.subarray(3);
  } else if (startsWith(bytes, [0xff, 0xfe])) {
    encoding = "utf-16le";
    body = bytes.subarray(2);
  } else if (startsWith(bytes, [0xfe, 0xff])) {
    encoding = "utf-16be";
    body = bytes.subarray(2);
  } else if (isUtf16(bytes)) {
    encoding = "utf-16le";
  } else {
    try {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      return { text: text.replace(/^﻿/, ""), encoding: "utf-8" };
    } catch {
      encoding = "windows-1252";
    }
  }
  const text = new TextDecoder(encoding).decode(body);
  return { text: text.replace(/^﻿/, ""), encoding };
}
