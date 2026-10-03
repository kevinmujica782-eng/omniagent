import { z } from "zod";
import { handle, readJson } from "@/lib/http";
import { setSubscriptionUsage } from "@/modules/finance/finance.service";

type Context = { params: Promise<{ id: string }> };

const bodySchema = z.object({ inUse: z.boolean() });

/** El usuario confirma si usa o no una suscripción. */
export async function PATCH(request: Request, { params }: Context) {
  return handle(request, async (auth) => {
    const { id } = await params;
    const { inUse } = await readJson(request, bodySchema);
    const charge = await setSubscriptionUsage(auth.userId, id, inUse);
    return { id: charge.id, status: charge.status };
  });
}
