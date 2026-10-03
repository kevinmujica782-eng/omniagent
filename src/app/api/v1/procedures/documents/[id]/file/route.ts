import { getAuthContext } from "@/lib/auth";
import { errorResponse } from "@/lib/http";
import { getDocumentFile } from "@/modules/procedures/documents/documents.service";

type Context = { params: Promise<{ id: string }> };

/**
 * Descarga del PDF (original o rellenado). Siempre como adjunto: un PDF subido por el usuario no se
 * muestra dentro del dominio de la app.
 */
export async function GET(request: Request, { params }: Context) {
  try {
    const auth = await getAuthContext(request);
    const { id } = await params;
    const file = await getDocumentFile(auth.userId, id);
    const ascii = file.fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
    return new Response(new Uint8Array(file.bytes), {
      headers: {
        "Content-Type": file.mimeType,
        "Content-Length": String(file.bytes.byteLength),
        "Content-Disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
