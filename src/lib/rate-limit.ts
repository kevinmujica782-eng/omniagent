import "server-only";
import { prisma } from "./db";
import { Errors } from "./errors";
import { log } from "./log";
import { secondsUntilReset, windowStart } from "./rate-window";

// Límite de tasa de ventana fija, compartido entre instancias serverless (tabla rate_limits en Postgres).
// Protege lo caro o sensible (chat con IA, sesiones de pago, subidas) de ráfagas y scripts.
// Si la tabla no existe todavía o la base falla, deja pasar: disponibilidad antes que rigidez.

export async function rateLimit(
  subject: string,
  action: string,
  opts: { limit: number; windowSeconds: number; now?: Date },
): Promise<{ remaining: number }> {
  const now = opts.now ?? new Date();
  const start = windowStart(now, opts.windowSeconds);
  const key = `${action}:${subject}`;
  let count: number;
  try {
    const rows = await prisma.$queryRaw<{ count: number }[]>`
      INSERT INTO rate_limits (key, window_start, count) VALUES (${key}, ${start}, 1)
      ON CONFLICT (key, window_start) DO UPDATE SET count = rate_limits.count + 1
      RETURNING count`;
    count = Number(rows[0]?.count ?? 1);
  } catch (error) {
    log.warn("rate_limit.unavailable", { action, error });
    return { remaining: opts.limit };
  }
  if (count > opts.limit) {
    throw Errors.rateLimited("Vas muy rápido. Espera un momento y vuelve a intentarlo.", secondsUntilReset(now, opts.windowSeconds));
  }
  return { remaining: opts.limit - count };
}

/** Borra ventanas de más de un día (lo llama la tarea programada). */
export async function pruneRateLimits(now = new Date()): Promise<number> {
  const result = await prisma.rateLimit.deleteMany({ where: { windowStart: { lt: new Date(now.getTime() - 86_400_000) } } });
  return result.count;
}
