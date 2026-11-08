import { describe, expect, it } from "vitest";
import { runBatch, timeLeft } from "@/lib/batch";

/** Reloj falso: cada elemento avanza el tiempo lo que dice su valor. */
function fakeClock() {
  let ms = 0;
  return { now: () => ms, advance: (by: number) => (ms += by) };
}

describe("lotes de las tareas programadas", () => {
  it("procesa todo cuando alcanza el tiempo", async () => {
    const seen: number[] = [];
    const result = await runBatch([1, 2, 3], async (n) => seen.push(n), { budgetMs: 1_000 });
    expect(seen).toEqual([1, 2, 3]);
    expect(result).toEqual({ done: 3, failed: 0, pending: 0 });
  });

  it("no empieza uno nuevo cuando se acaba el tiempo y deja el resto para la próxima corrida", async () => {
    const clock = fakeClock();
    const seen: number[] = [];
    const result = await runBatch(
      [10, 20, 30, 40],
      async (ms) => {
        seen.push(ms);
        clock.advance(ms);
      },
      { budgetMs: 25, now: clock.now },
    );
    // El primero termina a los 10 ms y el segundo a los 30: el tercero ya no empieza.
    expect(seen).toEqual([10, 20]);
    expect(result).toEqual({ done: 2, failed: 0, pending: 2 });
  });

  it("un error no detiene a los demás", async () => {
    const errors: [string, string][] = [];
    const result = await runBatch(
      ["a", "b", "c"],
      async (item) => {
        if (item === "b") throw new Error("falló b");
      },
      { budgetMs: 1_000, onError: (item, error) => errors.push([item, error instanceof Error ? error.message : String(error)]) },
    );
    expect(result).toEqual({ done: 2, failed: 1, pending: 0 });
    expect(errors).toEqual([["b", "falló b"]]);
  });

  it("respeta cuántos van a la vez", async () => {
    let running = 0;
    let peak = 0;
    const result = await runBatch(
      Array.from({ length: 10 }, (_, i) => i),
      async () => {
        running++;
        peak = Math.max(peak, running);
        await new Promise((resolve) => setTimeout(resolve, 1));
        running--;
      },
      { budgetMs: 10_000, concurrency: 3 },
    );
    expect(result).toEqual({ done: 10, failed: 0, pending: 0 });
    expect(peak).toBe(3);
  });

  it("sin elementos o sin tiempo no hace nada", async () => {
    expect(await runBatch([], async () => undefined, { budgetMs: 1_000, concurrency: 4 })).toEqual({ done: 0, failed: 0, pending: 0 });
    let calls = 0;
    expect(await runBatch([1, 2], async () => calls++, { budgetMs: 0 })).toEqual({ done: 0, failed: 0, pending: 2 });
    expect(calls).toBe(0);
  });

  it("el tiempo que queda nunca es negativo", () => {
    expect(timeLeft(100, () => 40)).toBe(60);
    expect(timeLeft(100, () => 140)).toBe(0);
  });
});
