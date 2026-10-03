// Cuándo vuelve a revisar el agente cada precio: frecuencia del plan, reintentos con espera creciente tras un
// error y un pequeño desfase para no visitar todas las tiendas a la misma hora. Sin dependencias de servidor.

const MINUTE = 60_000;

/** Mientras una revisión está en curso, el producto queda "reservado" por este tiempo (evita revisiones dobles). */
export const LEASE_MINUTES = 10;
/** Tras tantos errores seguidos el seguimiento se pausa y se avisa al usuario. */
export const PAUSE_AFTER_FAILURES = 8;
/** Espera tras 1, 2, 3 y 4+ errores seguidos. */
const RETRY_MINUTES = [30, 120, 360, 1440];
/** Las páginas leídas con IA se revisan como mucho una vez al día (cuestan tokens). */
export const AI_MIN_MINUTES = 1440;

function unit(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return (h % 10_000) / 10_000;
}

export function nextCheckAt(
  now: Date,
  everyMinutes: number,
  opts: { failCount?: number; seed?: string; aiRead?: boolean } = {},
): Date {
  const failures = opts.failCount ?? 0;
  if (failures > 0) {
    const wait = RETRY_MINUTES[Math.min(failures, RETRY_MINUTES.length) - 1];
    return new Date(now.getTime() + wait * MINUTE);
  }
  const base = opts.aiRead ? Math.max(everyMinutes, AI_MIN_MINUTES) : everyMinutes;
  // Hasta 10% antes (máximo 45 min) según el producto: reparte la carga y nunca se pasa de la frecuencia del plan
  // (con un cron diario, llegar un poco tarde significaría esperar un día más).
  const jitter = Math.min(45, unit(`${opts.seed ?? ""}:${Math.floor(now.getTime() / 86_400_000)}`) * 0.1 * base);
  return new Date(now.getTime() + Math.round(base - jitter) * MINUTE);
}

/** "Revisar ahora": cada cuánto puede pedirlo el usuario, según su plan. */
export function manualCooldownMinutes(plan: "FREE" | "PRO"): number {
  return plan === "PRO" ? 5 : 60;
}

export function canCheckNow(lastCheckedAt: Date | null, now: Date, plan: "FREE" | "PRO"): { ok: true } | { ok: false; retryAt: Date } {
  if (!lastCheckedAt) return { ok: true };
  const retryAt = new Date(lastCheckedAt.getTime() + manualCooldownMinutes(plan) * MINUTE);
  return retryAt.getTime() <= now.getTime() ? { ok: true } : { ok: false, retryAt };
}
