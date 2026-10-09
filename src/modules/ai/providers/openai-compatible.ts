// Proveedores con API compatible con Chat Completions de OpenAI (POST {base}/chat/completions). Hoy lo usa xAI (Grok);
// otro proveedor compatible se agrega con sus modelos y su URL. Particularidades de xAI (documentación de 2026):
// `max_completion_tokens` (max_tokens está obsoleto), los modelos de razonamiento rechazan `stop` y las penalidades,
// solo acepta imágenes JPG y PNG, y no lee PDF.
import type { AIFinishReason, AIProviderId, AIToolCall, AIWarning } from "@/types/ai";
import { xaiModel } from "../ai.catalog";
import { AIProviderError } from "../ai.errors";
import { dataUrl, errorMessageOf, isRecord, numberOf, parseRetryAfter, parseToolArguments, postJson, type FetchLike, type JsonReply } from "../ai.http";
import { cleanSchema, isStrictCompatible, objectRoot, unwrapJson } from "../ai.schema";
import type { AIContentPart, AIRequestPrompt, AIToolChoice, ModelProvider, ModelSpec, ProviderCall, ProviderResult } from "../ai.types";
import { formatName } from "./openai";

export interface ChatCompletionsConfig {
  id: AIProviderId;
  apiKey?: string;
  /** URL base con la versión, sin barra final (https://api.x.ai/v1). */
  baseUrl: string;
  models: readonly ModelSpec[];
  fetch?: FetchLike;
}

type Item = Record<string, unknown>;

function userContent(provider: AIProviderId, content: string | AIContentPart[]): unknown {
  if (typeof content === "string") return content;
  return content.map((part) => {
    if (part.type === "text") return { type: "text", text: part.text };
    if (part.type === "image") return { type: "image_url", image_url: { url: dataUrl(part.mediaType, part.data), detail: "auto" } };
    throw new AIProviderError("invalid_request", { provider, detail: "Este proveedor no lee PDF." });
  });
}

export function toChatMessages(provider: AIProviderId, request: AIRequestPrompt): Item[] {
  const out: Item[] = [];
  const system: string[] = request.system?.trim() ? [request.system.trim()] : [];
  if (request.responseFormat?.type === "json" && !request.responseFormat.schema) system.push("Responde solo con un objeto JSON válido.");
  if (system.length) out.push({ role: "system", content: system.join("\n\n") });
  for (const message of request.messages) {
    if (message.role === "user") {
      out.push({ role: "user", content: userContent(provider, message.content) });
    } else if (message.role === "tool") {
      out.push({ role: "tool", tool_call_id: message.toolCallId, content: message.isError ? `Error: ${message.content}` : message.content });
    } else {
      const calls = message.toolCalls ?? [];
      out.push({
        role: "assistant",
        content: message.content || null,
        ...(calls.length
          ? { tool_calls: calls.map((call) => ({ id: call.id, type: "function", function: { name: call.name, arguments: JSON.stringify(call.arguments) } })) }
          : {}),
      });
    }
  }
  return out;
}

function toolChoiceOf(choice: AIToolChoice): unknown {
  return typeof choice === "string" ? choice : { type: "function", function: { name: choice.name } };
}

export function buildChatRequest(provider: AIProviderId, call: ProviderCall): { body: Item; warnings: AIWarning[]; wrapped: boolean } {
  const { request, model } = call;
  const body: Item = { model: model.id, messages: toChatMessages(provider, request), max_completion_tokens: call.maxOutputTokens };
  let wrapped = false;
  const format = request.responseFormat;
  if (format?.type === "json") {
    if (format.schema) {
      const root = objectRoot(cleanSchema(format.schema));
      wrapped = root.wrapped;
      body.response_format = {
        type: "json_schema",
        json_schema: { name: formatName(format.name), schema: root.schema, ...(isStrictCompatible(root.schema) ? { strict: true } : {}) },
      };
    } else {
      body.response_format = { type: "json_object" };
    }
  }
  if (request.tools?.length) {
    body.tools = request.tools.map((tool) => ({ type: "function", function: { name: tool.name, description: tool.description, parameters: cleanSchema(tool.parameters) } }));
    if (request.toolChoice) body.tool_choice = toolChoiceOf(request.toolChoice);
  }
  if (request.temperature !== undefined && model.capabilities.temperature) body.temperature = request.temperature;
  if (request.stop?.length && model.capabilities.stop) body.stop = request.stop.slice(0, 4);
  if (request.reasoning && model.capabilities.reasoningEffort) body.reasoning_effort = request.reasoning;
  return { body, warnings: [], wrapped };
}

export function parseChatResponse(provider: AIProviderId, call: ProviderCall, body: unknown, wrapped: boolean): ProviderResult {
  if (!isRecord(body)) throw new AIProviderError("bad_response", { provider, detail: "Respuesta que no es un objeto." });
  const choice = Array.isArray(body.choices) ? body.choices.find(isRecord) : undefined;
  if (!choice) throw new AIProviderError("bad_response", { provider, detail: "Respuesta sin opciones." });
  const message = isRecord(choice.message) ? choice.message : {};

  let text = "";
  if (typeof message.content === "string") text = message.content;
  else if (Array.isArray(message.content)) {
    text = message.content
      .filter(isRecord)
      .map((part) => (typeof part.text === "string" ? part.text : ""))
      .join("");
  }
  const toolCalls: AIToolCall[] = (Array.isArray(message.tool_calls) ? message.tool_calls.filter(isRecord) : []).map((item, index) => {
    const fn = isRecord(item.function) ? item.function : {};
    return { id: String(item.id ?? `call_${index + 1}`), name: String(fn.name ?? ""), arguments: parseToolArguments(provider, fn.arguments) };
  });
  const refusal = typeof message.refusal === "string" ? message.refusal : "";

  // xAI no documenta "tool_calls" como finish_reason: las llamadas se detectan en el mensaje.
  let finishReason: AIFinishReason;
  if (choice.finish_reason === "length") finishReason = "length";
  else if (choice.finish_reason === "content_filter") finishReason = "content_filter";
  else if (toolCalls.length) finishReason = "tool_calls";
  else if (refusal && !text) {
    finishReason = "content_filter";
    text = refusal;
  } else finishReason = "stop";

  const usage = isRecord(body.usage) ? body.usage : {};
  const promptDetails = isRecord(usage.prompt_tokens_details) ? usage.prompt_tokens_details : {};
  const completionDetails = isRecord(usage.completion_tokens_details) ? usage.completion_tokens_details : {};
  const inputTokens = numberOf(usage.prompt_tokens);
  const outputTokens = numberOf(usage.completion_tokens);

  return {
    model: typeof body.model === "string" ? body.model : call.model.id,
    text,
    ...(wrapped && finishReason === "stop" ? { json: unwrapJson(text) } : {}),
    toolCalls,
    finishReason,
    usage: {
      inputTokens,
      outputTokens,
      totalTokens: numberOf(usage.total_tokens) || inputTokens + outputTokens,
      cachedInputTokens: numberOf(promptDetails.cached_tokens),
      reasoningTokens: numberOf(completionDetails.reasoning_tokens),
    },
    // Chat Completions no guarda estado: el turno siguiente se arma con el texto y las llamadas.
    state: null,
    warnings: [],
  };
}

const QUOTA_TEXT = /credit|spending limit|spend limit|quota|billing|exhausted|insufficient/i;

export function chatError(provider: AIProviderId, reply: JsonReply): AIProviderError {
  const detail = errorMessageOf(reply.body, reply.raw);
  const errorCode = isRecord(reply.body) && isRecord(reply.body.error) && typeof reply.body.error.code === "string" ? reply.body.error.code : "";
  const base = { provider, httpStatus: reply.status, detail };
  const status = reply.status;
  if (status === 401) return new AIProviderError("auth_failed", base);
  if (status === 402) return new AIProviderError("quota_exceeded", base);
  if (status === 403) return new AIProviderError(QUOTA_TEXT.test(detail) ? "quota_exceeded" : "auth_failed", base);
  if (status === 404) return new AIProviderError("model_not_found", base);
  if (status === 408) return new AIProviderError("timeout", base);
  if (status === 409) return new AIProviderError("provider_unavailable", base);
  if (status === 413) return new AIProviderError("context_too_long", base);
  if (status === 429) {
    if (QUOTA_TEXT.test(detail) || errorCode === "insufficient_quota") return new AIProviderError("quota_exceeded", base);
    return new AIProviderError("rate_limited", { ...base, retryAfterMs: parseRetryAfter(reply.headers.get("retry-after")) });
  }
  if (status >= 500) return new AIProviderError("provider_unavailable", { ...base, retryAfterMs: parseRetryAfter(reply.headers.get("retry-after")) });
  // xAI responde 400 a una llave incorrecta.
  if (/api key/i.test(detail)) return new AIProviderError("auth_failed", base);
  if (/context|too long|maximum.*tokens|token limit/i.test(detail)) return new AIProviderError("context_too_long", base);
  if (QUOTA_TEXT.test(detail)) return new AIProviderError("quota_exceeded", base);
  return new AIProviderError("invalid_request", base);
}

export function chatCompletionsProvider(config: ChatCompletionsConfig): ModelProvider {
  const baseUrl = config.baseUrl.replace(/\/+$/, "");
  const fetchImpl: FetchLike = config.fetch ?? ((input, init) => fetch(input, init));
  const provider = config.id;
  return {
    id: provider,
    isConfigured: () => Boolean(config.apiKey),
    models: () => config.models,
    async generate(call) {
      if (!config.apiKey) throw new AIProviderError("not_configured", { provider });
      const { body, warnings, wrapped } = buildChatRequest(provider, call);
      const reply = await postJson({
        provider,
        url: `${baseUrl}/chat/completions`,
        headers: { authorization: `Bearer ${config.apiKey}` },
        body,
        signal: call.signal,
        fetch: fetchImpl,
      });
      if (reply.status < 200 || reply.status >= 300) throw chatError(provider, reply);
      const result = parseChatResponse(provider, call, reply.body, wrapped);
      return { ...result, warnings: [...warnings, ...result.warnings] };
    },
  };
}

/** xAI (Grok), compatible con el formato de OpenAI. */
export function xaiProvider(config: { apiKey?: string; baseUrl?: string; models: { fast: string; smart: string }; fetch?: FetchLike }): ModelProvider {
  return chatCompletionsProvider({
    id: "xai",
    apiKey: config.apiKey,
    baseUrl: config.baseUrl ?? "https://api.x.ai/v1",
    models: [xaiModel(config.models.fast, "fast"), xaiModel(config.models.smart, "smart")],
    fetch: config.fetch,
  });
}
