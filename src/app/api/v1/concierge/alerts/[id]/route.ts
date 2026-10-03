import { z } from "zod";
import { handle, readJson } from "@/lib/http";
import { dismissAlert, getAlertView } from "@/modules/concierge/alerts.service";

type Context = { params: Promise<{ id: string }> };

const schema = z.object({ status: z.literal("DISMISSED") });

export async function GET(request: Request, { params }: Context) {
  return handle(request, async (auth) => {
    const { id } = await params;
    return getAlertView(auth.userId, id);
  });
}

/** "Seguir esperando": descarta la alerta (Omni avisará de nuevo si baja más). */
export async function PATCH(request: Request, { params }: Context) {
  return handle(request, async (auth) => {
    const { id } = await params;
    await readJson(request, schema);
    return dismissAlert(auth.userId, id);
  });
}
