import { z } from "zod";
import { ensureProfile } from "@/lib/auth";
import { handle, readJson } from "@/lib/http";
import { listJobs, startJob } from "@/modules/engine/engine.service";
import { PLAYBOOK_IDS } from "@/types/engine";

// Trabajos del motor en segundo plano. El asistente los pide por el chat (herramientas engine_*); esta API sirve a la
// interfaz y a clientes propios. Cada trabajo responde al instante y sigue en segundo plano.
export const maxDuration = 60;

const startSchema = z.object({
  playbook: z.enum(PLAYBOOK_IDS),
  input: z.record(z.string(), z.unknown()).default({}),
});

/** Los trabajos de la persona (?active=1: solo los que siguen en marcha). */
export async function GET(request: Request) {
  return handle(request, async (auth) => {
    const params = new URL(request.url).searchParams;
    const jobs = await listJobs(auth.userId, { activeOnly: params.get("active") === "1", take: Number(params.get("take") ?? 20) || 20 });
    return { jobs };
  });
}

/** Empieza un trabajo: { playbook, input }. Si ya hay uno igual en marcha, devuelve ese (created: false). */
export async function POST(request: Request) {
  return handle(request, async (auth) => {
    const body = await readJson(request, startSchema);
    await ensureProfile(auth);
    return startJob({ userId: auth.userId, playbook: body.playbook, input: body.input, source: "api" });
  });
}
