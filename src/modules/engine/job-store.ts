// Puerto de almacenamiento del motor: todo lo que el ejecutor y el servicio leen o escriben de un trabajo. En
// producción lo implementa Postgres (prisma-job-store.ts); en las pruebas, un almacén en memoria con las mismas reglas.
import type { AgentModule } from "@/generated/prisma/enums";
import type { JobStatusId, PlaybookId } from "@/types/engine";
import type { JobResult, StepRecord } from "./engine.types";

export type JobSource = "agent" | "api" | "schedule";

/** Un trabajo tal como está guardado (tabla engine_jobs). */
export interface JobRow {
  id: string;
  userId: string;
  playbook: string;
  module: AgentModule;
  title: string;
  status: JobStatusId;
  input: unknown;
  steps: unknown;
  currentStep: number;
  result: unknown;
  errorMessage: string | null;
  source: string;
  conversationId: string | null;
  activeKey: string | null;
  waitingFor: string[];
  runAfter: Date;
  lockedBy: string | null;
  lockedUntil: Date | null;
  cancelRequestedAt: Date | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewJob {
  userId: string;
  playbook: PlaybookId;
  module: AgentModule;
  title: string;
  input: unknown;
  steps: StepRecord[];
  source: JobSource;
  conversationId: string | null;
  activeKey: string;
}

/** Cambios de un trabajo. `activeKey: null` libera la llave de "ya estoy en eso" al terminar. */
export interface JobPatch {
  status?: JobStatusId;
  steps?: StepRecord[];
  currentStep?: number;
  result?: JobResult;
  errorMessage?: string | null;
  waitingFor?: string[];
  runAfter?: Date;
  lockedUntil?: Date | null;
  activeKey?: null;
  finishedAt?: Date | null;
}

export interface JobStore {
  /** Crea el trabajo en cola; null si la persona ya tiene uno activo con la misma llave. */
  create(job: NewJob): Promise<JobRow | null>;
  findActive(userId: string, activeKey: string): Promise<JobRow | null>;
  /** Trabajos en cola o corriendo (los que esperan una aprobación no ocupan lugar). */
  countRunning(userId: string): Promise<number>;
  find(id: string): Promise<JobRow | null>;
  findForUser(userId: string, id: string): Promise<JobRow | null>;
  listForUser(userId: string, opts: { activeOnly: boolean; take: number }): Promise<JobRow[]>;
  /**
   * Toma el turno de forma atómica si el trabajo está libre y le toca: en cola o esperando con run_after vencido, o
   * corriendo con el turno vencido (su ejecutor se cayó). Devuelve el trabajo ya tomado, o null.
   */
  claim(id: string, worker: string, now: Date, leaseMs: number): Promise<JobRow | null>;
  /** Guarda cambios solo si `worker` sigue teniendo el turno (si no, otro ejecutor lo tomó: false). */
  update(id: string, worker: string, patch: JobPatch): Promise<boolean>;
  /** Guarda y suelta el turno (mismas condiciones que update). */
  release(id: string, worker: string, patch: JobPatch): Promise<boolean>;
  /** Cancela un trabajo que nadie está corriendo (en cola o esperando una aprobación). */
  cancelIdle(userId: string, id: string, now: Date, steps: StepRecord[]): Promise<boolean>;
  /** Pide detener un trabajo que está corriendo: su ejecutor lo detiene al terminar el paso actual. */
  requestCancel(userId: string, id: string, now: Date): Promise<boolean>;
  /** Trabajos que ya toca correr, los más atrasados primero (para la tarea programada). */
  due(now: Date, limit: number): Promise<string[]>;
  /** Despierta los trabajos que esperan esta aprobación (les toca ya) y devuelve sus ids. */
  wake(actionId: string, now: Date): Promise<string[]>;
}
