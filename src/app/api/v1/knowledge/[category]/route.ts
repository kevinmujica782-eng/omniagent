import { ensureProfile } from "@/lib/auth";
import { Errors } from "@/lib/errors";
import { handle, readJson } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { setKnowledge } from "@/modules/knowledge/knowledge.service";
import { categorySchema, knowledgeUpdateSchema } from "@/modules/knowledge/knowledge.types";

type Context = { params: Promise<{ category: string }> };

/** Reemplaza las líneas de una categoría del conocimiento base. */
export async function PUT(request: Request, { params }: Context) {
  return handle(request, async (auth) => {
    const { category } = await params;
    const parsed = categorySchema.safeParse(category.toUpperCase());
    if (!parsed.success) throw Errors.notFound("La categoría");
    const body = await readJson(request, knowledgeUpdateSchema);
    await rateLimit(auth.userId, "knowledge.save", { limit: 60, windowSeconds: 3600 });
    await ensureProfile(auth);
    const entry = await setKnowledge(auth.userId, parsed.data, body.items);
    return { entry };
  });
}
