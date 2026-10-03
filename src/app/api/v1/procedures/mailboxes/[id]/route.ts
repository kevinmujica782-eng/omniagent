import { handle } from "@/lib/http";
import { disconnectMailbox } from "@/modules/procedures/mail/mail.service";

type Context = { params: Promise<{ id: string }> };

/** Desconecta la bandeja: borra sus correos y las sugerencias sin confirmar. */
export async function DELETE(request: Request, { params }: Context) {
  return handle(request, async (auth) => {
    const { id } = await params;
    return disconnectMailbox(auth.userId, id);
  });
}
