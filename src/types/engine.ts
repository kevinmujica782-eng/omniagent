/**
 * Contrato del motor de ejecución autónoma con la interfaz (chat, asistente y API). Sin dependencias de servidor:
 * lo importan el cliente y el servidor. La lógica vive en src/modules/engine.
 */

export const JOB_STATUS_IDS = ["QUEUED", "RUNNING", "WAITING", "SUCCEEDED", "FAILED", "CANCELED"] as const;
export type JobStatusId = (typeof JOB_STATUS_IDS)[number];

export const STEP_STATUS_IDS = ["PENDING", "RUNNING", "WAITING", "SUCCEEDED", "SKIPPED", "FAILED", "CANCELED"] as const;
export type StepStatusId = (typeof STEP_STATUS_IDS)[number];

/** Lo que el motor sabe hacer de principio a fin (src/modules/engine/playbooks). */
export const PLAYBOOK_IDS = ["finance.analyze", "daily.sweep", "website.create", "website.update"] as const;
export type PlaybookId = (typeof PLAYBOOK_IDS)[number];

export interface JobStepView {
  key: string;
  title: string;
  status: StepStatusId;
  /** Qué pasó en el paso ("3 cuentas al día") o por qué se saltó. */
  note: string | null;
}

export interface JobResultView {
  summary: string;
  href: string | null;
  linkLabel: string | null;
  /** Pasos opcionales que fallaron sin detener el trabajo. */
  warnings: string[];
}

export interface JobView {
  id: string;
  playbook: PlaybookId;
  title: string;
  status: JobStatusId;
  steps: JobStepView[];
  /** Pasos terminados (hechos, omitidos o fallidos sin detener el trabajo). */
  done: number;
  total: number;
  result: JobResultView | null;
  error: string | null;
  /** Mientras espera una aprobación: dónde decidirla. */
  waitingHref: string | null;
  /** Después de un fallo pasajero: cuándo lo vuelve a intentar. */
  retryAt: string | null;
  cancellable: boolean;
  createdAt: string;
  finishedAt: string | null;
}

/** Estados en los que el trabajo sigue vivo (la tarjeta se actualiza sola). */
export const ACTIVE_JOB_STATUSES: readonly JobStatusId[] = ["QUEUED", "RUNNING", "WAITING"];

export function isJobActive(status: JobStatusId): boolean {
  return ACTIVE_JOB_STATUSES.includes(status);
}
