import "server-only";
import { after } from "next/server";
import { env } from "@/lib/env";
import { log } from "@/lib/log";

// Cómo corre el motor en segundo plano sin servidores aparte:
// 1. Después de responder (Next after()): la misma invocación sigue con el trabajo mientras le quede tiempo.
// 2. Si a esa invocación no le alcanza, pide otra (POST /api/cron/engine con el CRON_SECRET) y termina.
// 3. Una tarea programada cada minuto (pg_cron → GET /api/cron/engine) retoma lo que quedó en cola, los reintentos
//    y los trabajos cuyo ejecutor se cayó a la mitad.

/** Corre `task` después de enviar la respuesta. Fuera de una petición (pruebas, scripts) devuelve false. */
export function afterResponse(task: () => Promise<unknown>): boolean {
  try {
    after(async () => {
      try {
        await task();
      } catch (error) {
        log.error("engine.background_failed", { error });
      }
    });
    return true;
  } catch {
    return false;
  }
}

/** Pide a otra invocación del servidor que siga con el trabajo. Sin CRON_SECRET, lo retoma la tarea programada. */
export async function requestContinuation(jobId: string): Promise<void> {
  const { CRON_SECRET: secret, NEXT_PUBLIC_APP_URL: base } = env();
  if (!secret) return;
  const response = await fetch(new URL("/api/cron/engine", base), {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
    body: JSON.stringify({ jobId }),
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(`La continuación respondió ${response.status}`);
}
