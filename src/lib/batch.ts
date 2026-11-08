// Lotes con tiempo máximo para las tareas programadas (puro). Cada corrida vive dentro de una función serverless de
// 60 s: se trabaja con varios elementos a la vez y no se empieza uno nuevo cuando se acaba el tiempo. Lo que no alcanza
// queda para la próxima corrida, que vuelve a empezar por lo más atrasado.

/**
 * Tiempo para empezar trabajo nuevo en una corrida. Deja margen, dentro de los 60 s de la función, para lo que ya
 * empezó (una página lenta, una respuesta de la IA), el arranque en frío y lo que la tarea hace al final.
 */
export const CRON_BUDGET_MS = 30_000;

export interface BatchResult {
  /** Terminaron bien. */
  done: number;
  /** Fallaron: el error va a `onError` y los demás siguen. */
  failed: number;
  /** No se empezaron por falta de tiempo: quedan para la próxima corrida. */
  pending: number;
}

export interface BatchOptions<T> {
  /** Milisegundos para empezar elementos nuevos; los que ya empezaron terminan. */
  budgetMs: number;
  /** Cuántos a la vez (1 por defecto). */
  concurrency?: number;
  onError?: (item: T, error: unknown) => void;
  /** Reloj en milisegundos (las pruebas usan uno falso). */
  now?: () => number;
}

/** Procesa `items` en orden, varios a la vez, sin empezar uno nuevo después del tiempo máximo. */
export async function runBatch<T>(
  items: readonly T[],
  handler: (item: T) => Promise<unknown>,
  opts: BatchOptions<T>,
): Promise<BatchResult> {
  const now = opts.now ?? Date.now;
  const deadline = now() + Math.max(0, opts.budgetMs);
  const result: BatchResult = { done: 0, failed: 0, pending: 0 };
  let next = 0;
  const worker = async () => {
    while (next < items.length && now() < deadline) {
      const item = items[next++];
      try {
        await handler(item);
        result.done++;
      } catch (error) {
        result.failed++;
        opts.onError?.(item, error);
      }
    }
  };
  const workers = Math.min(Math.max(1, Math.floor(opts.concurrency ?? 1)), Math.max(1, items.length));
  await Promise.all(Array.from({ length: workers }, worker));
  result.pending = items.length - next;
  return result;
}

/** Milisegundos que quedan hasta `deadline` (nunca negativo). */
export function timeLeft(deadline: number, now: () => number = Date.now): number {
  return Math.max(0, deadline - now());
}
