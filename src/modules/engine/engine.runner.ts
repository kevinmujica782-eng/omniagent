// El ejecutor del motor: toma el turno de un trabajo, corre sus pasos en orden y guarda cada avance antes de seguir.
// Si la invocación se corta, el turno vence y otra invocación retoma desde el último paso guardado. Sin Next ni
// Prisma: recibe el almacén, los playbooks y lo demás por parámetro (producción: engine.service.ts; pruebas: dobles).
import { randomUUID } from "node:crypto";
import type { Logger } from "@/lib/log";
import type { JobStatusId } from "@/types/engine";
import {
  LEASE_MARGIN_MS,
  LEASE_MS,
  INLINE_RETRY_MAX_MS,
  SAFETY_MS,
  STEP_TIMEOUT_MAX_MS,
  StepOutputError,
  StepTimeoutError,
  cancelRemaining,
  failureMessage,
  isAbandoned,
  isRetryable,
  nextStepIndex,
  readSteps,
  retryDelayMs,
  stepsMatch,
  warningsOf,
} from "./engine.rules";
import {
  waitStateSchema,
  type JobResult,
  type PlaybookDefinition,
  type PlaybookResult,
  type StepContext,
  type StepDefinition,
  type StepOutcome,
  type StepProfile,
  type StepRecord,
} from "./engine.types";
import type { JobPatch, JobRow, JobStore } from "./job-store";

export interface JobNotice {
  jobId: string;
  /** done: terminó bien (con un resumen); failed: no pudo terminar. */
  kind: "done" | "failed";
  title: string;
  body: string;
  href: string | null;
}

export interface JobAuditEntry {
  userId: string;
  jobId: string;
  action: "engine.job.succeeded" | "engine.job.failed" | "engine.job.canceled" | "engine.job.waiting";
  metadata: Record<string, string | number | boolean | null>;
}

export interface RunnerDeps {
  readonly store: JobStore;
  findPlaybook(id: string): PlaybookDefinition | undefined;
  loadProfile(userId: string): Promise<StepProfile>;
  notify(userId: string, notice: JobNotice): Promise<void>;
  audit(entry: JobAuditEntry): Promise<void>;
  /** Sigue en otra invocación del servidor (cuando a esta no le alcanza el tiempo para el próximo paso). */
  continueElsewhere(jobId: string): Promise<void>;
  now(): Date;
  sleep(ms: number): Promise<void>;
  readonly log: Logger;
}

export interface DrainOptions {
  /** Hasta cuándo puede trabajar esta invocación (milisegundos, en el reloj de deps.now). */
  deadline: number;
  /** Identidad del ejecutor (por defecto, una nueva). */
  worker?: string;
}

export interface DrainResult {
  /** false: no le tocaba, otro ejecutor lo tiene o ya terminó. */
  claimed: boolean;
  /** Cómo quedó el trabajo (null si este ejecutor perdió el turno a la mitad). */
  status: JobStatusId | null;
  /** Pasos que terminó esta invocación. */
  ranSteps: number;
  /** Cedió el turno por falta de tiempo y pidió seguir en otra invocación. */
  yielded: boolean;
}

/** Corre lo que se pueda de un trabajo dentro del tiempo de esta invocación. */
export async function drainJob(deps: RunnerDeps, jobId: string, opts: DrainOptions): Promise<DrainResult> {
  const worker = opts.worker ?? randomUUID();
  const job = await deps.store.claim(jobId, worker, deps.now(), LEASE_MS);
  if (!job) return { claimed: false, status: null, ranSteps: 0, yielded: false };
  return new JobRun(deps, job, worker, opts.deadline).drain();
}

type Settled<T> = { ok: true; value: T } | { ok: false; error: unknown };

/**
 * Espera el paso con un tope de tiempo. Al vencer, aborta la señal del paso (la IA y fetch se cortan) y sigue sin
 * esperarlo; su resultado tardío se descarta sin dejar promesas rechazadas sin atender.
 */
async function settle<T>(start: () => Promise<T>, timeoutMs: number, controller: AbortController): Promise<Settled<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<Settled<T>>((resolve) => {
    timer = setTimeout(() => {
      const error = new StepTimeoutError(timeoutMs);
      controller.abort(error);
      resolve({ ok: false, error });
    }, timeoutMs);
  });
  const work = Promise.resolve()
    .then(start)
    .then(
      (value): Settled<T> => ({ ok: true, value }),
      (error: unknown): Settled<T> => ({ ok: false, error }),
    );
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** Una corrida: el trabajo tomado, sus pasos en memoria y las salidas ya validadas. */
class JobRun {
  private steps: StepRecord[] = [];
  private ran = 0;
  private playbook: PlaybookDefinition | null = null;
  private input: unknown = null;
  private profile: StepProfile | null = null;
  private readonly outputs = new Map<string, unknown>();
  private readonly log: Logger;

  constructor(
    private readonly deps: RunnerDeps,
    private readonly job: JobRow,
    private readonly worker: string,
    private readonly deadline: number,
  ) {
    this.log = deps.log.child({ jobId: job.id, playbook: job.playbook });
  }

  async drain(): Promise<DrainResult> {
    const steps = readSteps(this.job.steps);
    const playbook = this.deps.findPlaybook(this.job.playbook);
    this.steps = steps ?? [];
    if (!playbook || !steps || !stepsMatch(steps, playbook.steps)) {
      return this.fail("Omni cambió la forma de hacer este trabajo. Pídelo de nuevo.");
    }
    const input = playbook.input.safeParse(this.job.input);
    if (!input.success) return this.fail("Los datos de este trabajo ya no son válidos. Pídelo de nuevo.");
    if (isAbandoned(this.job.createdAt, steps, this.deps.now())) {
      return this.fail("Este trabajo quedó a medias demasiado tiempo. Pídelo de nuevo.");
    }
    this.playbook = playbook;
    this.input = input.data;
    this.profile = await this.deps.loadProfile(this.job.userId);

    for (;;) {
      if (await this.cancelRequested()) return this.cancel();
      const index = nextStepIndex(this.steps);
      if (index === -1) return this.succeed(playbook);
      const definition = playbook.steps[index];
      if (definition.timeoutMs > STEP_TIMEOUT_MAX_MS) {
        return this.fail("Este paso no cabe en el tiempo del servidor.", definition.key);
      }
      // Un intento que se cortó a la mitad (el servidor cerró la invocación) ya contó: sin intentos, falla aquí.
      const record = this.steps[index];
      if (record.status === "RUNNING" && record.attempts >= definition.maxAttempts) {
        const stop = await this.stepFailed(index, definition, new StepTimeoutError(definition.timeoutMs));
        if (stop) return stop;
        continue;
      }
      if (this.remaining() < definition.timeoutMs + SAFETY_MS) return this.yieldTurn();
      const stop = await this.runStep(index, definition, playbook);
      if (stop) return stop;
    }
  }

  // ── Un paso ──────────────────────────────────────────────────────────────

  private async runStep(
    index: number,
    definition: StepDefinition<unknown, unknown>,
    playbook: PlaybookDefinition,
  ): Promise<DrainResult | null> {
    const now = this.deps.now();
    const previous = this.steps[index];
    const attempt = previous.attempts + 1;
    const startedAt = previous.startedAt ?? now.toISOString();
    this.steps[index] = { ...previous, status: "RUNNING", attempts: attempt, error: null, startedAt };
    const claimed = await this.save({
      status: "RUNNING",
      currentStep: index,
      lockedUntil: new Date(now.getTime() + definition.timeoutMs + LEASE_MARGIN_MS),
    });
    if (!claimed) return this.lost();

    const controller = new AbortController();
    const ctx: StepContext<unknown> = {
      jobId: this.job.id,
      userId: this.job.userId,
      conversationId: this.job.conversationId,
      input: this.input,
      attempt,
      now,
      startedAt: new Date(startedAt),
      signal: controller.signal,
      profile: this.requireProfile(),
      resumed: previous.waitState,
      log: this.log.child({ step: definition.key, attempt }),
      outputOf: <O,>(step: StepDefinition<never, O>) => this.outputOf(step),
    };
    this.log.debug("engine.step_started", { step: definition.key, attempt, playbook: playbook.id });
    const settled = await settle(() => definition.run(ctx), definition.timeoutMs, controller);
    if (!settled.ok) return this.stepFailed(index, definition, settled.error);
    this.ran += 1;
    return this.applyOutcome(index, definition, settled.value);
  }

  private async applyOutcome(index: number, definition: StepDefinition<unknown, unknown>, outcome: StepOutcome<unknown>): Promise<DrainResult | null> {
    const now = this.deps.now();
    const record = this.steps[index];

    if (outcome.type === "wait") {
      // Espera a la persona: el turno se suelta y la aprobación (o la tarea programada) lo despierta.
      const waitState = waitStateSchema.parse({ actionIds: [...outcome.actionIds], data: outcome.data ?? null });
      this.steps[index] = { ...record, status: "WAITING", attempts: 0, note: outcome.note, waitState };
      const released = await this.deps.store.release(this.job.id, this.worker, {
        status: "WAITING",
        steps: this.steps,
        currentStep: index,
        waitingFor: [...outcome.actionIds],
        runAfter: outcome.recheckAt,
      });
      if (!released) return this.lost();
      await this.safely(() =>
        this.deps.audit({ userId: this.job.userId, jobId: this.job.id, action: "engine.job.waiting", metadata: { step: definition.key } }),
      );
      return this.stopped("WAITING");
    }

    if (outcome.type === "skip") {
      this.steps[index] = { ...record, status: "SKIPPED", note: outcome.note, output: null, waitState: null, finishedAt: now.toISOString() };
    } else {
      const parsed = definition.output.safeParse(outcome.output);
      if (!parsed.success) {
        this.log.error("engine.step_bad_output", { step: definition.key, error: parsed.error });
        return this.stepFailed(index, definition, new StepOutputError(definition.key));
      }
      this.outputs.set(definition.key, parsed.data);
      this.steps[index] = {
        ...record,
        status: "SUCCEEDED",
        note: outcome.note,
        output: parsed.data,
        waitState: null,
        finishedAt: now.toISOString(),
      };
    }
    return (await this.save({ currentStep: index + 1 })) ? null : this.lost();
  }

  private async stepFailed(index: number, definition: StepDefinition<unknown, unknown>, error: unknown): Promise<DrainResult | null> {
    const now = this.deps.now();
    const record = this.steps[index];
    const message = failureMessage(error);
    const retry = isRetryable(error) && record.attempts < definition.maxAttempts;
    this.log.warn("engine.step_failed", { step: definition.key, attempt: record.attempts, retry, error });

    if (retry) {
      const delay = retryDelayMs(record.attempts);
      this.steps[index] = { ...record, status: "PENDING", error: message, note: "Falló un momento: lo intento de nuevo." };
      if (delay <= INLINE_RETRY_MAX_MS && this.remaining() >= delay + definition.timeoutMs + SAFETY_MS) {
        if (!(await this.save({}))) return this.lost();
        await this.deps.sleep(delay);
        return null;
      }
      const released = await this.deps.store.release(this.job.id, this.worker, {
        status: "QUEUED",
        steps: this.steps,
        runAfter: new Date(now.getTime() + delay),
      });
      return released ? this.stopped("QUEUED") : this.lost();
    }

    this.steps[index] = { ...record, status: "FAILED", error: message, note: message, waitState: null, finishedAt: now.toISOString() };
    if (definition.optional) return (await this.save({})) ? null : this.lost();
    return this.fail(message, definition.key);
  }

  private outputOf<O>(step: StepDefinition<never, O>): O | undefined {
    if (this.outputs.has(step.key)) return this.outputs.get(step.key) as O;
    const record = this.steps.find((s) => s.key === step.key && s.status === "SUCCEEDED");
    if (!record) return undefined;
    const parsed = step.output.safeParse(record.output);
    if (!parsed.success) {
      this.log.warn("engine.output_unreadable", { step: step.key });
      return undefined;
    }
    this.outputs.set(step.key, parsed.data);
    return parsed.data;
  }

  // ── Final del trabajo ────────────────────────────────────────────────────

  private async succeed(playbook: PlaybookDefinition): Promise<DrainResult> {
    const now = this.deps.now();
    const warnings = warningsOf(this.steps);
    let outcome: PlaybookResult;
    try {
      outcome = playbook.finish({
        input: this.input,
        steps: this.steps,
        warnings,
        outputOf: <O,>(step: StepDefinition<never, O>) => this.outputOf(step),
      });
    } catch (error) {
      this.log.error("engine.finish_failed", { error });
      return this.fail("Algo salió mal al terminar.");
    }
    const result: JobResult = { summary: outcome.summary, href: outcome.href ?? null, linkLabel: outcome.linkLabel ?? null, warnings };
    const released = await this.deps.store.release(this.job.id, this.worker, {
      status: "SUCCEEDED",
      steps: this.steps,
      currentStep: this.steps.length,
      result,
      errorMessage: null,
      activeKey: null,
      waitingFor: [],
      finishedAt: now,
    });
    if (!released) return this.lost();
    this.log.info("engine.job_succeeded", { warnings: warnings.length });
    if (outcome.notify) {
      await this.safely(() =>
        this.deps.notify(this.job.userId, {
          jobId: this.job.id,
          kind: "done",
          title: outcome.notifyTitle ?? this.job.title,
          body: outcome.summary,
          href: result.href ?? this.chatHref(),
        }),
      );
    }
    await this.safely(() =>
      this.deps.audit({
        userId: this.job.userId,
        jobId: this.job.id,
        action: "engine.job.succeeded",
        metadata: { playbook: this.job.playbook, warnings: warnings.length },
      }),
    );
    return this.stopped("SUCCEEDED");
  }

  private async fail(message: string, step?: string): Promise<DrainResult> {
    const now = this.deps.now();
    this.steps = cancelRemaining(this.steps, now);
    const released = await this.deps.store.release(this.job.id, this.worker, {
      status: "FAILED",
      steps: this.steps,
      errorMessage: message,
      activeKey: null,
      waitingFor: [],
      finishedAt: now,
    });
    if (!released) return this.lost();
    this.log.warn("engine.job_failed", { step: step ?? null, message });
    await this.safely(() =>
      this.deps.notify(this.job.userId, {
        jobId: this.job.id,
        kind: "failed",
        title: "Omni no pudo terminar un trabajo",
        body: `${this.job.title}: ${message}`,
        href: this.chatHref(),
      }),
    );
    await this.safely(() =>
      this.deps.audit({
        userId: this.job.userId,
        jobId: this.job.id,
        action: "engine.job.failed",
        metadata: { playbook: this.job.playbook, step: step ?? null },
      }),
    );
    return this.stopped("FAILED");
  }

  private async cancel(): Promise<DrainResult> {
    const now = this.deps.now();
    this.steps = cancelRemaining(this.steps, now);
    const released = await this.deps.store.release(this.job.id, this.worker, {
      status: "CANCELED",
      steps: this.steps,
      activeKey: null,
      waitingFor: [],
      finishedAt: now,
    });
    if (!released) return this.lost();
    await this.safely(() =>
      this.deps.audit({ userId: this.job.userId, jobId: this.job.id, action: "engine.job.canceled", metadata: { playbook: this.job.playbook } }),
    );
    return this.stopped("CANCELED");
  }

  /** No alcanza el tiempo para el próximo paso: suelta el turno y pide seguir en otra invocación. */
  private async yieldTurn(): Promise<DrainResult> {
    const released = await this.deps.store.release(this.job.id, this.worker, { status: "QUEUED", steps: this.steps, runAfter: this.deps.now() });
    if (!released) return this.lost();
    await this.safely(() => this.deps.continueElsewhere(this.job.id));
    return { claimed: true, status: "QUEUED", ranSteps: this.ran, yielded: true };
  }

  // ── Utilidades ───────────────────────────────────────────────────────────

  private save(patch: JobPatch): Promise<boolean> {
    return this.deps.store.update(this.job.id, this.worker, { ...patch, steps: this.steps });
  }

  private async cancelRequested(): Promise<boolean> {
    const fresh = await this.deps.store.find(this.job.id);
    return Boolean(fresh?.cancelRequestedAt);
  }

  private remaining(): number {
    return this.deadline - this.deps.now().getTime();
  }

  private requireProfile(): StepProfile {
    if (!this.profile) throw new Error("El perfil se carga antes de correr pasos.");
    return this.profile;
  }

  private chatHref(): string {
    return this.job.conversationId ? `/chat?c=${this.job.conversationId}` : "/inicio";
  }

  /** Avisos y bitácora: si fallan, el trabajo no cambia. */
  private async safely(task: () => Promise<void>): Promise<void> {
    try {
      await task();
    } catch (error) {
      this.log.warn("engine.side_effect_failed", { error });
    }
  }

  private stopped(status: JobStatusId): DrainResult {
    return { claimed: true, status, ranSteps: this.ran, yielded: false };
  }

  /** Otro ejecutor tomó el trabajo (este se demoró más que su turno): no se escribe nada más. */
  private lost(): DrainResult {
    this.log.warn("engine.lease_lost", { ranSteps: this.ran });
    return { claimed: true, status: null, ranSteps: this.ran, yielded: false };
  }
}
