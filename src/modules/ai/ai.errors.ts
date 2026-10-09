// Errores normalizados del router de IA. Cada adaptador traduce las fallas de su proveedor a un AIErrorCode; la
// política de cada código decide si se reintenta con el mismo proveedor, si se prueba con otro y qué ve la app.
// Puro: sin Next ni base de datos (lo usan error-mapping.ts y las pruebas).
import type { AIAttempt, AIErrorCode, AIProviderId } from "@/types/ai";

interface ErrorPolicy {
  /** Otro intento con el mismo proveedor puede salir bien. */
  retry: boolean;
  /** Otro proveedor puede responder. */
  fallback: boolean;
  /** Respuesta de la API de Omni. */
  status: number;
  appCode: string;
  message: string;
}

const UNAVAILABLE = "La IA no está disponible en este momento. Inténtalo en unos minutos.";

export const AI_ERROR_POLICY: Record<AIErrorCode, ErrorPolicy> = {
  network_error: {
    retry: true,
    fallback: true,
    status: 503,
    appCode: "ai_network_error",
    message: "No pudimos conectar con el servicio de IA. Inténtalo de nuevo.",
  },
  timeout: { retry: true, fallback: true, status: 504, appCode: "ai_timeout", message: "La IA tardó demasiado en responder. Inténtalo de nuevo." },
  rate_limited: {
    retry: true,
    fallback: true,
    status: 429,
    appCode: "ai_rate_limited",
    message: "Hay mucha demanda en la IA en este momento. Inténtalo en unos segundos.",
  },
  quota_exceeded: {
    retry: false,
    fallback: true,
    status: 503,
    appCode: "ai_quota_exceeded",
    message: "El servicio de IA llegó a su límite de uso por ahora. Inténtalo más tarde.",
  },
  auth_failed: { retry: false, fallback: true, status: 503, appCode: "ai_unavailable", message: UNAVAILABLE },
  model_not_found: { retry: false, fallback: true, status: 503, appCode: "ai_unavailable", message: UNAVAILABLE },
  provider_unavailable: { retry: true, fallback: true, status: 503, appCode: "ai_unavailable", message: UNAVAILABLE },
  bad_response: {
    retry: true,
    fallback: true,
    status: 502,
    appCode: "ai_bad_response",
    message: "La IA respondió algo que no pudimos leer. Inténtalo de nuevo.",
  },
  not_configured: { retry: false, fallback: true, status: 503, appCode: "ai_not_configured", message: "La IA no está configurada en este entorno." },
  invalid_request: {
    retry: false,
    fallback: false,
    status: 400,
    appCode: "ai_invalid_request",
    message: "La IA no pudo procesar ese pedido. Revisa el texto o los archivos.",
  },
  context_too_long: {
    retry: false,
    fallback: false,
    status: 413,
    appCode: "ai_context_too_long",
    message: "La conversación es demasiado larga para la IA. Empieza una nueva o acorta el texto.",
  },
  content_blocked: { retry: false, fallback: false, status: 422, appCode: "ai_content_blocked", message: "La IA no puede responder a ese pedido." },
  aborted: { retry: false, fallback: false, status: 408, appCode: "ai_canceled", message: "Se canceló la solicitud a la IA." },
};

export class AIProviderError extends Error {
  readonly code: AIErrorCode;
  /** Proveedor que falló (null si el error es del router, como `not_configured`). */
  readonly provider: AIProviderId | null;
  /** Código HTTP que devolvió el proveedor, si llegó a responder. */
  readonly httpStatus: number | null;
  /** Cuánto pide esperar el proveedor antes de reintentar. */
  readonly retryAfterMs: number | null;
  /** Lo que dijo el proveedor: solo para logs (puede traer detalles técnicos, nunca datos de la persona). */
  readonly detail: string;
  /** Intentos que hizo el router hasta este error. */
  attempts: AIAttempt[] = [];
  private readonly retryOverride: boolean | null;

  constructor(
    code: AIErrorCode,
    opts: {
      provider?: AIProviderId | null;
      httpStatus?: number | null;
      retryAfterMs?: number | null;
      detail?: string;
      cause?: unknown;
      /** Cambia la política del código (por ejemplo, un JSON cortado por el máximo de tokens no se reintenta igual). */
      retryable?: boolean;
    } = {},
  ) {
    super(AI_ERROR_POLICY[code].message, opts.cause === undefined ? undefined : { cause: opts.cause });
    this.name = "AIProviderError";
    this.code = code;
    this.provider = opts.provider ?? null;
    this.httpStatus = opts.httpStatus ?? null;
    this.retryAfterMs = opts.retryAfterMs ?? null;
    this.detail = (opts.detail ?? "").slice(0, 300);
    this.retryOverride = opts.retryable ?? null;
  }

  get retryable(): boolean {
    return this.retryOverride ?? AI_ERROR_POLICY[this.code].retry;
  }

  get canFallback(): boolean {
    return AI_ERROR_POLICY[this.code].fallback;
  }
}

export function isAIProviderError(error: unknown): error is AIProviderError {
  return error instanceof AIProviderError;
}

/** Un error con los intentos del router (para los logs y la respuesta de la API). */
export function withAttempts(error: AIProviderError, attempts: readonly AIAttempt[]): AIProviderError {
  error.attempts = [...attempts];
  return error;
}

/** Respuesta de la API de Omni para un error de IA: { status, code, message, details, retryAfter }. */
export function aiErrorToHttp(error: AIProviderError): {
  status: number;
  code: string;
  message: string;
  details: { provider: AIProviderId | null; retryAfterSeconds: number | null; attempts: { provider: AIProviderId; model: string; error: string | null }[] };
  retryAfter?: number;
} {
  const policy = AI_ERROR_POLICY[error.code];
  const retryAfterSeconds = error.retryAfterMs !== null ? Math.max(1, Math.ceil(error.retryAfterMs / 1000)) : null;
  const message =
    error.code === "rate_limited" && retryAfterSeconds !== null
      ? `Hay mucha demanda en la IA en este momento. Inténtalo en ${retryAfterSeconds} ${retryAfterSeconds === 1 ? "segundo" : "segundos"}.`
      : error.message;
  return {
    status: policy.status,
    code: policy.appCode,
    message,
    details: {
      provider: error.provider,
      retryAfterSeconds,
      attempts: error.attempts.map((attempt) => ({ provider: attempt.provider, model: attempt.model, error: attempt.error })),
    },
    ...(retryAfterSeconds !== null ? { retryAfter: retryAfterSeconds } : {}),
  };
}

/** Cuando todo falló: el error que mejor explica el resultado, con los intentos. */
export function summarizeFailure(attempts: readonly AIAttempt[], errors: readonly AIProviderError[]): AIProviderError {
  const last = errors.at(-1);
  if (!last) return withAttempts(new AIProviderError("not_configured"), attempts);
  const codes = new Set(errors.map((error) => error.code));
  if (codes.size === 1) {
    // Todos fallaron igual: ese es el error (con la espera más corta, si es un límite de tasa).
    const waits = errors.map((error) => error.retryAfterMs).filter((ms): ms is number => ms !== null);
    const summary = new AIProviderError(last.code, {
      provider: new Set(errors.map((error) => error.provider)).size === 1 ? last.provider : null,
      httpStatus: last.httpStatus,
      retryAfterMs: waits.length ? Math.min(...waits) : null,
      detail: last.detail,
      cause: last,
    });
    return withAttempts(summary, attempts);
  }
  // Fallas distintas en varios proveedores: la IA no está disponible por ahora.
  return withAttempts(new AIProviderError("provider_unavailable", { detail: last.detail, cause: last }), attempts);
}
