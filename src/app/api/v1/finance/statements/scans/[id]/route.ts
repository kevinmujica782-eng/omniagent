import { handle } from "@/lib/http";
import { deleteScan, getScan } from "@/modules/finance/statement-import/scan.service";

type Context = { params: Promise<{ id: string }> };

/** GET /api/v1/finance/statements/scans/:id — avance de la lectura con IA, página por página. */
export async function GET(request: Request, { params }: Context) {
  return handle(request, async (auth) => {
    const { id } = await params;
    return getScan(auth.userId, id);
  });
}

/** DELETE /api/v1/finance/statements/scans/:id — descarta la lectura (páginas y lo transcrito). */
export async function DELETE(request: Request, { params }: Context) {
  return handle(request, async (auth) => {
    const { id } = await params;
    return deleteScan(auth.userId, id);
  });
}
