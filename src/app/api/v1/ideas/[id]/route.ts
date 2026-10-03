import { z } from "zod";
import { handle, readJson } from "@/lib/http";
import { setSuggestionStatus } from "@/modules/ideas/ideas.service";

type Context = { params: Promise<{ id: string }> };

const bodySchema = z.object({ status: z.enum(["ACCEPTED", "DISMISSED"]) });

export async function PATCH(request: Request, { params }: Context) {
  return handle(request, async (auth) => {
    const { id } = await params;
    const { status } = await readJson(request, bodySchema);
    return setSuggestionStatus(auth.userId, id, status);
  });
}
