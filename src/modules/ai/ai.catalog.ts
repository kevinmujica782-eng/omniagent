// Catálogo de modelos del router: qué modelo usa cada proveedor en cada nivel y qué admite cada uno. Los ids se
// cambian con variables de entorno (ver ai.service.ts); las capacidades salen de la documentación oficial de cada
// proveedor (octubre de 2026) y deciden qué proveedores pueden atender un pedido.
import { AI_PROVIDER_IDS, type AIProviderId, type AITier } from "@/types/ai";
import type { AIRequestPrompt, ImageMediaType, ModelSpec } from "./ai.types";

/** Modelos por defecto. Anthropic usa los del plan (ANTHROPIC_MODEL_FREE y ANTHROPIC_MODEL_PRO). */
export const DEFAULT_MODELS: Record<AIProviderId, Record<AITier, string>> = {
  anthropic: { fast: "claude-haiku-4-5-20251001", smart: "claude-sonnet-5-5" },
  openai: { fast: "gpt-6-luna", smart: "gpt-6.1-sol" },
  gemini: { fast: "gemini-3.5-flash-lite", smart: "gemini-3.8-flash" },
  xai: { fast: "grok-4.3", smart: "grok-4.7" },
};

/** Orden en que el router prueba los proveedores si el pedido no elige uno. */
export const DEFAULT_PROVIDER_ORDER: readonly AIProviderId[] = ["anthropic", "openai", "gemini", "xai"];

const ALL_IMAGES: readonly ImageMediaType[] = ["image/png", "image/jpeg", "image/webp", "image/gif"];

/**
 * Claude Opus y Sonnet desde la 5.5, Fable y Mythos responden 400 si se los obliga a usar una herramienta
 * (`tool_choice` any o tool). Haiku y los modelos anteriores sí lo permiten.
 */
export function anthropicSupportsForcedTools(model: string): boolean {
  const match = /claude-(opus|sonnet|haiku|fable|mythos)-(\d+)(?:-(\d{1,2})(?!\d))?/.exec(model);
  if (!match) return true;
  const [, family, major, minor] = match;
  if (family === "fable" || family === "mythos") return false;
  if (family === "haiku") return true;
  const version = Number(major) + Number(minor ?? 0) / 10;
  return version < 5.5;
}

export function anthropicModel(id: string, tier: AITier): ModelSpec {
  return {
    provider: "anthropic",
    id,
    tier,
    capabilities: {
      imageTypes: ALL_IMAGES,
      pdf: true,
      tools: true,
      jsonSchema: true,
      // Los modelos posteriores a Opus 4.6 rechazan cualquier temperatura distinta de 1.
      temperature: false,
      stop: true,
      forcedToolChoice: anthropicSupportsForcedTools(id),
      reasoningEffort: false,
    },
    maxOutputTokens: 32_000,
    reasoningReserveTokens: 0,
    timeoutMs: tier === "smart" ? 45_000 : 30_000,
  };
}

export function openAIModel(id: string, tier: AITier): ModelSpec {
  return {
    provider: "openai",
    id,
    tier,
    capabilities: {
      imageTypes: ALL_IMAGES,
      pdf: true,
      tools: true,
      jsonSchema: true,
      // GPT-6 razona siempre: no acepta temperatura ni top_p. La Responses API no tiene secuencias de corte.
      temperature: false,
      stop: false,
      forcedToolChoice: true,
      reasoningEffort: true,
    },
    maxOutputTokens: 64_000,
    // max_output_tokens incluye el razonamiento.
    reasoningReserveTokens: tier === "smart" ? 8_192 : 4_096,
    timeoutMs: tier === "smart" ? 50_000 : 30_000,
  };
}

export function geminiModel(id: string, tier: AITier): ModelSpec {
  return {
    provider: "gemini",
    id,
    tier,
    capabilities: {
      imageTypes: ["image/png", "image/jpeg", "image/webp"],
      pdf: true,
      tools: true,
      jsonSchema: true,
      // Desde Gemini 3.6, temperature/top_p/top_k están obsoletos y la API los rechazará.
      temperature: false,
      stop: true,
      forcedToolChoice: true,
      reasoningEffort: true,
    },
    maxOutputTokens: 32_000,
    // maxOutputTokens incluye el pensamiento.
    reasoningReserveTokens: tier === "smart" ? 4_096 : 1_024,
    timeoutMs: tier === "smart" ? 45_000 : 30_000,
  };
}

export function xaiModel(id: string, tier: AITier): ModelSpec {
  return {
    provider: "xai",
    id,
    tier,
    capabilities: {
      // xAI acepta solo JPG y PNG, y no lee PDF.
      imageTypes: ["image/png", "image/jpeg"],
      pdf: false,
      tools: true,
      jsonSchema: true,
      temperature: true,
      // Los modelos de razonamiento de Grok responden error si se manda `stop`.
      stop: false,
      forcedToolChoice: true,
      reasoningEffort: true,
    },
    maxOutputTokens: 32_000,
    // max_completion_tokens cuenta solo la salida visible.
    reasoningReserveTokens: 0,
    timeoutMs: tier === "smart" ? 50_000 : 30_000,
  };
}

export const MODEL_SPEC_BUILDERS: Record<AIProviderId, (id: string, tier: AITier) => ModelSpec> = {
  anthropic: anthropicModel,
  openai: openAIModel,
  gemini: geminiModel,
  xai: xaiModel,
};

/** "openai, gemini" → [openai, gemini, anthropic, xai]: los nombrados primero y el resto en el orden por defecto. */
export function parseProviderOrder(value: string | undefined): AIProviderId[] {
  const known = new Set<string>(AI_PROVIDER_IDS);
  const named = (value ?? "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter((item): item is AIProviderId => known.has(item));
  return [...new Set([...named, ...DEFAULT_PROVIDER_ORDER])];
}

/** El modelo que eligió la persona (profiles.preferences.ai.provider); null = automático. */
export function preferredProviderOf(preferences: unknown): AIProviderId | null {
  const ai = preferences && typeof preferences === "object" ? (preferences as { ai?: unknown }).ai : null;
  const provider = ai && typeof ai === "object" ? (ai as { provider?: unknown }).provider : null;
  return typeof provider === "string" && (AI_PROVIDER_IDS as readonly string[]).includes(provider) ? (provider as AIProviderId) : null;
}

// ── Qué necesita un pedido ───────────────────────────────────────────────────

export interface RequestNeeds {
  imageTypes: Set<ImageMediaType>;
  pdf: boolean;
  tools: boolean;
  jsonSchema: boolean;
}

export function needsOf(request: AIRequestPrompt): RequestNeeds {
  const needs: RequestNeeds = {
    imageTypes: new Set(),
    pdf: false,
    tools: Boolean(request.tools?.length),
    jsonSchema: request.responseFormat?.type === "json" && Boolean(request.responseFormat.schema),
  };
  for (const message of request.messages) {
    if (message.role !== "user" || typeof message.content === "string") continue;
    for (const part of message.content) {
      if (part.type === "image") needs.imageTypes.add(part.mediaType);
      if (part.type === "file") needs.pdf = true;
    }
  }
  return needs;
}

/** Por qué un modelo no puede atender el pedido (null si puede). */
export function unsupportedNeed(spec: ModelSpec, needs: RequestNeeds): string | null {
  const caps = spec.capabilities;
  if (needs.pdf && !caps.pdf) return "no lee PDF";
  for (const type of needs.imageTypes) if (!caps.imageTypes.includes(type)) return `no acepta imágenes ${type}`;
  if (needs.tools && !caps.tools) return "no usa herramientas";
  if (needs.jsonSchema && !caps.jsonSchema) return "no genera JSON con esquema";
  return null;
}
