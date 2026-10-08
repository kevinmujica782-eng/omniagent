// Reglas puras del motor: tiempos, reintentos, qué paso sigue, cómo se ve un trabajo. Sin base de datos ni Next.
import { ZodError } from "zod";
import { AppError } from "@/lib/errors";
import { classify } from "@/lib/error-mapping";
import { isJobActive, PLAYBOOK_IDS, type JobStatusId, type JobView, type PlaybookId } from "@/types/engine";
import { jobResultSchema, stepRecordSchema, type StepContext, type StepDefinition, type StepRecord } from "./engine.types";

// ── Tiempos ──────────────────────────────────────────────────────────────────
// Una función del servidor vive 60 s (Netlify). Cada paso tiene que caber en una invocación; si no queda tiempo para
// el siguiente, el trabajo cede el turno y sigue en otra invocación (o en la tarea programada de cada minuto).

/** Tiempo de trabajo de una invocación nueva (deja margen para guardar y responder). */
export const INVOCATION_BUDGET_MS = 54_000;
/** Lo más que puede durar un intento de un paso. */
export const STEP_TIMEOUT_MAX_MS = 45_000;
/** Margen antes del límite de la invocación: no se empieza un paso que no alcanza a terminar. */
export const SAFETY_MS = 2_000;
/** Turno inicial al tomar un trabajo; cada paso lo extiende a su tiempo máximo más LEASE_MARGIN_MS. */
export const LEASE_MS = 30_000;
export const LEASE_MARGIN_MS = 15_000;
/** Reintentos cortos: se esperan dentro de la misma invocación si hay tiempo. */
export const INLINE_RETRY_MAX_MS = 15_000;
/** Espera antes de cada reintento (después del 1.º, 2.º y siguientes fallos). */
export const RETRY_DELAYS_MS = [10_000, 60_000, 5 * 60_000] as const;
/** Un trabajo que no terminó en un día (sin contar lo que espera una aprobación) se da por fallido. */
export const MAX_JOB_AGE_MS = 24 * 3_600_000;

/** Límite de trabajos nuevos por persona (además de los límites del plan). */
export const START_RATE = { limit: 12, windowSeconds: 3_600 } as const;

export function retryDelayMs(attempt: number): number {
  const index = Math.min(Math.max(attempt, 1), RETRY_DELAYS_MS.length) - 1;
  return RETRY_DELAYS_MS[index];
}

// ── Errores ──────────────────────────────────────────────────────────────────

/** El paso se pasó de su tiempo máximo. */
export class StepTimeoutError extends Error {
  constructor(readonly ms: number) {
    super(`El paso tardó más de ${Math.round(ms / 1000)} s.`);
    this.name = "StepTimeoutError";
  }
}

/** La salida del paso no cumple su esquema (un error del código, no de la persona ni de la red). */
export class StepOutputError extends Error {
  constructor(readonly step: string) {
    super(`La salida del paso ${step} no es válida.`);
    this.name = "StepOutputError";
  }
}

/**
 * ¿Vale la pena otro intento? Sí ante lo pasajero: tiempo agotado, red, base de datos, IA saturada o un error inesperado
 * (con tope de intentos). No ante lo que otro intento no cambia: datos inválidos, límites del plan, permisos, algo que
 * no está configurado o una salida mal formada.
 */
export function isRetryable(error: unknown): boolean {
  if (error instanceof StepTimeoutError) return true;
  if (error instanceof StepOutputError || error instanceof ZodError) return false;
  if (error instanceof AppError) return error.status >= 500 && error.code !== "not_configured";
  return true;
}

/**
 * La salida de un paso anterior que este paso necesita. Si falta (no debería: el motor corre los pasos en orden), el
 * trabajo no puede seguir y no tiene sentido reintentarlo.
 */
export function requireOutput<O>(ctx: Pick<StepContext<unknown>, "outputOf">, step: StepDefinition<never, O>): O {
  const output = ctx.outputOf(step);
  if (output === undefined) throw new AppError(409, "step_output_missing", "Falta el resultado de un paso anterior. Pídelo de nuevo.");
  return output;
}

/** Mensaje para la persona: el de la app tal cual; lo de infraestructura, traducido sin detalles internos. */
export function failureMessage(error: unknown): string {
  if (error instanceof StepTimeoutError) return "Tardó más de lo esperado.";
  if (error instanceof StepOutputError) return "Algo salió mal de nuestro lado.";
  return classify(error).message;
}

// ── Pasos ────────────────────────────────────────────────────────────────────

const iso = (date: Date) => date.toISOString();

export function initialSteps(definitions: readonly Pick<StepDefinition<never, unknown>, "key" | "title">[]): StepRecord[] {
  return definitions.map((step) => stepRecordSchema.parse({ key: step.key, title: step.title, status: "PENDING" }));
}

/** Lee la columna steps; si algo no cumple el esquema, devuelve null (el trabajo no se puede seguir). */
export function readSteps(raw: unknown): StepRecord[] | null {
  const parsed = stepRecordSchema.array().safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/** ¿Los pasos guardados son los del playbook actual (mismas llaves, mismo orden)? */
export function stepsMatch(records: readonly StepRecord[], definitions: readonly Pick<StepDefinition<never, unknown>, "key">[]): boolean {
  return records.length === definitions.length && records.every((record, i) => record.key === definitions[i].key);
}

/** El próximo paso por correr: el primero pendiente, corriendo (su ejecutor se cayó) o esperando una aprobación. */
export function nextStepIndex(steps: readonly StepRecord[]): number {
  return steps.findIndex((step) => step.status === "PENDING" || step.status === "RUNNING" || step.status === "WAITING");
}

/** Pasos terminados para la barra de avance. */
export function countDone(steps: readonly StepRecord[]): number {
  return steps.filter((step) => step.status === "SUCCEEDED" || step.status === "SKIPPED" || step.status === "FAILED").length;
}

/** Avisos del resultado: pasos opcionales que fallaron sin detener el trabajo. */
export function warningsOf(steps: readonly StepRecord[]): string[] {
  return steps.filter((step) => step.status === "FAILED").map((step) => `${step.title}: ${step.note ?? "no se pudo"}`);
}

/** Al terminar antes de tiempo (cancelado o fallido): lo que no llegó a correr queda cancelado. */
export function cancelRemaining(steps: readonly StepRecord[], now: Date): StepRecord[] {
  return steps.map((step): StepRecord =>
    step.status === "PENDING" || step.status === "RUNNING" || step.status === "WAITING"
      ? { ...step, status: "CANCELED", waitState: null, finishedAt: iso(now) }
      : step,
  );
}

/** ¿Lleva demasiado sin terminar? Lo que espera una aprobación no cuenta (la aprobación vence sola). */
export function isAbandoned(createdAt: Date, steps: readonly StepRecord[], now: Date): boolean {
  if (steps.some((step) => step.status === "WAITING" || step.waitState !== null)) return false;
  return now.getTime() - createdAt.getTime() > MAX_JOB_AGE_MS;
}

// ── Vista ────────────────────────────────────────────────────────────────────

export function isPlaybookId(value: string): value is PlaybookId {
  return (PLAYBOOK_IDS as readonly string[]).includes(value);
}

/** Las columnas que necesita la vista (las tiene la fila de Prisma y la del almacén en memoria de las pruebas). */
export interface JobViewSource {
  id: string;
  playbook: string;
  title: string;
  status: JobStatusId;
  steps: unknown;
  result: unknown;
  errorMessage: string | null;
  runAfter: Date;
  cancelRequestedAt: Date | null;
  createdAt: Date;
  finishedAt: Date | null;
}

export function toJobView(row: JobViewSource, now = new Date()): JobView {
  const steps = readSteps(row.steps) ?? [];
  const result = jobResultSchema.safeParse(row.result);
  const retrying =
    row.status === "QUEUED" && row.runAfter.getTime() > now.getTime() && steps.some((s) => s.status === "PENDING" && s.attempts > 0);
  return {
    id: row.id,
    playbook: isPlaybookId(row.playbook) ? row.playbook : "daily.sweep",
    title: row.title,
    status: row.status,
    steps: steps.map((step) => ({ key: step.key, title: step.title, status: step.status, note: step.note })),
    done: countDone(steps),
    total: steps.length,
    result: result.success ? result.data : null,
    error: row.errorMessage,
    waitingHref: row.status === "WAITING" ? "/aprobaciones" : null,
    retryAt: retrying ? row.runAfter.toISOString() : null,
    cancellable: isJobActive(row.status) && row.cancelRequestedAt === null,
    createdAt: row.createdAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
  };
}
