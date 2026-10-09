import { handle } from "@/lib/http";
import { modelsForApp } from "@/modules/ai/ai.service";

/** Proveedores y modelos del router de IA: cuáles hay en este entorno y cuáles permite el plan de la persona. */
export async function GET(request: Request) {
  return handle(request, async (auth) => modelsForApp(auth.userId));
}
