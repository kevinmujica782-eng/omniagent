import "server-only";
import { z } from "zod";
import { Errors } from "@/lib/errors";
import { MAX_SCAN_IMAGES, MAX_STATEMENT_BYTES, statementError } from "./limits";

// Lectura de la subida (multipart/form-data): el campo "file" con el CSV o PDF y "options" con un JSON opcional.
// Con `options.scanId` (lectura con IA ya hecha) no hace falta el archivo: se usa lo transcrito.

const columnRef = z.union([z.string().trim().min(1).max(80), z.number().int().min(0).max(200)]);

export const statementOptionsSchema = z.object({
  /** Cuenta manual existente. */
  accountId: z.uuid().optional(),
  /** O los datos de una cuenta nueva (se crea al importar, no en la vista previa). */
  newAccount: z
    .object({
      institutionName: z.string().trim().min(1).max(60),
      name: z.string().trim().min(1).max(60).optional(),
      type: z.enum(["CHECKING", "SAVINGS", "CREDIT_CARD", "WALLET", "OTHER"]).default("CHECKING"),
      currency: z
        .string()
        .trim()
        .regex(/^[A-Za-z]{3}$/)
        .transform((value) => value.toUpperCase())
        .optional(),
      mask: z.string().trim().regex(/^\d{4}$/).optional(),
    })
    .optional(),
  /** Columnas del CSV elegidas a mano (encabezado o posición desde 0). */
  mapping: z
    .object({
      date: columnRef.optional(),
      description: columnRef.optional(),
      amount: columnRef.optional(),
      debit: columnRef.optional(),
      credit: columnRef.optional(),
      type: columnRef.optional(),
      balance: columnRef.optional(),
    })
    .optional(),
  dateOrder: z.enum(["DMY", "MDY", "YMD"]).optional(),
  signConvention: z.enum(["negative_is_debit", "positive_is_debit"]).optional(),
  /** Contraseña del PDF: solo se usa en memoria para abrirlo. */
  password: z.string().min(1).max(128).optional(),
  /** Lectura con IA ya terminada (fotos o PDF escaneado): reemplaza al archivo. */
  scanId: z.uuid().optional(),
});

export type StatementOptions = z.infer<typeof statementOptionsSchema>;

export interface StatementUpload {
  fileName: string;
  mimeType: string;
  /** null solo con `options.scanId`. */
  bytes: Uint8Array | null;
  options: StatementOptions;
}

/** El archivo más el resto del formulario (límites del multipart y el campo "options"). */
const MAX_BODY_BYTES = MAX_STATEMENT_BYTES + 512 * 1024;

const tooLarge = () => statementError("file_too_large", "El archivo supera los 4 MB. Descarga un periodo más corto.");

/**
 * Lee el cuerpo con un tope de bytes. Content-Length puede faltar (envío por partes): sin este tope, formData()
 * guardaría en memoria lo que llegue. En Vercel el límite es de 4,5 MB, pero no así en Docker.
 */
async function readBody(request: Request): Promise<Uint8Array<ArrayBuffer>> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = request.body?.getReader();
  while (reader) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw tooLarge();
    }
    chunks.push(value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

/** Nombre apto para mostrar y guardar: sin rutas, sin caracteres de control y de largo razonable. */
function cleanFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const clean = base.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 120);
  return clean || "estado-de-cuenta";
}

async function readForm(request: Request): Promise<FormData> {
  // Se rechaza antes de leer el cuerpo si ya se sabe que es demasiado grande.
  if (Number(request.headers.get("content-length") ?? "0") > MAX_BODY_BYTES) throw tooLarge();
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("multipart/form-data")) {
    throw Errors.badRequest("Envía el archivo como multipart/form-data en el campo «file».");
  }
  const body = await readBody(request);
  const form = await new Response(body, { headers: { "content-type": contentType } }).formData().catch(() => null);
  if (!form) throw Errors.badRequest("No se pudo leer el formulario. Vuelve a adjuntar el archivo.");
  return form;
}

function readOptions(form: FormData): StatementOptions {
  let options: unknown = {};
  const raw = form.get("options");
  if (typeof raw === "string" && raw.trim()) {
    try {
      options = JSON.parse(raw);
    } catch {
      throw Errors.badRequest("El campo «options» debe ser JSON válido.");
    }
  }
  return statementOptionsSchema.parse(options);
}

export async function readStatementUpload(request: Request): Promise<StatementUpload> {
  const form = await readForm(request);
  const options = readOptions(form);
  const file = form.get("file");
  if (!file || typeof file === "string") {
    // Con una lectura con IA ya hecha, lo transcrito reemplaza al archivo.
    if (options.scanId) return { fileName: "", mimeType: "", bytes: null, options };
    throw statementError("file_required", "Adjunta tu estado de cuenta en PDF o CSV.");
  }
  if (file.size === 0) throw statementError("empty_file", "El archivo está vacío.");
  if (file.size > MAX_STATEMENT_BYTES) {
    throw statementError("file_too_large", "El archivo supera los 4 MB. Descarga un periodo más corto.");
  }
  return {
    fileName: cleanFileName(file.name),
    mimeType: file.type || "",
    bytes: new Uint8Array(await file.arrayBuffer()),
    options,
  };
}

/** Fotos (una o varias) o un PDF escaneado para leer con IA: el campo "file", repetido una vez por archivo. */
export async function readScanUpload(request: Request): Promise<{ fileName: string; files: { fileName: string; mimeType: string; bytes: Uint8Array }[] }> {
  const form = await readForm(request);
  const entries = form.getAll("file").filter((entry): entry is File => typeof entry !== "string");
  if (entries.length === 0) throw statementError("file_required", "Adjunta las fotos o el PDF de tu estado de cuenta.");
  if (entries.length > MAX_SCAN_IMAGES) throw statementError("too_many_pages", `Sube hasta ${MAX_SCAN_IMAGES} fotos a la vez.`);
  const files = await Promise.all(
    entries.map(async (file) => ({
      fileName: cleanFileName(file.name),
      mimeType: file.type || "",
      bytes: new Uint8Array(await file.arrayBuffer()),
    })),
  );
  const fileName = files.length === 1 ? files[0].fileName : `${files.length} fotos del estado de cuenta`;
  return { fileName, files };
}
