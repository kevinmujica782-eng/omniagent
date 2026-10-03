/** Error de aplicación con código HTTP y mensaje apto para mostrar al usuario. */
export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/**
 * Detalle de un límite del plan (402 plan_limit). La interfaz lo usa para ofrecer Pro solo a quien tiene
 * el plan Gratis; a un usuario Pro que llega a su tope no se le muestra la hoja de mejora.
 */
export type PlanLimitDetails = {
  plan: "FREE" | "PRO";
  reason: "messages" | "watchlist" | "goals" | "form_reads" | "page_reads" | "feature";
  /** Función avanzada que pide Pro (ver AgentFeatureId en modules/billing/plans.ts). */
  feature?: string;
  limit?: number;
};

export const Errors = {
  unauthorized: () => new AppError(401, "unauthorized", "Inicia sesión para continuar."),
  forbidden: () => new AppError(403, "forbidden", "No tienes permiso para esta acción."),
  notFound: (what = "El recurso") => new AppError(404, "not_found", `${what} no existe o ya no está disponible.`),
  badRequest: (message: string, details?: unknown) => new AppError(400, "bad_request", message, details),
  conflict: (message: string) => new AppError(409, "conflict", message),
  planLimit: (message: string, details?: PlanLimitDetails) => new AppError(402, "plan_limit", message, details),
  rateLimited: (message: string, retryAfterSeconds?: number) =>
    new AppError(429, "rate_limited", message, retryAfterSeconds ? { retryAfterSeconds } : undefined),
  notConfigured: (feature: string) =>
    new AppError(503, "not_configured", `${feature} no está configurado en este entorno.`),
};

/** ¿Es un límite del plan Gratis (y por lo tanto tiene sentido ofrecer Pro)? */
export function isFreePlanLimit(error: unknown): boolean {
  if (!(error instanceof AppError) || error.code !== "plan_limit") return false;
  const details = error.details as PlanLimitDetails | undefined;
  return details?.plan === "FREE";
}
