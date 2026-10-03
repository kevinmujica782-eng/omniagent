import { handle } from "@/lib/http";
import { proposeFormReply } from "@/modules/procedures/documents/documents.service";

type Context = { params: Promise<{ id: string }> };

/** Prepara la respuesta al remitente con el PDF rellenado. Queda en Aprobaciones: no se envía sola. */
export async function POST(request: Request, { params }: Context) {
  return handle(request, async (auth) => {
    const { id } = await params;
    return proposeFormReply(auth.userId, id);
  });
}
