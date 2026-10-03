import { handle } from "@/lib/http";
import { disconnectConnection } from "@/modules/finance/sync.service";

type Context = { params: Promise<{ id: string }> };

/** Desconecta y borra las cuentas y movimientos de esa conexión. */
export async function DELETE(request: Request, { params }: Context) {
  return handle(request, async (auth) => {
    const { id } = await params;
    return disconnectConnection(auth.userId, id);
  });
}
