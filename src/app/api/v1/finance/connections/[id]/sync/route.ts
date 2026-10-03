import { handle } from "@/lib/http";
import { syncConnection } from "@/modules/finance/sync.service";

export const maxDuration = 60;

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Context) {
  return handle(request, async (auth) => {
    const { id } = await params;
    return syncConnection(auth.userId, id);
  });
}
