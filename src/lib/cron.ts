import "server-only";
import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { env } from "./env";
import { requestIdOf } from "./http";
import { log } from "./log";

/** ¿Trae «Authorization: Bearer <CRON_SECRET>»? Comparación en tiempo constante. */
export function cronAuthorized(header: string | null, secret: string): boolean {
  const expected = Buffer.from(`Bearer ${secret}`);
  const given = Buffer.from(header ?? "");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * Ruta de tarea programada: exige "Authorization: Bearer <CRON_SECRET>" (Vercel Cron lo envía solo; Supabase
 * pg_cron o cualquier programador externo lo manda igual), mide y registra la corrida y nunca filtra detalles.
 */
export function cronRoute(job: string, run: () => Promise<Record<string, unknown>>) {
  return async function GET(request: Request): Promise<Response> {
    const secret = env().CRON_SECRET;
    if (!secret) return NextResponse.json({ error: "CRON_SECRET no está configurado" }, { status: 503 });
    if (!cronAuthorized(request.headers.get("authorization"), secret)) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    const requestId = requestIdOf(request);
    const started = Date.now();
    try {
      const result = await run();
      log.info("cron.done", { job, requestId, ms: Date.now() - started, ...result });
      return NextResponse.json({ ok: true, ...result }, { headers: { "x-request-id": requestId } });
    } catch (error) {
      log.error("cron.failed", { job, requestId, ms: Date.now() - started, error });
      return NextResponse.json({ ok: false, error: "La tarea falló; revisa los logs.", requestId }, { status: 500 });
    }
  };
}
