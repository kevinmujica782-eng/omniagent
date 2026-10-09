/**
 * Contrato del router de IA con la app (web, Android y API). Sin dependencias de servidor: lo importan el cliente y
 * el servidor. Cualquier proveedor (OpenAI, Anthropic, Google o xAI) responde con esta misma forma; la lógica vive en
 * src/modules/ai.
 */

export const AI_PROVIDER_IDS = ["openai", "anthropic", "gemini", "xai"] as const;
export type AIProviderId = (typeof AI_PROVIDER_IDS)[number];

/** Nivel de modelo: `fast` es el rápido y barato de cada proveedor; `smart`, el más capaz que usa Omni (Pro). */
export const AI_TIERS = ["fast", "smart"] as const;
export type AITier = (typeof AI_TIERS)[number];

/** Nombre de cada proveedor y de su asistente, como lo conoce la gente. */
export const AI_PROVIDER_LABEL: Record<AIProviderId, { company: string; assistant: string }> = {
  openai: { company: "OpenAI", assistant: "ChatGPT" },
  anthropic: { company: "Anthropic", assistant: "Claude" },
  gemini: { company: "Google", assistant: "Gemini" },
  xai: { company: "xAI", assistant: "Grok" },
};

/**
 * Por qué terminó la respuesta:
 * - `stop`: terminó de responder.
 * - `length`: llegó al máximo de tokens pedido.
 * - `tool_calls`: pide ejecutar herramientas (ver `toolCalls`).
 * - `content_filter`: el proveedor no quiso o no pudo responder por sus políticas.
 * - `other`: cualquier otro motivo que informe el proveedor.
 */
export type AIFinishReason = "stop" | "length" | "tool_calls" | "content_filter" | "other";

export interface AIUsage {
  /** Tokens de entrada, incluidos los que salieron de caché. */
  inputTokens: number;
  /** Tokens de salida, incluido el razonamiento interno del modelo. */
  outputTokens: number;
  totalTokens: number;
  /** Parte de la entrada que el proveedor leyó de su caché (más barata). */
  cachedInputTokens: number;
  /** Parte de la salida que fue razonamiento interno (no se muestra). */
  reasoningTokens: number;
}

export interface AIToolCall {
  /** Id que asignó el proveedor; se devuelve con el resultado de la herramienta. */
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/**
 * Errores normalizados. Cada proveedor informa sus fallas a su manera; el router las traduce a estos códigos:
 * - `network_error`: no se pudo conectar (DNS, conexión cortada).
 * - `timeout`: el proveedor no respondió a tiempo.
 * - `rate_limited`: demasiadas solicitudes por minuto; se puede reintentar después de `retryAfterSeconds`.
 * - `quota_exceeded`: la cuenta del proveedor se quedó sin cuota o saldo (reintentar no ayuda).
 * - `auth_failed`: la llave del proveedor no es válida o no tiene permiso.
 * - `invalid_request`: el pedido no es válido (no se reintenta ni se prueba con otro proveedor).
 * - `context_too_long`: la conversación no cabe en el modelo.
 * - `model_not_found`: el modelo configurado no existe en ese proveedor.
 * - `provider_unavailable`: el proveedor falló o está saturado (5xx, 529).
 * - `content_blocked`: el proveedor bloqueó el pedido por sus políticas.
 * - `bad_response`: la respuesta no se pudo leer (JSON inválido o incompleto).
 * - `not_configured`: no hay ningún proveedor configurado para este pedido.
 * - `aborted`: quien pidió la respuesta la canceló.
 */
export const AI_ERROR_CODES = [
  "network_error",
  "timeout",
  "rate_limited",
  "quota_exceeded",
  "auth_failed",
  "invalid_request",
  "context_too_long",
  "model_not_found",
  "provider_unavailable",
  "content_blocked",
  "bad_response",
  "not_configured",
  "aborted",
] as const;
export type AIErrorCode = (typeof AI_ERROR_CODES)[number];

/** Cada intento del router (para entender un respaldo o un error). */
export interface AIAttempt {
  provider: AIProviderId;
  model: string;
  ok: boolean;
  error: AIErrorCode | null;
  latencyMs: number;
}

/**
 * Ajustes que el proveedor no admite y el router resolvió de otra forma:
 * - `temperature_ignored`: el modelo no acepta temperatura (los modelos de razonamiento usan la suya).
 * - `stop_emulated`: el modelo no acepta secuencias de corte; el router cortó el texto.
 * - `tool_choice_relaxed`: el modelo no permite obligar una herramienta; se pidió en las instrucciones.
 * - `reasoning_ignored`: el modelo no permite elegir cuánto razona.
 */
export type AIWarning = "temperature_ignored" | "stop_emulated" | "tool_choice_relaxed" | "reasoning_ignored";

/** La respuesta normalizada: igual para OpenAI, Anthropic, Gemini y xAI. */
export interface AIResponse {
  /** Id de la respuesta en Omni (para soporte y registros). */
  id: string;
  object: "ai.response";
  provider: AIProviderId;
  model: string;
  tier: AITier;
  /** Texto de la respuesta (vacío si solo pidió herramientas o si el proveedor no respondió). */
  text: string;
  /** El JSON ya leído, cuando se pidió `responseFormat: json`. */
  json: unknown;
  toolCalls: AIToolCall[];
  finishReason: AIFinishReason;
  usage: AIUsage;
  latencyMs: number;
  /** true si respondió un proveedor distinto del primero que se intentó. */
  fallback: boolean;
  attempts: AIAttempt[];
  warnings: AIWarning[];
  createdAt: string;
}

/** Lo que la app puede elegir (GET /api/v1/ai/models). */
export interface AIModelOption {
  tier: AITier;
  model: string;
  /** El plan de la persona lo permite (el nivel `smart` es de Pro). */
  allowed: boolean;
}

export interface AIProviderOption {
  id: AIProviderId;
  company: string;
  assistant: string;
  /** Tiene llave en este entorno. */
  configured: boolean;
  /** Configurado y sin fallas recientes (el router lo está usando). */
  available: boolean;
  models: AIModelOption[];
  capabilities: { images: boolean; pdf: boolean; tools: boolean; json: boolean };
}

export interface AIModelsView {
  plan: "FREE" | "PRO";
  /** Orden en que el router prueba los proveedores con `provider: "auto"`. */
  order: AIProviderId[];
  providers: AIProviderOption[];
  limits: { maxOutputTokens: number; maxImages: number; tiers: AITier[] };
}
