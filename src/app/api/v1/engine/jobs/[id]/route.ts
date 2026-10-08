import { handle } from "@/lib/http";
import { getJob } from "@/modules/engine/engine.service";

type Context = { params: Promise<{ id: string }> };

/** Un trabajo con sus pasos (la tarjeta en vivo lo vuelve a pedir cuando cambia). */
export async function GET(request: Request, { params }: Context) {
  return handle(request, async (auth) => {
    const { id } = await params;
    return { job: await getJob(auth.userId, id) };
  });
}
