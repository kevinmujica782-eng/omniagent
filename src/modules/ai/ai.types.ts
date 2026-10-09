// Contrato interno del router de IA: lo que entra (AIRequestPrompt), lo que implementa cada proveedor (ModelProvider)
// y lo que devuelve cada adaptador antes de normalizarse (ProviderResult). Sin Next, base de datos ni variables de
// entorno: los adaptadores y el router se prueban solos.
import type { AIFinishReason, AIProviderId, AITier, AIToolCall, AIUsage, AIWarning } from "@/types/ai";

export type { AIProviderId, AITier, AIToolCall, AIUsage, AIWarning, AIFinishReason } from "@/types/ai";

/** JSON Schema tal como lo genera zod (`z.toJSONSchema`) o lo manda la app. */
export type JsonSchema = Record<string, unknown>;

export const IMAGE_MEDIA_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;
export type ImageMediaType = (typeof IMAGE_MEDIA_TYPES)[number];

/** Partes de un mensaje de la persona: texto, imagen o PDF (en base64, sin el prefijo data:). */
export type AIContentPart =
  | { type: "text"; text: string }
  | { type: "image"; mediaType: ImageMediaType; data: string }
  | { type: "file"; mediaType: "application/pdf"; data: string; filename?: string };

/**
 * Estado propio del proveedor que hay que devolverle en el turno siguiente para seguir una ronda de herramientas:
 * el razonamiento cifrado de OpenAI, las firmas de pensamiento de Gemini o los bloques de pensamiento de Claude.
 * Es opaco para el resto de la app y solo lo usa el mismo proveedor (otro proveedor lo ignora).
 */
export interface AIProviderState {
  provider: AIProviderId;
  model: string;
  data: unknown;
}

export type AIMessage =
  | { role: "user"; content: string | AIContentPart[] }
  | { role: "assistant"; content: string; toolCalls?: AIToolCall[]; state?: AIProviderState | null }
  | { role: "tool"; toolCallId: string; name: string; content: string; isError?: boolean };

export interface AIToolDefinition {
  /** Letras, números, guion y guion bajo (máx. 64): el mínimo común de los cuatro proveedores. */
  name: string;
  description: string;
  /** JSON Schema de los argumentos (un objeto). */
  parameters: JsonSchema;
}

/** `auto` decide el modelo; `required` obliga alguna herramienta; `{ name }`, esa herramienta. */
export type AIToolChoice = "auto" | "none" | "required" | { name: string };

export type AIResponseFormat =
  | { type: "text" }
  /** JSON; con `schema`, el proveedor lo genera ajustado a ese esquema (salida estructurada). */
  | { type: "json"; schema?: JsonSchema; name?: string };

export type AIReasoningEffort = "low" | "medium" | "high";

/** Un pedido normalizado para cualquier proveedor. */
export interface AIRequestPrompt {
  /** Instrucciones de sistema. */
  system?: string;
  messages: AIMessage[];

  // ── Qué modelo ──
  /** Nivel del modelo (por defecto `fast`). */
  tier?: AITier;
  /** Proveedor preferido: se intenta primero. */
  provider?: AIProviderId;
  /** Modelo exacto para el proveedor preferido (solo para usos internos; la app elige por nivel). */
  model?: string;
  /** Solo estos proveedores (en este orden de preferencia, después del preferido). */
  providers?: readonly AIProviderId[];
  /** Si el proveedor falla, probar con el siguiente (por defecto sí). */
  fallback?: boolean;

  // ── Cómo responde ──
  maxOutputTokens?: number;
  /** Sugerencia: los modelos de razonamiento la ignoran (queda en `warnings`). */
  temperature?: number;
  stop?: readonly string[];
  /** Cuánto razona el modelo, en los que lo permiten. */
  reasoning?: AIReasoningEffort;
  responseFormat?: AIResponseFormat;
  tools?: readonly AIToolDefinition[];
  toolChoice?: AIToolChoice;

  // ── Ejecución ──
  /** Tope de cada intento (por defecto, el del modelo). */
  timeoutMs?: number;
  /** Tope total, con reintentos y respaldos incluidos. */
  deadlineMs?: number;
  signal?: AbortSignal;
}

// ── Catálogo ─────────────────────────────────────────────────────────────────

export interface ModelCapabilities {
  /** Tipos de imagen que acepta (vacío: no acepta imágenes). */
  imageTypes: readonly ImageMediaType[];
  pdf: boolean;
  tools: boolean;
  /** Salida JSON ajustada a un esquema. */
  jsonSchema: boolean;
  temperature: boolean;
  /** Secuencias de corte nativas (si no, el router corta el texto). */
  stop: boolean;
  /** Permite obligar el uso de una herramienta (`required` o `{ name }`). */
  forcedToolChoice: boolean;
  /** Admite elegir el esfuerzo de razonamiento. */
  reasoningEffort: boolean;
}

export interface ModelSpec {
  provider: AIProviderId;
  id: string;
  tier: AITier;
  capabilities: ModelCapabilities;
  /** Máximo de tokens de salida que se le piden. */
  maxOutputTokens: number;
  /**
   * Tokens que se suman al máximo pedido porque el proveedor cuenta su razonamiento dentro de ese máximo (OpenAI,
   * Gemini). Sin ese margen, una respuesta corta podría quedar vacía. Solo se cobra lo que se usa.
   */
  reasoningReserveTokens: number;
  /** Tope por intento si el pedido no trae otro. */
  timeoutMs: number;
}

// ── Proveedores ──────────────────────────────────────────────────────────────

/** El pedido listo para un adaptador: ya tiene el modelo elegido y los valores por defecto. */
export interface ProviderCall {
  model: ModelSpec;
  request: AIRequestPrompt;
  /** Máximo de tokens de salida a pedir (con la reserva de razonamiento, si aplica). */
  maxOutputTokens: number;
  /** Corta el intento al vencer su tiempo o si quien pidió cancela. */
  signal: AbortSignal;
}

/** Lo que devuelve un adaptador; el router lo completa (id, intentos, latencia) y lo normaliza. */
export interface ProviderResult {
  /** Modelo que informó el proveedor (puede ser una versión fechada del pedido). */
  model: string;
  text: string;
  /** JSON ya leído, si el adaptador lo obtuvo directo (por ejemplo, de una herramienta forzada). */
  json?: unknown;
  toolCalls: AIToolCall[];
  finishReason: AIFinishReason;
  usage: AIUsage;
  state: AIProviderState | null;
  warnings: AIWarning[];
}

/** Lo que implementa cada proveedor (OpenAI, Anthropic, Gemini, xAI). */
export interface ModelProvider {
  readonly id: AIProviderId;
  /** Tiene llave (si no, el router lo salta). */
  isConfigured(): boolean;
  /** Sus modelos por nivel. */
  models(): readonly ModelSpec[];
  /** Una llamada a su API oficial. Lanza AIProviderError con el error ya normalizado. */
  generate(call: ProviderCall): Promise<ProviderResult>;
}

export const EMPTY_USAGE: AIUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0, cachedInputTokens: 0, reasoningTokens: 0 };
