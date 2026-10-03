import { handle } from "@/lib/http";
import { checkNow } from "@/modules/concierge/tracking.service";

export const maxDuration = 30;

type Context = { params: Promise<{ id: string }> };

/** "Revisar ahora" (con el límite de frecuencia del plan). */
export async function POST(request: Request, { params }: Context) {
  return handle(request, async (auth) => {
    const { id } = await params;
    return checkNow(auth.userId, id);
  });
}
