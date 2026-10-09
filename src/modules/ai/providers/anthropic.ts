// Anthropic (Claude) con la Messages API (POST /v1/messages). JSON con esquema de dos formas, según el modelo:
// - Haiku y los modelos anteriores a la 5.5: herramienta forzada con el esquema (el camino de siempre de la app).
// - Opus y Sonnet 5.5, Fable y Mythos, que responden 400 si se les fuerza una herramienta: salida estructurada
//   (`output_config.format`). Si un modelo nuevo deja de aceptar la herramienta forzada, se repite con salida
//   estructurada en el mismo intento.
import type { AIFinishReason, AIToolCall, AIWarning } from "@/types/ai";
import { anthropicModel } from "../ai.catalog";
import { AIProviderError } from "../ai.errors";
import { errorMessageOf, isRecord, numberOf, parseRetryAfter, postJson, type FetchLike, type JsonReply } from "../ai.http";
import { cleanSchema, objectRoot, toAnthropicOutputSchema, unwrapJson } from "../ai.schema";
import type { AIContentPart, AIMessage, AIRequestPrompt, AISystemPart, JsonSchema, ModelProvider, ProviderCall, ProviderResult } from "../ai.types";

export interface AnthropicConfig {
  apiKey?: string;
  /** Por defecto https://api.anthropic.com */
  baseUrl?: string;
  /** Cabecera anthropic-version (por defecto 2023-06-01, la vigente). */
  version?: string;
  models: { fast: string; smart: string };
  fetch?: FetchLike;
}

type Block = Record<string, unknown>;
export interface AnthropicMessage {
  role: "user" | "assistant";
  content: Block[];
}

/** Cómo se pide el JSON: herramienta forzada, salida estructurada, solo en las instrucciones, o no se pide. */
export type AnthropicJsonMode =
  | { kind: "none" }
  | { kind: "prompt" }
  | { kind: "tool"; name: string; schema: JsonSchema; wrapped: boolean }
  | { kind: "output"; schema: JsonSchema; wrapped: boolean };

function userBlocks(content: string | AIContentPart[]): Block[] {
  if (typeof content === "string") return content ? [{ type: "text", text: content }] : [];
  return content.map((part) => {
    if (part.type === "text") return { type: "text", text: part.text };
    if (part.type === "image") return { type: "image", source: { type: "base64", media_type: part.mediaType, data: part.data } };
    return {
      type: "document",
      source: { type: "base64", media_type: "application/pdf", data: part.data },
      ...(part.filename ? { title: part.filename } : {}),
    };
  });
}

/** Los mensajes en el formato de Claude: turnos alternados, con los resultados de herramientas al inicio del turno. */
export function toAnthropicMessages(messages: readonly AIMessage[]): AnthropicMessage[] {
  const out: AnthropicMessage[] = [];
  const push = (role: AnthropicMessage["role"], blocks: Block[]) => {
    if (blocks.length === 0) return;
    const last = out.at(-1);
    if (last?.role === role) last.content.push(...blocks);
    else out.push({ role, content: [...blocks] });
  };
  for (const message of messages) {
    if (message.role === "user") {
      push("user", userBlocks(message.content));
    } else if (message.role === "tool") {
      push("user", [{ type: "tool_result", tool_use_id: message.toolCallId, content: message.content, ...(message.isError ? { is_error: true } : {}) }]);
    } else {
      // Un turno de Claude vuelve tal cual (con sus bloques de pensamiento firmados); el de otro proveedor, como
      // texto y llamadas.
      const replay = message.state?.provider === "anthropic" && isRecord(message.state.data) ? message.state.data.content : null;
      if (Array.isArray(replay)) {
        push("assistant", replay.filter(isRecord));
        continue;
      }
      const blocks: Block[] = message.content ? [{ type: "text", text: message.content }] : [];
      for (const call of message.toolCalls ?? []) blocks.push({ type: "tool_use", id: call.id, name: call.name, input: call.arguments });
      push("assistant", blocks);
    }
  }
  return out;
}

/**
 * Instrucciones como bloques: las partes marcadas `cache` (o un texto único) con punto de caché, y al final lo que
 * agrega el adaptador. Claude guarda en caché todo lo anterior a cada punto (herramientas incluidas).
 */
function systemBlocks(system: AIRequestPrompt["system"], extra: string[]): Block[] {
  const parts: readonly AISystemPart[] = !system ? [] : typeof system === "string" ? [{ text: system, cache: true }] : system;
  const blocks: Block[] = parts
    .filter((part) => part.text.trim())
    .map((part) => ({ type: "text", text: part.text.trim(), ...(part.cache ? { cache_control: { type: "ephemeral" } } : {}) }));
  if (extra.length) blocks.push({ type: "text", text: extra.join("\n\n") });
  return blocks;
}

/** Nombre de la herramienta del JSON: letras, números, guion y guion bajo (máx. 64). */
function jsonToolName(name: string | undefined): string {
  const clean = (name ?? "").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
  return clean || "respuesta";
}

export function anthropicJsonMode(call: ProviderCall, opts: { avoidForcedTool?: boolean } = {}): AnthropicJsonMode {
  const format = call.request.responseFormat;
  if (format?.type !== "json") return { kind: "none" };
  if (!format.schema) return { kind: "prompt" };
  const root = objectRoot(cleanSchema(format.schema));
  const forced = call.model.capabilities.forcedToolChoice && !opts.avoidForcedTool && !call.request.tools?.length;
  return forced
    ? { kind: "tool", name: jsonToolName(format.name), schema: root.schema, wrapped: root.wrapped }
    : { kind: "output", schema: toAnthropicOutputSchema(root.schema), wrapped: root.wrapped };
}

export function buildAnthropicRequest(call: ProviderCall, mode: AnthropicJsonMode): { body: Block; warnings: AIWarning[] } {
  const { request, model } = call;
  const warnings: AIWarning[] = [];
  // Lo que agrega el adaptador (herramienta obligatoria pedida en palabras, JSON) va aparte, sin caché.
  const extra: string[] = [];
  const body: Block = { model: model.id, max_tokens: call.maxOutputTokens, messages: toAnthropicMessages(request.messages) };

  const tools: Block[] = (request.tools ?? []).map((tool) => ({ name: tool.name, description: tool.description, input_schema: cleanSchema(tool.parameters) }));
  let toolChoice: Block | null = null;
  const choice = request.toolChoice;
  if (tools.length && choice) {
    if (choice === "auto" || choice === "none") {
      toolChoice = { type: choice };
    } else if (model.capabilities.forcedToolChoice) {
      toolChoice = choice === "required" ? { type: "any" } : { type: "tool", name: choice.name };
    } else {
      // Opus/Sonnet 5.5 no permiten obligar una herramienta: se pide en las instrucciones.
      toolChoice = { type: "auto" };
      warnings.push("tool_choice_relaxed");
      extra.push(choice === "required" ? "Responde usando una de las herramientas disponibles." : `Responde usando la herramienta ${choice.name}.`);
    }
  }

  if (mode.kind === "tool") {
    tools.push({ name: mode.name, description: "Entrega la respuesta con esta estructura exacta.", input_schema: mode.schema });
    toolChoice = { type: "tool", name: mode.name };
  } else if (mode.kind === "output") {
    body.output_config = { format: { type: "json_schema", schema: mode.schema } };
  } else if (mode.kind === "prompt") {
    extra.push("Responde solo con un objeto JSON válido, sin texto adicional.");
  }

  const system = systemBlocks(request.system, extra);
  if (system.length) body.system = system;
  if (tools.length) body.tools = tools;
  if (toolChoice) body.tool_choice = toolChoice;
  if (request.stop?.length && model.capabilities.stop) body.stop_sequences = [...request.stop];
  if (request.temperature !== undefined && model.capabilities.temperature) body.temperature = request.temperature;
  return { body, warnings };
}

const FINISH: Record<string, AIFinishReason> = {
  end_turn: "stop",
  stop_sequence: "stop",
  max_tokens: "length",
  model_context_window_exceeded: "length",
  refusal: "content_filter",
  pause_turn: "other",
};

export function parseAnthropicResponse(call: ProviderCall, body: unknown, mode: AnthropicJsonMode): ProviderResult {
  if (!isRecord(body)) throw new AIProviderError("bad_response", { provider: "anthropic", detail: "Respuesta que no es un objeto." });
  const content = Array.isArray(body.content) ? body.content.filter(isRecord) : [];
  let text = "";
  let json: unknown;
  const toolCalls: AIToolCall[] = [];
  for (const block of content) {
    if (block.type === "text" && typeof block.text === "string") {
      text += block.text;
    } else if (block.type === "tool_use") {
      const input = isRecord(block.input) ? block.input : {};
      if (mode.kind === "tool" && block.name === mode.name) json = mode.wrapped ? input.value : input;
      else toolCalls.push({ id: String(block.id ?? `toolu_${toolCalls.length + 1}`), name: String(block.name ?? ""), arguments: input });
    }
  }
  const stopReason = typeof body.stop_reason === "string" ? body.stop_reason : "";
  let finishReason: AIFinishReason = FINISH[stopReason] ?? (toolCalls.length ? "tool_calls" : "stop");
  if (stopReason === "tool_use") finishReason = toolCalls.length ? "tool_calls" : "stop";

  // El JSON de la herramienta forzada también va como texto (para un turno de corrección, por ejemplo).
  if (json !== undefined && !text) text = JSON.stringify(json);
  if (mode.kind === "output" && mode.wrapped && finishReason === "stop") json = unwrapJson(text);

  const usage = isRecord(body.usage) ? body.usage : {};
  const cacheRead = numberOf(usage.cache_read_input_tokens);
  const inputTokens = numberOf(usage.input_tokens) + cacheRead + numberOf(usage.cache_creation_input_tokens);
  const outputTokens = numberOf(usage.output_tokens);
  const outputDetails = isRecord(usage.output_tokens_details) ? usage.output_tokens_details : {};
  const model = typeof body.model === "string" ? body.model : call.model.id;

  return {
    model,
    text,
    ...(json !== undefined ? { json } : {}),
    toolCalls,
    finishReason,
    usage: {
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      cachedInputTokens: cacheRead,
      reasoningTokens: numberOf(outputDetails.thinking_tokens),
    },
    state: toolCalls.length ? { provider: "anthropic", model, data: { content } } : null,
    warnings: [],
  };
}

export function anthropicError(reply: JsonReply): AIProviderError {
  const error = isRecord(reply.body) && isRecord(reply.body.error) ? reply.body.error : {};
  const type = typeof error.type === "string" ? error.type : "";
  const details = isRecord(error.details) ? error.details : {};
  const detail = errorMessageOf(reply.body, reply.raw);
  const base = { provider: "anthropic" as const, httpStatus: reply.status, detail };
  const status = reply.status;
  const retryAfterMs = parseRetryAfter(reply.headers.get("retry-after"));
  if (status === 429) {
    // El tope mensual de gasto del nivel de uso también llega como 429, pero esperar unos segundos no lo resuelve.
    if (details.error_code === "enforced_spend_limit_reached" || /spend limit|credit balance/i.test(detail)) {
      return new AIProviderError("quota_exceeded", base);
    }
    return new AIProviderError("rate_limited", { ...base, retryAfterMs });
  }
  if (status === 402 || type === "billing_error") return new AIProviderError("quota_exceeded", base);
  if (status === 401 || status === 403) return new AIProviderError("auth_failed", base);
  if (status === 404) return new AIProviderError("model_not_found", base);
  if (status === 413) return new AIProviderError("context_too_long", base);
  if (status === 504) return new AIProviderError("timeout", base);
  if (status === 409 || status >= 500) return new AIProviderError("provider_unavailable", { ...base, retryAfterMs });
  if (/usage limits|credit balance|billing/i.test(detail)) return new AIProviderError("quota_exceeded", base);
  if (/prompt is too long|context window|maximum context|too many tokens/i.test(detail)) return new AIProviderError("context_too_long", base);
  return new AIProviderError("invalid_request", base);
}

export function anthropicProvider(config: AnthropicConfig): ModelProvider {
  const baseUrl = (config.baseUrl ?? "https://api.anthropic.com").replace(/\/+$/, "");
  const specs = [anthropicModel(config.models.fast, "fast"), anthropicModel(config.models.smart, "smart")];
  const fetchImpl: FetchLike = config.fetch ?? ((input, init) => fetch(input, init));
  return {
    id: "anthropic",
    isConfigured: () => Boolean(config.apiKey),
    models: () => specs,
    async generate(call) {
      if (!config.apiKey) throw new AIProviderError("not_configured", { provider: "anthropic" });
      let mode = anthropicJsonMode(call);
      for (let pass = 0; ; pass++) {
        const { body, warnings } = buildAnthropicRequest(call, mode);
        const reply = await postJson({
          provider: "anthropic",
          url: `${baseUrl}/v1/messages`,
          headers: { "x-api-key": config.apiKey, "anthropic-version": config.version ?? "2023-06-01" },
          body,
          signal: call.signal,
          fetch: fetchImpl,
        });
        if (reply.status >= 200 && reply.status < 300) {
          const result = parseAnthropicResponse(call, reply.body, mode);
          return { ...result, warnings: [...warnings, ...result.warnings] };
        }
        const error = anthropicError(reply);
        // Un modelo que ya no permite forzar la herramienta: mismo pedido con salida estructurada.
        if (pass === 0 && mode.kind === "tool" && error.code === "invalid_request" && /tool_choice|tool use|forced/i.test(error.detail)) {
          mode = anthropicJsonMode(call, { avoidForcedTool: true });
          continue;
        }
        throw error;
      }
    },
  };
}
