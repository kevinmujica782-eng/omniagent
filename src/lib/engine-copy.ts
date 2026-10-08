// Textos del motor en segundo plano (compartidos por el chat, el asistente y la API). Sin dependencias de servidor.
import type { JobStatusId, JobView, StepStatusId } from "@/types/engine";

export const JOB_STATUS_LABEL: Record<JobStatusId, string> = {
  QUEUED: "En cola",
  RUNNING: "Trabajando",
  WAITING: "Espera tu aprobación",
  SUCCEEDED: "Listo",
  FAILED: "No se pudo terminar",
  CANCELED: "Detenido",
};

/** Para lectores de pantalla: el estado de cada paso. */
export const STEP_STATUS_LABEL: Record<StepStatusId, string> = {
  PENDING: "Pendiente",
  RUNNING: "En curso",
  WAITING: "Esperando tu decisión",
  SUCCEEDED: "Hecho",
  SKIPPED: "No hizo falta",
  FAILED: "Falló",
  CANCELED: "No se hizo",
};

function clock(iso: string, timeZone?: string): string {
  try {
    return new Intl.DateTimeFormat("es", { hour: "numeric", minute: "2-digit", timeZone }).format(new Date(iso));
  } catch {
    return new Date(iso).toISOString().slice(11, 16);
  }
}

/** La línea bajo el título: en qué paso va, qué espera o cómo terminó. */
export function jobStatusLine(job: JobView, timeZone?: string): string {
  switch (job.status) {
    case "QUEUED":
      return job.retryAt ? `Falló un momento: lo intento de nuevo a las ${clock(job.retryAt, timeZone)}.` : "Empieza en un momento.";
    case "RUNNING": {
      const index = job.steps.findIndex((step) => step.status === "RUNNING" || step.status === "PENDING");
      return index === -1 ? "Terminando…" : `Paso ${index + 1} de ${job.total}: ${job.steps[index].title.toLowerCase()}.`;
    }
    case "WAITING":
      return "Sigue cuando decidas en Aprobaciones.";
    case "SUCCEEDED":
      return job.result?.warnings.length ? "Terminó, con un aviso." : "Terminó.";
    case "FAILED":
      return job.error ?? "No se pudo terminar.";
    case "CANCELED":
      return "Lo detuviste. Lo que ya hizo queda hecho.";
  }
}
