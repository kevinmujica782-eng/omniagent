import "server-only";
import { prisma } from "@/lib/db";
import { env, requireEnv } from "@/lib/env";
import { AppError, Errors } from "@/lib/errors";
import { log } from "@/lib/log";

// Dónde viven los binarios de los documentos:
// - "database" (por defecto): tabla document_blobs. Simple y suficiente para formularios de pocas páginas.
// - "supabase": bucket privado "documents" de Supabase Storage, ruta {userId}/{documentId}/{archivo}.
//   Se usa la llave secreta en el header apikey (las llaves sb_secret_ no son JWT); la heredada service_role
//   también va en Authorization.

export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
const BUCKET = "documents";

export type StorageDriver = "database" | "supabase";

export function activeStorageDriver(): StorageDriver {
  return env().DOCUMENT_STORAGE;
}

function supabaseStorage() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) throw Errors.notConfigured("Supabase Storage (NEXT_PUBLIC_SUPABASE_URL)");
  const key = requireEnv("SUPABASE_SECRET_KEY", "Supabase Storage (SUPABASE_SECRET_KEY)");
  const headers: Record<string, string> = { apikey: key };
  if (key.startsWith("eyJ")) headers.Authorization = `Bearer ${key}`;
  return { base: `${url.replace(/\/$/, "")}/storage/v1/object`, headers };
}

function encodePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

export function safeFileName(name: string): string {
  const cleaned = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\w.\- ]+/g, "")
    .replace(/\s+/g, "_")
    .slice(-120);
  return cleaned || "documento.pdf";
}

export async function putObject(
  driver: StorageDriver,
  input: { documentId: string; path: string; bytes: Uint8Array; mimeType: string },
): Promise<void> {
  if (input.bytes.byteLength > MAX_DOCUMENT_BYTES) throw Errors.badRequest("El archivo supera los 10 MB.");
  if (driver === "database") {
    // Prisma pide un Uint8Array respaldado por ArrayBuffer: la copia lo garantiza.
    await prisma.documentBlob.create({ data: { documentId: input.documentId, bytes: new Uint8Array(input.bytes) } });
    return;
  }
  const { base, headers } = supabaseStorage();
  const res = await fetch(`${base}/${BUCKET}/${encodePath(input.path)}`, {
    method: "POST",
    headers: { ...headers, "Content-Type": input.mimeType, "x-upsert": "true" },
    // Copia respaldada por ArrayBuffer (fetch no acepta vistas sobre SharedArrayBuffer).
    body: new Uint8Array(input.bytes),
  });
  if (!res.ok) {
    console.error("[storage] subida fallida", res.status, await res.text().catch(() => ""));
    throw new AppError(502, "storage_error", "No se pudo guardar el documento. Inténtalo de nuevo.");
  }
}

export async function getObject(driver: StorageDriver, input: { documentId: string; path: string }): Promise<Uint8Array> {
  if (driver === "database") {
    const blob = await prisma.documentBlob.findUnique({ where: { documentId: input.documentId } });
    if (!blob) throw Errors.notFound("El archivo");
    return new Uint8Array(blob.bytes);
  }
  const { base, headers } = supabaseStorage();
  const res = await fetch(`${base}/authenticated/${BUCKET}/${encodePath(input.path)}`, { headers });
  if (!res.ok) throw Errors.notFound("El archivo");
  return new Uint8Array(await res.arrayBuffer());
}

/**
 * Borra de Supabase Storage varios archivos de una vez (al eliminar una cuenta). Los guardados en la base
 * (document_blobs) se van solos en cascada con el perfil. Devuelve cuántos se borraron; nunca lanza.
 */
export async function deleteStoredFiles(paths: string[]): Promise<number> {
  if (paths.length === 0) return 0;
  const { base, headers } = supabaseStorage();
  let deleted = 0;
  for (let i = 0; i < paths.length; i += 1000) {
    const batch = paths.slice(i, i + 1000);
    const res = await fetch(`${base}/${BUCKET}`, {
      method: "DELETE",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ prefixes: batch }),
    }).catch(() => null);
    if (res?.ok) deleted += batch.length;
    else log.warn("storage.bulk_delete_failed", { files: batch.length, status: res?.status ?? null });
  }
  return deleted;
}

export async function deleteObject(driver: StorageDriver, input: { documentId: string; path: string }): Promise<void> {
  if (driver === "database") {
    await prisma.documentBlob.deleteMany({ where: { documentId: input.documentId } });
    return;
  }
  const { base, headers } = supabaseStorage();
  await fetch(`${base}/${BUCKET}`, {
    method: "DELETE",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ prefixes: [input.path] }),
  }).catch((error) => console.error("[storage] no se pudo borrar", error));
}
