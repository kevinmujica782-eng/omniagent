import { handle } from "@/lib/http";
import { deleteDocument, storedExtraction } from "@/modules/procedures/documents/documents.service";

type Context = { params: Promise<{ id: string }> };

/** Lo que ya se leyó del formulario (sin volver a leerlo). aiPending = falta la lectura con IA. */
export async function GET(request: Request, { params }: Context) {
  return handle(request, async (auth) => {
    const { id } = await params;
    return storedExtraction(auth.userId, id);
  });
}

export async function DELETE(request: Request, { params }: Context) {
  return handle(request, async (auth) => {
    const { id } = await params;
    return deleteDocument(auth.userId, id);
  });
}
