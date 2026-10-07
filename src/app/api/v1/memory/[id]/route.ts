import { z } from "zod";
import { handle, readJson } from "@/lib/http";
import { asImportance, toMemoryView } from "@/modules/memory/memory.rules";
import { forgetMemory, setMemoryFlags } from "@/modules/memory/memory.service";

type Context = { params: Promise<{ id: string }> };

const patchSchema = z
  .object({ pinned: z.boolean().optional(), importance: z.number().int().min(1).max(3).optional() })
  .refine((body) => body.pinned !== undefined || body.importance !== undefined, "Indica pinned o importance");

/** Fija o suelta un recuerdo, o cambia su importancia. */
export async function PATCH(request: Request, { params }: Context) {
  return handle(request, async (auth) => {
    const { id } = await params;
    const body = await readJson(request, patchSchema);
    const memory = await setMemoryFlags(auth.userId, id, { pinned: body.pinned, importance: asImportance(body.importance) });
    return { memory: toMemoryView(memory) };
  });
}

/** Olvida un recuerdo. */
export async function DELETE(request: Request, { params }: Context) {
  return handle(request, async (auth) => {
    const { id } = await params;
    return forgetMemory(auth.userId, id, "USER");
  });
}
