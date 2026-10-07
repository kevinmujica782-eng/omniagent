import { z } from "zod";
import { ensureProfile } from "@/lib/auth";
import { handle, readJson } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { toMemoryView } from "@/modules/memory/memory.rules";
import { forgetAllMemories, listMemories, rememberMemory } from "@/modules/memory/memory.service";
import { MEMORY_KINDS, memoryInputSchema, type MemoryKind } from "@/modules/memory/memory.types";

function isMemoryKind(value: string | null): value is MemoryKind {
  return value !== null && (MEMORY_KINDS as readonly string[]).includes(value);
}

/** Lo que Omni recuerda de la persona (opcional: ?kind=WEBSITE). */
export async function GET(request: Request) {
  return handle(request, async (auth) => {
    const kind = new URL(request.url).searchParams.get("kind");
    const memories = await listMemories(auth.userId, { kinds: isMemoryKind(kind) ? [kind] : undefined });
    return { memories: memories.map(toMemoryView) };
  });
}

/** La persona agrega algo para que Omni lo recuerde. */
export async function POST(request: Request) {
  return handle(request, async (auth) => {
    const body = await readJson(request, memoryInputSchema);
    await rateLimit(auth.userId, "memory.save", { limit: 60, windowSeconds: 3600 });
    await ensureProfile(auth);
    const { memory, created } = await rememberMemory(auth.userId, body, { source: "USER" });
    return { memory: toMemoryView(memory), created };
  });
}

/** Borra toda la memoria. Pide { "confirm": "BORRAR" }. */
export async function DELETE(request: Request) {
  return handle(request, async (auth) => {
    await readJson(request, z.object({ confirm: z.literal("BORRAR") }));
    return forgetAllMemories(auth.userId);
  });
}
