import { after, NextResponse } from "next/server";
import { z } from "zod";
import { cronAuthorized, cronRoute } from "@/lib/cron";
import { env } from "@/lib/env";
import { log } from "@/lib/log";
import { INVOCATION_BUDGET_MS } from "@/modules/engine/engine.rules";
import { continueJob, runDueJobs } from "@/modules/engine/engine.service";

// Motor en segundo plano.
// GET: tarea programada de cada minuto (pg_cron): corre lo que quedó en cola, los reintentos, las aprobaciones que
//      vencieron y los trabajos cuyo ejecutor se cayó.
// POST { jobId }: una invocación a la que no le alcanzó el tiempo pide seguir con el trabajo; responde 202 al instante
//      y sigue después de responder, con su propio tiempo.
// Las dos exigen "Authorization: Bearer <CRON_SECRET>".
export const maxDuration = 60;

export const GET = cronRoute("engine", async () => ({ ...(await runDueJobs()) }));

const bodySchema = z.object({ jobId: z.uuid() });

export async function POST(request: Request) {
  const started = Date.now();
  const secret = env().CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET no está configurado" }, { status: 503 });
  if (!cronAuthorized(request.headers.get("authorization"), secret)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Falta jobId" }, { status: 400 });
  const { jobId } = parsed.data;
  after(async () => {
    try {
      const result = await continueJob(jobId, started + INVOCATION_BUDGET_MS);
      log.info("engine.continued", { jobId, ...result });
    } catch (error) {
      log.error("engine.continue_failed", { jobId, error });
    }
  });
  return NextResponse.json({ ok: true }, { status: 202 });
}
