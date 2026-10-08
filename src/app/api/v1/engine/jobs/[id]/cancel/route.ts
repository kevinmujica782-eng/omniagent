import { handle } from "@/lib/http";
import { cancelJob } from "@/modules/engine/engine.service";

type Context = { params: Promise<{ id: string }> };

/** Detiene un trabajo: si nadie lo está corriendo, ya; si está corriendo, al terminar el paso actual. */
export async function POST(request: Request, { params }: Context) {
  return handle(request, async (auth) => {
    const { id } = await params;
    return { job: await cancelJob(auth.userId, id) };
  });
}
