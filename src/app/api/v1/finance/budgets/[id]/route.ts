import { handle } from "@/lib/http";
import { deleteBudget } from "@/modules/finance/budgets.service";

type Context = { params: Promise<{ id: string }> };

export async function DELETE(request: Request, { params }: Context) {
  return handle(request, async (auth) => {
    const { id } = await params;
    return deleteBudget(auth.userId, id);
  });
}
