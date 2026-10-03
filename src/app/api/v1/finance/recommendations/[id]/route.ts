import { z } from "zod";
import { handle, readJson } from "@/lib/http";
import { applyRecommendation } from "@/modules/finance/insights/analysis.service";

type Context = { params: Promise<{ id: string }> };

const bodySchema = z.object({ decision: z.enum(["accept", "dismiss", "done"]) });

export async function PATCH(request: Request, { params }: Context) {
  return handle(request, async (auth) => {
    const { id } = await params;
    const { decision } = await readJson(request, bodySchema);
    return applyRecommendation(auth.userId, id, decision);
  });
}
