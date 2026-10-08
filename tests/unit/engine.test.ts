import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AppError, Errors } from "@/lib/errors";
import type { Logger } from "@/lib/log";
import { PLANS } from "@/modules/billing/plans";
import {
  INLINE_RETRY_MAX_MS,
  INVOCATION_BUDGET_MS,
  MAX_JOB_AGE_MS,
  RETRY_DELAYS_MS,
  SAFETY_MS,
  STEP_TIMEOUT_MAX_MS,
  StepOutputError,
  StepTimeoutError,
  cancelRemaining,
  countDone,
  failureMessage,
  initialSteps,
  isAbandoned,
  isRetryable,
  nextStepIndex,
  readSteps,
  retryDelayMs,
  stepsMatch,
  toJobView,
  waitingLinkOf,
  warningsOf,
} from "@/modules/engine/engine.rules";
import { drainJob, type JobAuditEntry, type JobNotice, type RunnerDeps } from "@/modules/engine/engine.runner";
import {
  defineStep,
  definePlaybook,
  done,
  optional,
  skip,
  waitFor,
  type PlaybookDefinition,
  type StepRecord,
} from "@/modules/engine/engine.types";
import { MemoryJobStore } from "../support/memory-job-store";

// Motor de ejecución autónoma: reglas puras (tiempos, reintentos, vista) y el ejecutor con un almacén en memoria que
// sigue las mismas reglas que Postgres (turno atómico, escrituras solo con el turno).

const T0 = new Date("2026-10-08T15:00:00Z");
const USER = "11111111-1111-4111-8111-111111111111";

const silent: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => silent,
};

function harness(playbooks: PlaybookDefinition[]) {
  const clock = { now: new Date(T0) };
  const store = new MemoryJobStore(() => clock.now);
  const notices: JobNotice[] = [];
  const audits: JobAuditEntry[] = [];
  const continued: string[] = [];
  const deps: RunnerDeps = {
    store,
    findPlaybook: (id) => playbooks.find((p) => p.id === id),
    loadProfile: async () => ({ timezone: "UTC", currency: "USD", name: "Laura", plan: "PRO", limits: PLANS.PRO, model: "modelo-de-prueba" }),
    notify: async (_userId, notice) => {
      notices.push(notice);
    },
    audit: async (entry) => {
      audits.push(entry);
    },
    continueElsewhere: async (jobId) => {
      continued.push(jobId);
    },
    now: () => clock.now,
    sleep: async (ms) => {
      clock.now = new Date(clock.now.getTime() + ms);
    },
    log: silent,
  };
  const advance = (ms: number) => {
    clock.now = new Date(clock.now.getTime() + ms);
  };
  async function enqueue(playbook: PlaybookDefinition, input: unknown = {}) {
    const row = await store.create({
      userId: USER,
      playbook: playbook.id,
      module: playbook.module,
      title: playbook.title(input),
      input,
      steps: initialSteps(playbook.steps),
      source: "agent",
      conversationId: null,
      activeKey: `${playbook.id}:${playbook.activeKey(input)}`,
    });
    if (!row) throw new Error("no se creó");
    return row.id;
  }
  const drain = (jobId: string, budgetMs = INVOCATION_BUDGET_MS) => drainJob(deps, jobId, { deadline: clock.now.getTime() + budgetMs });
  const steps = (jobId: string) => store.row(jobId).steps as StepRecord[];
  return { clock, store, notices, audits, continued, enqueue, drain, steps, advance };
}

const empty = z.object({});

// ── Reglas ───────────────────────────────────────────────────────────────────

describe("motor: reglas", () => {
  it("cada paso cabe en una invocación del servidor", () => {
    expect(INVOCATION_BUDGET_MS).toBeGreaterThanOrEqual(STEP_TIMEOUT_MAX_MS + SAFETY_MS);
    expect(INVOCATION_BUDGET_MS).toBeLessThan(60_000);
    expect(INLINE_RETRY_MAX_MS).toBeGreaterThanOrEqual(RETRY_DELAYS_MS[0]);
  });

  it("espera más entre cada reintento, con tope", () => {
    expect(retryDelayMs(1)).toBe(10_000);
    expect(retryDelayMs(2)).toBe(60_000);
    expect(retryDelayMs(3)).toBe(300_000);
    expect(retryDelayMs(9)).toBe(300_000);
    expect(retryDelayMs(0)).toBe(10_000);
  });

  it("reintenta lo pasajero, no lo que otro intento no cambia", () => {
    expect(isRetryable(new StepTimeoutError(1000))).toBe(true);
    expect(isRetryable(new Error("ECONNRESET"))).toBe(true);
    expect(isRetryable(new AppError(503, "bank_unavailable", "Tu banco no respondió."))).toBe(true);
    expect(isRetryable(Errors.notConfigured("La IA"))).toBe(false);
    expect(isRetryable(Errors.badRequest("Faltan datos."))).toBe(false);
    expect(isRetryable(Errors.planLimit("Pásate a Pro."))).toBe(false);
    expect(isRetryable(new StepOutputError("x"))).toBe(false);
    expect(isRetryable(z.object({ a: z.string() }).safeParse({}).error)).toBe(false);
  });

  it("mensajes para la persona, sin detalles internos", () => {
    expect(failureMessage(Errors.badRequest("Conecta una cuenta."))).toBe("Conecta una cuenta.");
    expect(failureMessage(new StepTimeoutError(45_000))).toBe("Tardó más de lo esperado.");
    expect(failureMessage(new Error("connect ECONNREFUSED 10.0.0.1:5432"))).not.toMatch(/10\.0\.0\.1/);
  });

  it("sigue el primer paso pendiente, en curso o esperando", () => {
    const steps = initialSteps([
      { key: "a", title: "A" },
      { key: "b", title: "B" },
      { key: "c", title: "C" },
    ]);
    expect(nextStepIndex(steps)).toBe(0);
    steps[0] = { ...steps[0], status: "SUCCEEDED" };
    steps[1] = { ...steps[1], status: "SKIPPED" };
    expect(nextStepIndex(steps)).toBe(2);
    steps[2] = { ...steps[2], status: "WAITING" };
    expect(nextStepIndex(steps)).toBe(2);
    steps[2] = { ...steps[2], status: "FAILED", note: "No respondió" };
    expect(nextStepIndex(steps)).toBe(-1);
    expect(countDone(steps)).toBe(3);
    expect(warningsOf(steps)).toEqual(["C: No respondió"]);
    expect(cancelRemaining(initialSteps([{ key: "a", title: "A" }]), T0)[0]).toMatchObject({ status: "CANCELED", finishedAt: T0.toISOString() });
  });

  it("lee los pasos guardados y comprueba que son los del playbook", () => {
    const steps = initialSteps([{ key: "a", title: "A" }]);
    expect(readSteps(JSON.parse(JSON.stringify(steps)))).toEqual(steps);
    expect(readSteps([{ key: "a" }])).toBeNull();
    expect(stepsMatch(steps, [{ key: "a" }])).toBe(true);
    expect(stepsMatch(steps, [{ key: "b" }])).toBe(false);
  });

  it("un trabajo abandonado vence; uno que espera una aprobación, no", () => {
    const steps = initialSteps([{ key: "a", title: "A" }]);
    const old = new Date(T0.getTime() - MAX_JOB_AGE_MS - 1);
    expect(isAbandoned(old, steps, T0)).toBe(true);
    expect(isAbandoned(old, [{ ...steps[0], status: "WAITING" }], T0)).toBe(false);
    expect(isAbandoned(new Date(T0.getTime() - 60_000), steps, T0)).toBe(false);
  });

  it("la vista dice qué espera, cuándo reintenta y si se puede detener", () => {
    const steps = initialSteps([{ key: "a", title: "A" }]);
    const base = {
      id: "j1",
      playbook: "daily.sweep",
      title: "Poner todo al día",
      steps,
      result: null,
      errorMessage: null,
      runAfter: T0,
      cancelRequestedAt: null,
      createdAt: T0,
      finishedAt: null,
    };
    expect(toJobView({ ...base, status: "WAITING" }, T0)).toMatchObject({ waitingHref: "/aprobaciones", cancellable: true, done: 0, total: 1 });
    const retrying = toJobView({ ...base, status: "QUEUED", runAfter: new Date(T0.getTime() + 60_000), steps: [{ ...steps[0], attempts: 1 }] }, T0);
    expect(retrying.retryAt).toBe(new Date(T0.getTime() + 60_000).toISOString());
    expect(toJobView({ ...base, status: "RUNNING", cancelRequestedAt: T0 }, T0).cancellable).toBe(false);
    expect(toJobView({ ...base, status: "SUCCEEDED" }, T0).cancellable).toBe(false);
    expect(toJobView({ ...base, playbook: "algo-viejo", status: "FAILED" }, T0).playbook).toBe("daily.sweep");
  });

  it("mientras espera, ofrece lo que conviene mirar antes de decidir (solo rutas de la app)", () => {
    const waiting = (data: unknown): StepRecord[] => [
      { ...initialSteps([{ key: "a", title: "A" }])[0], status: "WAITING", waitState: { actionIds: ["x"], data } },
    ];
    const preview = { label: "Ver la vista previa", href: "/s/dulce-hogar-k3x9?vista=previa" };
    expect(waitingLinkOf(waiting({ link: preview }))).toEqual(preview);
    expect(waitingLinkOf(waiting(null))).toBeNull();
    expect(waitingLinkOf(waiting({ link: { label: "Abrir", href: "https://otro-sitio.com" } }))).toBeNull();
    expect(waitingLinkOf(waiting({ link: { label: "Abrir", href: "//otro-sitio.com" } }))).toBeNull();
    expect(waitingLinkOf(waiting({ link: { label: "Abrir", href: "/\\otro-sitio.com" } }))).toBeNull();
    const base = {
      id: "j2",
      playbook: "website.create",
      title: "Crear tu página",
      result: null,
      errorMessage: null,
      runAfter: T0,
      cancelRequestedAt: null,
      createdAt: T0,
      finishedAt: null,
    };
    expect(toJobView({ ...base, status: "WAITING", steps: waiting({ link: preview }) }, T0).waitingLink).toEqual(preview);
    expect(toJobView({ ...base, status: "RUNNING", steps: waiting({ link: preview }) }, T0).waitingLink).toBeNull();
  });
});

// ── Ejecutor ─────────────────────────────────────────────────────────────────

describe("motor: corre los pasos en orden", () => {
  const sum = defineStep({
    key: "sum",
    title: "Sumar",
    module: "GENERAL",
    output: z.object({ total: z.number() }),
    timeoutMs: 5_000,
    maxAttempts: 1,
    run: async ({ input }) => done({ total: (input as { a: number; b: number }).a + (input as { a: number; b: number }).b }, "Sumado."),
  });
  // Con un tope largo: en una invocación con poco tiempo no alcanza a empezar (y cede el turno).
  const nothing = defineStep({
    key: "nothing",
    title: "Nada que hacer",
    module: "GENERAL",
    output: z.object({}),
    timeoutMs: 40_000,
    maxAttempts: 1,
    run: async () => skip("No hacía falta."),
  });
  const double = defineStep({
    key: "double",
    title: "Duplicar",
    module: "GENERAL",
    output: z.object({ value: z.number() }),
    timeoutMs: 5_000,
    maxAttempts: 1,
    run: async (ctx) => done({ value: (ctx.outputOf(sum)?.total ?? 0) * 2 }, "Duplicado."),
  });
  const playbook = definePlaybook({
    id: "daily.sweep",
    module: "GENERAL",
    input: z.object({ a: z.number(), b: z.number() }),
    title: () => "Calcular",
    activeKey: () => "calculo",
    steps: [sum, nothing, double],
    finish: ({ outputOf }) => ({ summary: `Resultado: ${outputOf(double)?.value}`, href: "/inicio", linkLabel: "Ver", notify: true, notifyTitle: "Listo" }),
  });

  it("cada paso recibe lo que dejó el anterior; al final avisa y libera la llave", async () => {
    const h = harness([playbook]);
    const id = await h.enqueue(playbook, { a: 2, b: 3 });
    const result = await h.drain(id);
    expect(result).toEqual({ claimed: true, status: "SUCCEEDED", ranSteps: 3, yielded: false });
    const row = h.store.row(id);
    expect(row).toMatchObject({ status: "SUCCEEDED", activeKey: null, lockedBy: null, currentStep: 3 });
    expect(row.result).toEqual({ summary: "Resultado: 10", href: "/inicio", linkLabel: "Ver", warnings: [] });
    expect(h.steps(id).map((s) => [s.status, s.note])).toEqual([
      ["SUCCEEDED", "Sumado."],
      ["SKIPPED", "No hacía falta."],
      ["SUCCEEDED", "Duplicado."],
    ]);
    expect(h.notices).toEqual([{ jobId: id, kind: "done", title: "Listo", body: "Resultado: 10", href: "/inicio" }]);
    expect(h.audits.map((a) => a.action)).toEqual(["engine.job.succeeded"]);
    // Ya terminó: otra invocación no lo toma.
    expect((await h.drain(id)).claimed).toBe(false);
  });

  it("las salidas se vuelven a leer (y validar) en otra invocación", async () => {
    const h = harness([playbook]);
    const id = await h.enqueue(playbook, { a: 1, b: 1 });
    // La primera invocación solo alcanza para el primer paso.
    const first = await h.drain(id, sum.timeoutMs + SAFETY_MS + 1);
    expect(first).toMatchObject({ status: "QUEUED", yielded: true, ranSteps: 1 });
    expect(h.continued).toEqual([id]);
    const second = await h.drain(id);
    expect(second.status).toBe("SUCCEEDED");
    expect(h.store.row(id).result).toMatchObject({ summary: "Resultado: 4" });
  });
});

describe("motor: fallos y reintentos", () => {
  it("un fallo pasajero corto se reintenta en la misma invocación", async () => {
    let calls = 0;
    const flaky = defineStep({
      key: "flaky",
      title: "Paso inestable",
      module: "GENERAL",
      output: z.object({ ok: z.boolean() }),
      timeoutMs: 5_000,
      maxAttempts: 3,
      run: async () => {
        calls += 1;
        if (calls === 1) throw new Error("ECONNRESET");
        return done({ ok: true }, "Bien.");
      },
    });
    const pb = definePlaybook({ id: "daily.sweep", module: "GENERAL", input: empty, title: () => "T", activeKey: () => "k", steps: [flaky], finish: () => ({ summary: "ok", notify: false }) });
    const h = harness([pb]);
    const id = await h.enqueue(pb);
    expect((await h.drain(id)).status).toBe("SUCCEEDED");
    expect(calls).toBe(2);
    expect(h.steps(id)[0]).toMatchObject({ status: "SUCCEEDED", attempts: 2, error: null });
  });

  it("un fallo con espera larga deja el trabajo en cola hasta su hora", async () => {
    let calls = 0;
    const slow = defineStep({
      key: "slow",
      title: "Paso",
      module: "GENERAL",
      output: z.object({ ok: z.boolean() }),
      timeoutMs: 5_000,
      maxAttempts: 3,
      run: async () => {
        calls += 1;
        if (calls <= 2) throw new AppError(503, "upstream", "El servicio no respondió.");
        return done({ ok: true }, "Bien.");
      },
    });
    const pb = definePlaybook({ id: "daily.sweep", module: "GENERAL", input: empty, title: () => "T", activeKey: () => "k", steps: [slow], finish: () => ({ summary: "ok", notify: false }) });
    const h = harness([pb]);
    const id = await h.enqueue(pb);
    // 1.º fallo: reintento corto en la misma invocación; 2.º: espera de un minuto, en cola.
    expect((await h.drain(id)).status).toBe("QUEUED");
    const queued = h.store.row(id);
    expect(queued.runAfter.getTime() - h.clock.now.getTime()).toBe(RETRY_DELAYS_MS[1]);
    expect(h.steps(id)[0]).toMatchObject({ status: "PENDING", attempts: 2, error: "El servicio no respondió." });
    expect((await h.drain(id)).claimed).toBe(false);
    h.advance(RETRY_DELAYS_MS[1]);
    expect((await h.drain(id)).status).toBe("SUCCEEDED");
    expect(calls).toBe(3);
  });

  it("un fallo de la persona o del plan no se reintenta: el trabajo falla y avisa", async () => {
    let calls = 0;
    const blocked = defineStep({
      key: "blocked",
      title: "Paso",
      module: "GENERAL",
      output: z.object({}),
      timeoutMs: 5_000,
      maxAttempts: 3,
      run: async () => {
        calls += 1;
        throw Errors.badRequest("Conecta una cuenta primero.");
      },
    });
    const after = defineStep({ key: "after", title: "Después", module: "GENERAL", output: z.object({}), timeoutMs: 5_000, maxAttempts: 1, run: async () => done({}, "x") });
    const pb = definePlaybook({ id: "daily.sweep", module: "GENERAL", input: empty, title: () => "Analizar", activeKey: () => "k", steps: [blocked, after], finish: () => ({ summary: "ok", notify: false }) });
    const h = harness([pb]);
    const id = await h.enqueue(pb);
    expect((await h.drain(id)).status).toBe("FAILED");
    expect(calls).toBe(1);
    expect(h.store.row(id)).toMatchObject({ status: "FAILED", errorMessage: "Conecta una cuenta primero.", activeKey: null });
    expect(h.steps(id).map((s) => s.status)).toEqual(["FAILED", "CANCELED"]);
    expect(h.notices[0]).toMatchObject({ kind: "failed", body: "Analizar: Conecta una cuenta primero." });
  });

  it("si un paso opcional falla, los demás siguen y queda como aviso", async () => {
    const broken = optional(
      defineStep({
        key: "mail",
        title: "Revisar tu correo",
        module: "PROCEDURES",
        output: z.object({}),
        timeoutMs: 5_000,
        maxAttempts: 1,
        run: async () => {
          throw Errors.badRequest("La contraseña de aplicación ya no sirve.");
        },
      }),
    );
    const fine = defineStep({ key: "prices", title: "Revisar precios", module: "CONCIERGE", output: z.object({}), timeoutMs: 5_000, maxAttempts: 1, run: async () => done({}, "Al día.") });
    const pb = definePlaybook({
      id: "daily.sweep",
      module: "GENERAL",
      input: empty,
      title: () => "Poner todo al día",
      activeKey: () => "k",
      steps: [broken, fine],
      finish: ({ warnings }) => ({ summary: `Avisos: ${warnings.length}`, notify: false }),
    });
    const h = harness([pb]);
    const id = await h.enqueue(pb);
    expect((await h.drain(id)).status).toBe("SUCCEEDED");
    expect(h.store.row(id).result).toMatchObject({
      summary: "Avisos: 1",
      warnings: ["Revisar tu correo: La contraseña de aplicación ya no sirve."],
    });
  });

  it("un paso que se pasa de su tiempo se corta (con la señal abortada) y se reintenta con tope", async () => {
    const seen: { signal: AbortSignal | null } = { signal: null };
    const hang = defineStep({
      key: "hang",
      title: "Paso lento",
      module: "GENERAL",
      output: z.object({}),
      timeoutMs: 20,
      maxAttempts: 1,
      run: async (ctx) => {
        seen.signal = ctx.signal;
        await new Promise((resolve) => setTimeout(resolve, 200));
        return done({}, "tarde");
      },
    });
    const pb = definePlaybook({ id: "daily.sweep", module: "GENERAL", input: empty, title: () => "T", activeKey: () => "k", steps: [hang], finish: () => ({ summary: "ok", notify: false }) });
    const h = harness([pb]);
    const id = await h.enqueue(pb);
    expect((await h.drain(id)).status).toBe("FAILED");
    expect(seen.signal?.aborted).toBe(true);
    expect(h.store.row(id).errorMessage).toBe("Tardó más de lo esperado.");
  });

  it("una salida que no cumple su esquema falla sin reintentos", async () => {
    let calls = 0;
    const wrong = defineStep({
      key: "wrong",
      title: "Paso",
      module: "GENERAL",
      output: z.object({ n: z.number() }),
      timeoutMs: 5_000,
      maxAttempts: 3,
      run: async () => {
        calls += 1;
        return done({ n: "uno" } as unknown as { n: number }, "x");
      },
    });
    const pb = definePlaybook({ id: "daily.sweep", module: "GENERAL", input: empty, title: () => "T", activeKey: () => "k", steps: [wrong], finish: () => ({ summary: "ok", notify: false }) });
    const h = harness([pb]);
    const id = await h.enqueue(pb);
    expect((await h.drain(id)).status).toBe("FAILED");
    expect(calls).toBe(1);
  });

  it("un intento que se cortó con el servidor cuenta; sin intentos, el paso falla", async () => {
    const step = defineStep({ key: "s", title: "Paso", module: "GENERAL", output: z.object({}), timeoutMs: 5_000, maxAttempts: 2, run: async () => done({}, "x") });
    const pb = definePlaybook({ id: "daily.sweep", module: "GENERAL", input: empty, title: () => "T", activeKey: () => "k", steps: [step], finish: () => ({ summary: "ok", notify: false }) });
    const h = harness([pb]);
    const id = await h.enqueue(pb);
    const steps = h.steps(id);
    // Un ejecutor lo tomó, empezó el 2.º intento y la invocación se cerró: su turno ya venció.
    h.store.patchRow(id, {
      status: "RUNNING",
      lockedBy: "otro",
      lockedUntil: new Date(T0.getTime() - 1),
      steps: [{ ...steps[0], status: "RUNNING", attempts: 2 }],
    });
    expect((await h.drain(id)).status).toBe("FAILED");
    expect(h.steps(id)[0]).toMatchObject({ status: "FAILED", note: "Tardó más de lo esperado." });
  });

  it("si el playbook ya no existe o cambió, el trabajo falla con un mensaje claro", async () => {
    const step = defineStep({ key: "s", title: "Paso", module: "GENERAL", output: z.object({}), timeoutMs: 5_000, maxAttempts: 1, run: async () => done({}, "x") });
    const pb = definePlaybook({ id: "daily.sweep", module: "GENERAL", input: empty, title: () => "T", activeKey: () => "k", steps: [step], finish: () => ({ summary: "ok", notify: false }) });
    const changed = definePlaybook({ ...pb, steps: [{ ...step, key: "otro" }] });
    const h = harness([changed]);
    const id = await h.enqueue(pb);
    expect((await h.drain(id)).status).toBe("FAILED");
    expect(h.store.row(id).errorMessage).toMatch(/Pídelo de nuevo/);
  });
});

describe("motor: esperar a la persona", () => {
  it("se pausa sin ocupar al servidor y sigue cuando se decide la aprobación", async () => {
    const seen: (string | null)[] = [];
    const approve = defineStep({
      key: "approve",
      title: "Esperar tu aprobación",
      module: "GENERAL",
      output: z.object({ approved: z.boolean() }),
      timeoutMs: 5_000,
      maxAttempts: 2,
      run: async (ctx) => {
        seen.push(ctx.resumed?.actionIds[0] ?? null);
        if (!ctx.resumed) return waitFor({ note: "Apruébala para publicarla.", actionIds: ["accion-1"], recheckAt: new Date(ctx.now.getTime() + 3_600_000), data: { slug: "x" } });
        return done({ approved: true }, "Aprobada.");
      },
    });
    const remember = defineStep({ key: "remember", title: "Recordar", module: "GENERAL", output: z.object({}), timeoutMs: 5_000, maxAttempts: 1, run: async () => done({}, "Recordada.") });
    const pb = definePlaybook({ id: "website.create", module: "GENERAL", input: empty, title: () => "Crear", activeKey: () => "k", steps: [approve, remember], finish: () => ({ summary: "Publicada", notify: false }) });
    const h = harness([pb]);
    const id = await h.enqueue(pb);

    expect((await h.drain(id)).status).toBe("WAITING");
    expect(h.store.row(id)).toMatchObject({ status: "WAITING", waitingFor: ["accion-1"], lockedBy: null });
    expect(h.steps(id)[0]).toMatchObject({ status: "WAITING", attempts: 0, waitState: { actionIds: ["accion-1"], data: { slug: "x" } } });
    expect(toJobView(h.store.row(id), h.clock.now).waitingHref).toBe("/aprobaciones");

    // Nadie lo toma mientras espera.
    expect((await h.drain(id)).claimed).toBe(false);
    expect(await h.store.due(h.clock.now, 10)).toEqual([]);

    // La persona aprueba: el trabajo despierta y sigue con lo que guardó al pausar.
    expect(await h.store.wake("accion-1", h.clock.now)).toEqual([id]);
    expect((await h.drain(id)).status).toBe("SUCCEEDED");
    expect(seen).toEqual([null, "accion-1"]);
    expect(h.store.row(id)).toMatchObject({ waitingFor: [], activeKey: null });
  });

  it("si la aprobación no llega, la tarea programada lo despierta a su hora", async () => {
    const approve = defineStep({
      key: "approve",
      title: "Esperar",
      module: "GENERAL",
      output: z.object({}),
      timeoutMs: 5_000,
      maxAttempts: 1,
      run: async (ctx) => (ctx.resumed ? done({}, "Venció.") : waitFor({ note: "Espera", actionIds: ["a"], recheckAt: new Date(ctx.now.getTime() + 60_000) })),
    });
    const pb = definePlaybook({ id: "website.create", module: "GENERAL", input: empty, title: () => "T", activeKey: () => "k", steps: [approve], finish: () => ({ summary: "ok", notify: false }) });
    const h = harness([pb]);
    const id = await h.enqueue(pb);
    await h.drain(id);
    h.advance(60_000);
    expect(await h.store.due(h.clock.now, 10)).toEqual([id]);
    expect((await h.drain(id)).status).toBe("SUCCEEDED");
  });
});

describe("motor: turnos y cancelación", () => {
  const step = defineStep({ key: "s", title: "Paso", module: "GENERAL", output: z.object({}), timeoutMs: 5_000, maxAttempts: 1, run: async () => done({}, "x") });
  const pb = definePlaybook({
    id: "daily.sweep",
    module: "GENERAL",
    input: empty,
    title: () => "T",
    activeKey: () => "k",
    steps: [step, { ...step, key: "s2" }],
    finish: () => ({ summary: "ok", notify: false }),
  });

  it("dos ejecutores no corren el mismo trabajo; el que perdió el turno no escribe", async () => {
    const h = harness([pb]);
    const id = await h.enqueue(pb);
    expect(await h.store.claim(id, "A", h.clock.now, 30_000)).not.toBeNull();
    expect(await h.store.claim(id, "B", new Date(h.clock.now.getTime() + 10_000), 30_000)).toBeNull();
    const later = new Date(h.clock.now.getTime() + 31_000);
    expect(await h.store.claim(id, "B", later, 30_000)).not.toBeNull();
    expect(await h.store.update(id, "A", { currentStep: 9 })).toBe(false);
    expect(await h.store.update(id, "B", { currentStep: 1 })).toBe(true);
  });

  it("la misma petición mientras sigue activa es el mismo trabajo", async () => {
    const h = harness([pb]);
    await h.enqueue(pb);
    await expect(h.enqueue(pb)).rejects.toThrow("no se creó");
  });

  it("si la persona lo detiene mientras corre, termina el paso actual y se detiene", async () => {
    // El arnés busca el playbook en esta lista: se agrega después de crear el arnés, porque el paso usa su almacén.
    const playbooks: PlaybookDefinition[] = [];
    const h = harness(playbooks);
    const stopMidway = defineStep({
      key: "first",
      title: "Primero",
      module: "GENERAL",
      output: z.object({}),
      timeoutMs: 5_000,
      maxAttempts: 1,
      run: async (ctx) => {
        // La persona pulsa Detener mientras este paso corre.
        await h.store.requestCancel(USER, ctx.jobId, ctx.now);
        return done({}, "Hecho.");
      },
    });
    const cancellable = definePlaybook({
      id: "daily.sweep",
      module: "GENERAL",
      input: empty,
      title: () => "T",
      activeKey: () => "c",
      steps: [stopMidway, { ...step, key: "second" }],
      finish: () => ({ summary: "ok", notify: false }),
    });
    playbooks.push(cancellable);
    const id = await h.enqueue(cancellable);
    expect((await h.drain(id)).status).toBe("CANCELED");
    expect(h.store.row(id)).toMatchObject({ status: "CANCELED", activeKey: null, lockedBy: null });
    expect(h.steps(id).map((s) => s.status)).toEqual(["SUCCEEDED", "CANCELED"]);
    expect(h.audits.map((a) => a.action)).toEqual(["engine.job.canceled"]);
  });

  it("un trabajo en cola o esperando se cancela sin que nadie lo corra", async () => {
    const h = harness([pb]);
    const id = await h.enqueue(pb);
    const steps = cancelRemaining(h.steps(id), h.clock.now);
    expect(await h.store.cancelIdle(USER, id, h.clock.now, steps)).toBe(true);
    expect(h.store.row(id)).toMatchObject({ status: "CANCELED", activeKey: null });
    expect((await h.drain(id)).claimed).toBe(false);
  });
});
