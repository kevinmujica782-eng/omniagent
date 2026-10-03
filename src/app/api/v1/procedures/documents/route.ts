import { ensureProfile } from "@/lib/auth";
import { Errors } from "@/lib/errors";
import { handle } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { listFormDocuments, uploadForm } from "@/modules/procedures/documents/documents.service";

export const maxDuration = 30;

/** Las funciones serverless de Vercel aceptan cuerpos de hasta 4,5 MB: los PDF subidos se limitan a 4 MB. */
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

export async function GET(request: Request) {
  return handle(request, (auth) => listFormDocuments(auth.userId));
}

/** Subir un formulario PDF (multipart/form-data: file, taskId opcional). */
export async function POST(request: Request) {
  return handle(request, async (auth) => {
    await rateLimit(auth.userId, "documents.upload", { limit: 20, windowSeconds: 3600 });
    const form = await request.formData().catch(() => null);
    const file = form?.get("file");
    if (!file || typeof file === "string") throw Errors.badRequest("Adjunta un archivo PDF.");
    if (file.size > MAX_UPLOAD_BYTES) throw Errors.badRequest("El PDF supera los 4 MB.");
    if (file.size === 0) throw Errors.badRequest("El archivo está vacío.");
    const taskId = form?.get("taskId");
    await ensureProfile(auth);
    return uploadForm(auth.userId, {
      fileName: file.name || "formulario.pdf",
      bytes: new Uint8Array(await file.arrayBuffer()),
      taskId: typeof taskId === "string" ? taskId : null,
    });
  });
}
