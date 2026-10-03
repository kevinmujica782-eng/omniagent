import { handle } from "@/lib/http";
import { deleteStatementImport } from "@/modules/finance/statement-import/statements.service";

type Context = { params: Promise<{ id: string }> };

/** DELETE /api/v1/finance/statements/:id — deshace la importación y borra sus movimientos. */
export async function DELETE(request: Request, { params }: Context) {
  return handle(request, async (auth) => {
    const { id } = await params;
    return deleteStatementImport(auth.userId, id);
  });
}
