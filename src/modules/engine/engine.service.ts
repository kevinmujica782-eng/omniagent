import "server-only";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { Errors } from "@/lib/errors";
import { log } from "@/lib/log";
import { rateLimit } from "@/lib/rate-limit";
import { isUuid } from "@/lib/validation";
import { getEntitlements, planLimitError } from "@/modules/billing/entitlements";
import { isJobActive, type JobView, type PlaybookId } from "@/types/engine";
import { afterResponse, requestContinuation } from "./engine.dispatch";
import { INVOCATION_BUDGET_MS, START_RATE, cancelRemaining, initialSteps, readSteps, toJobView } from "./engine.rules";
import { drainJob, type DrainResult, type JobNotice, type RunnerDeps } from "./engine.runner";
import type { StepProfile } from "./engine.types";
import type { JobSource } from "./job-store";
import { findPlaybook } from "./playbooks";
import { prismaJobStore } from "./prisma-job-store";

// Motor de ejecución autónoma: recibe una petición del asistente ("crea mi página web", "analiza mis finanzas"),
// valida lo que pide y los límites del plan, la deja en cola como un trabajo con sus pasos y la corre en segundo plano
// (ver engine.dispatch.ts). Los pasos llaman a los servicios de cada módulo, uno detrás de otro; lo que gasta, envía,
// cancela o publica pasa por Aprobaciones y el trabajo espera la decisión de la persona.

const store = prismaJobStore;

async function loadProfile(userId: string): Promise<StepProfile> {
  const [profile, entitlements] = await Promise.all([
    prisma.profile.findUnique({ where: { id: userId }, select: { timezone: true, currency: true, fullName: true } }),
    getEntitlements(userId),
  ]);
  return {
    timezone: profile?.timezone ?? "UTC",
    currency: profile?.currency ?? "USD",
    name: profile?.fullName ?? null,
    plan: entitlements.plan,
    limits: entitlements.limits,
    model: entitlements.model,
  };
}

async function notify(userId: string, notice: JobNotice): Promise<void> {
  // La notificación también sale como push (trigger on_notification_push en la base).
  await prisma.appNotification.create({
    data: {
      userId,
      type: notice.kind === "done" ? "INSIGHT" : "SYSTEM",
      title: notice.title.slice(0, 120),
      body: notice.body.slice(0, 300),
      href: notice.href,
      data: { jobId: notice.jobId },
    },
  });
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Dependencias del ejecutor en producción. */
export function engineDeps(): RunnerDeps {
  return {
    store,
    findPlaybook,
    loadProfile,
    notify,
    audit: (entry) => audit({ userId: entry.userId, actor: "agent", action: entry.action, entity: "engine_job", entityId: entry.jobId, metadata: entry.metadata }),
    continueElsewhere: requestContinuation,
    now: () => new Date(),
    sleep,
    log: log.child({ module: "engine" }),
  };
}

/** Corre el trabajo después de responder, dentro del tiempo que le queda a esta invocación. */
function runInBackground(jobId: string, deadline: number): void {
  const scheduled = afterResponse(() => drainJob(engineDeps(), jobId, { deadline }));
  if (!scheduled) log.info("engine.queued_for_cron", { jobId });
}

// ── Pedir un trabajo ─────────────────────────────────────────────────────────

export interface StartJobRequest {
  userId: string;
  playbook: PlaybookId;
  input: unknown;
  source: JobSource;
  conversationId?: string | null;
  /** Hasta cuándo puede trabajar esta invocación después de responder (por defecto, un turno completo desde ahora). */
  deadline?: number;
}

/**
 * Deja el trabajo en cola y lo empieza en segundo plano. Si ya hay uno activo igual ("ya estoy en eso"), devuelve ese.
 * Valida los datos con el esquema del playbook, el límite de tasa, cuántos trabajos corren a la vez según el plan y
 * los requisitos propios del playbook (por ejemplo, tener cuentas para analizarlas).
 */
export async function startJob(request: StartJobRequest): Promise<{ job: JobView; created: boolean }> {
  const playbook = findPlaybook(request.playbook);
  if (!playbook) throw Errors.badRequest("Omni todavía no sabe hacer ese trabajo.");
  const input = playbook.input.parse(request.input);
  const activeKey = `${playbook.id}:${playbook.activeKey(input)}`;

  const existing = await store.findActive(request.userId, activeKey);
  if (existing) return { job: toJobView(existing), created: false };

  await rateLimit(request.userId, "engine.start", START_RATE);
  const entitlements = await getEntitlements(request.userId);
  const running = await store.countRunning(request.userId);
  if (running >= entitlements.limits.parallelJobs) {
    throw planLimitError(
      entitlements,
      "jobs",
      entitlements.plan === "FREE"
        ? "En el plan Gratis, Omni hace un trabajo en segundo plano a la vez. Te aviso cuando termine el que está en marcha."
        : `Ya tienes ${entitlements.limits.parallelJobs} trabajos en marcha. Te aviso cuando termine alguno.`,
      { limit: entitlements.limits.parallelJobs },
    );
  }
  const now = new Date();
  await playbook.preflight?.(input, { userId: request.userId, plan: entitlements.plan, limits: entitlements.limits, now });

  const row = await store.create({
    userId: request.userId,
    playbook: playbook.id,
    module: playbook.module,
    title: playbook.title(input),
    input,
    steps: initialSteps(playbook.steps),
    source: request.source,
    conversationId: request.conversationId ?? null,
    activeKey,
  });
  if (!row) {
    // Otra petición igual llegó al mismo tiempo: es ese trabajo.
    const again = await store.findActive(request.userId, activeKey);
    if (again) return { job: toJobView(again), created: false };
    throw Errors.conflict("No pude empezar el trabajo. Inténtalo de nuevo.");
  }
  await audit({
    userId: request.userId,
    actor: request.source === "api" ? "user" : "agent",
    action: "engine.job.created",
    entity: "engine_job",
    entityId: row.id,
    metadata: { playbook: playbook.id, source: request.source },
  });
  runInBackground(row.id, request.deadline ?? Date.now() + INVOCATION_BUDGET_MS);
  return { job: toJobView(row), created: true };
}

// ── Consultar y cancelar ─────────────────────────────────────────────────────

export async function getJob(userId: string, jobId: string): Promise<JobView> {
  const row = isUuid(jobId) ? await store.findForUser(userId, jobId) : null;
  if (!row) throw Errors.notFound("El trabajo");
  return toJobView(row);
}

/** El trabajo activo más reciente o, si no hay, el último. */
export async function latestJob(userId: string): Promise<JobView | null> {
  const [active] = await store.listForUser(userId, { activeOnly: true, take: 1 });
  if (active) return toJobView(active);
  const [last] = await store.listForUser(userId, { activeOnly: false, take: 1 });
  return last ? toJobView(last) : null;
}

export async function listJobs(userId: string, opts: { activeOnly?: boolean; take?: number } = {}): Promise<JobView[]> {
  const rows = await store.listForUser(userId, { activeOnly: opts.activeOnly ?? false, take: Math.min(Math.max(opts.take ?? 20, 1), 50) });
  return rows.map((row) => toJobView(row));
}

/**
 * Cancela un trabajo. Si nadie lo está corriendo (en cola o esperando una aprobación) se cancela ya y su aprobación
 * pendiente vence; si está corriendo, se detiene al terminar el paso actual.
 */
export async function cancelJob(userId: string, jobId: string): Promise<JobView> {
  const row = isUuid(jobId) ? await store.findForUser(userId, jobId) : null;
  if (!row) throw Errors.notFound("El trabajo");
  if (!isJobActive(row.status)) throw Errors.conflict("Ese trabajo ya terminó.");
  const now = new Date();
  const steps = cancelRemaining(readSteps(row.steps) ?? [], now);
  if (row.status !== "RUNNING" && (await store.cancelIdle(userId, jobId, now, steps))) {
    if (row.waitingFor.length > 0) {
      await prisma.agentAction.updateMany({ where: { userId, id: { in: row.waitingFor }, status: "PENDING" }, data: { status: "EXPIRED" } });
    }
    await audit({ userId, actor: "user", action: "engine.job.canceled", entity: "engine_job", entityId: jobId, metadata: { playbook: row.playbook } });
  } else {
    await store.requestCancel(userId, jobId, now);
    await audit({ userId, actor: "user", action: "engine.job.cancel_requested", entity: "engine_job", entityId: jobId, metadata: { playbook: row.playbook } });
  }
  return getJob(userId, jobId);
}

// ── Correr en segundo plano ──────────────────────────────────────────────────

/** La persona decidió una aprobación: los trabajos que la esperaban siguen ya (en la misma invocación, después de responder). */
export async function resumeAfterDecision(actionId: string): Promise<void> {
  const ids = await store.wake(actionId, new Date());
  for (const id of ids) runInBackground(id, Date.now() + INVOCATION_BUDGET_MS);
}

/** Otra invocación pidió seguir con este trabajo (POST /api/cron/engine). */
export function continueJob(jobId: string, deadline: number): Promise<DrainResult> {
  return drainJob(engineDeps(), jobId, { deadline });
}

export interface DueRunSummary {
  due: number;
  ran: number;
  succeeded: number;
  failed: number;
  waiting: number;
  requeued: number;
}

/**
 * Tarea programada (cada minuto): corre lo que ya toca —trabajos en cola, reintentos, aprobaciones que vencieron y
 * trabajos cuyo ejecutor se cayó— con hasta `concurrency` a la vez y sin pasarse del tiempo de la invocación.
 */
export async function runDueJobs(opts: { limit?: number; concurrency?: number; deadline?: number } = {}): Promise<DueRunSummary> {
  const deadline = opts.deadline ?? Date.now() + INVOCATION_BUDGET_MS;
  const ids = await store.due(new Date(), opts.limit ?? 12);
  const summary: DueRunSummary = { due: ids.length, ran: 0, succeeded: 0, failed: 0, waiting: 0, requeued: 0 };
  const deps = engineDeps();
  let next = 0;
  const worker = async () => {
    while (next < ids.length && deadline - Date.now() > 5_000) {
      const id = ids[next++];
      try {
        const result = await drainJob(deps, id, { deadline });
        if (!result.claimed) continue;
        summary.ran += 1;
        if (result.status === "SUCCEEDED") summary.succeeded += 1;
        else if (result.status === "FAILED") summary.failed += 1;
        else if (result.status === "WAITING") summary.waiting += 1;
        else if (result.status === "QUEUED") summary.requeued += 1;
      } catch (error) {
        log.error("engine.drain_failed", { jobId: id, error });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(opts.concurrency ?? 3, ids.length) }, worker));
  return summary;
}
