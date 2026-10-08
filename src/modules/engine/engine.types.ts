// Tipos del motor de ejecución autónoma: qué es un paso, qué es un playbook y qué se guarda de cada trabajo.
// Puro (sin base de datos ni Next): lo usan el ejecutor, los playbooks y las pruebas.
import { z } from "zod";
import type { AgentModule } from "@/generated/prisma/enums";
import type { Logger } from "@/lib/log";
import type { PlanId, PlanLimits } from "@/modules/billing/plans";
import { STEP_STATUS_IDS, type PlaybookId } from "@/types/engine";

// ── Lo que se guarda ─────────────────────────────────────────────────────────

/** Lo que un paso dejó guardado al pedir una aprobación: las acciones que espera y sus propios datos. */
export const waitStateSchema = z.object({
  actionIds: z.array(z.string()).default([]),
  data: z.unknown().default(null),
});
export type WaitState = z.output<typeof waitStateSchema>;

/** Un paso dentro del trabajo (columna engine_jobs.steps). */
export const stepRecordSchema = z.object({
  key: z.string(),
  title: z.string(),
  status: z.enum(STEP_STATUS_IDS),
  /** Intentos usados (reanudar después de una aprobación no cuenta como intento). */
  attempts: z.number().int().min(0).default(0),
  note: z.string().nullable().default(null),
  error: z.string().nullable().default(null),
  /** Salida del paso; al leerla se valida con el esquema del paso. */
  output: z.unknown().default(null),
  waitState: waitStateSchema.nullable().default(null),
  /** Cuándo empezó el primer intento (sirve para no repetir lo que ya se hizo si el paso se reintenta). */
  startedAt: z.string().nullable().default(null),
  finishedAt: z.string().nullable().default(null),
});
export type StepRecord = z.output<typeof stepRecordSchema>;

/** Resultado final del trabajo (columna engine_jobs.result). */
export const jobResultSchema = z.object({
  summary: z.string(),
  href: z.string().nullable(),
  linkLabel: z.string().nullable(),
  warnings: z.array(z.string()),
});
export type JobResult = z.output<typeof jobResultSchema>;

// ── Pasos ────────────────────────────────────────────────────────────────────

/** Lo que devuelve un paso: hecho (con su salida), nada que hacer, o a esperar que la persona decida. */
export type StepOutcome<O> =
  | { readonly type: "done"; readonly output: O; readonly note: string }
  | { readonly type: "skip"; readonly note: string }
  | {
      readonly type: "wait";
      readonly note: string;
      readonly actionIds: readonly string[];
      /** A más tardar cuándo volver a mirar (por ejemplo, cuando vence la aprobación). */
      readonly recheckAt: Date;
      readonly data?: unknown;
    };

export function done<O>(output: O, note: string): StepOutcome<O> {
  return { type: "done", output, note };
}

export function skip(note: string): StepOutcome<never> {
  return { type: "skip", note };
}

export function waitFor(wait: { note: string; actionIds: readonly string[]; recheckAt: Date; data?: unknown }): StepOutcome<never> {
  return { type: "wait", ...wait };
}

/** Datos de la persona que necesitan los pasos (se cargan una vez por corrida). */
export interface StepProfile {
  readonly timezone: string;
  readonly currency: string;
  readonly name: string | null;
  readonly plan: PlanId;
  readonly limits: PlanLimits;
  /** Modelo de IA del plan. */
  readonly model: string;
}

export interface StepContext<I> {
  readonly jobId: string;
  readonly userId: string;
  readonly conversationId: string | null;
  readonly input: I;
  /** 1 en el primer intento. */
  readonly attempt: number;
  readonly now: Date;
  /** Cuándo empezó el primer intento de este paso. */
  readonly startedAt: Date;
  /** Se aborta si el paso se pasa de su tiempo: pásala a fetch y a la IA. */
  readonly signal: AbortSignal;
  readonly profile: StepProfile;
  /** Lo que este paso guardó al pedir una aprobación (cuando se reanuda), o null. */
  readonly resumed: WaitState | null;
  readonly log: Logger;
  /** Salida de un paso anterior del mismo trabajo, validada con su esquema. */
  outputOf<O>(step: StepDefinition<never, O>): O | undefined;
}

/**
 * Lo que el motor necesita del esquema de salida de un paso: validarla. Cualquier esquema de zod lo cumple
 * (z.object(...), z.array(...)); así el tipo de la salida sale del esquema sin depender de los genéricos de zod.
 */
export interface OutputSchema<O> {
  safeParse(value: unknown): { success: true; data: O } | { success: false; error: unknown };
}

export interface StepDefinition<I, O> {
  /** Única dentro de su playbook ("finance.sync_accounts"). */
  readonly key: string;
  /** Lo que ve la persona en la tarjeta ("Actualizar tus cuentas"). */
  readonly title: string;
  readonly module: AgentModule;
  /** Esquema de la salida: se valida al guardarla y al leerla en una corrida posterior. */
  readonly output: OutputSchema<O>;
  /** Tiempo máximo de un intento. Tiene que caber en una invocación del servidor (ver STEP_TIMEOUT_MAX_MS). */
  readonly timeoutMs: number;
  /** Intentos ante fallos pasajeros (red, base de datos, IA saturada, tiempo agotado). */
  readonly maxAttempts: number;
  /** Si falla del todo, el trabajo sigue y el fallo queda como aviso en el resultado. */
  readonly optional?: boolean;
  run(ctx: StepContext<I>): Promise<StepOutcome<O>>;
}

export function defineStep<I, O>(step: StepDefinition<I, O>): StepDefinition<I, O> {
  return step;
}

/** El mismo paso, pero opcional dentro de este playbook. */
export function optional<I, O>(step: StepDefinition<I, O>): StepDefinition<I, O> {
  return { ...step, optional: true };
}

// ── Playbooks ────────────────────────────────────────────────────────────────

export interface PreflightContext {
  readonly userId: string;
  readonly plan: PlanId;
  readonly limits: PlanLimits;
  readonly now: Date;
}

export interface FinishContext<I> {
  readonly input: I;
  readonly steps: readonly StepRecord[];
  /** Notas de los pasos opcionales que fallaron. */
  readonly warnings: readonly string[];
  outputOf<O>(step: StepDefinition<never, O>): O | undefined;
}

export interface PlaybookResult {
  readonly summary: string;
  readonly href?: string | null;
  readonly linkLabel?: string | null;
  /** Avisar al terminar (con push). No hace falta si el módulo ya avisa o si la persona acaba de decidir. */
  readonly notify: boolean;
  /** Título del aviso (por defecto, el del trabajo). */
  readonly notifyTitle?: string;
}

/** Una petición que el motor sabe llevar de principio a fin: qué recibe, qué pasos corre y cómo lo resume. */
export interface PlaybookDefinition<S extends z.ZodType = z.ZodType> {
  readonly id: PlaybookId;
  readonly module: AgentModule;
  readonly input: S;
  /** Título del trabajo ("Crear tu página web"). */
  title(input: z.output<S>): string;
  /** "Ya estoy en eso": con un trabajo activo de la misma llave, se devuelve ese trabajo en vez de crear otro. */
  activeKey(input: z.output<S>): string;
  /** Antes de encolar: requisitos y límites del plan. Lanza AppError con un mensaje para la persona. */
  preflight?(input: z.output<S>, ctx: PreflightContext): Promise<void>;
  readonly steps: readonly StepDefinition<z.output<S>, unknown>[];
  finish(ctx: FinishContext<z.output<S>>): PlaybookResult;
}

export function definePlaybook<S extends z.ZodType>(playbook: PlaybookDefinition<S>): PlaybookDefinition<S> {
  return playbook;
}
