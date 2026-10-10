// OpenAI (ChatGPT) con la Responses API (POST /v1/responses), la recomendada por OpenAI: con GPT-6 las herramientas
// solo funcionan ahí. Sin estado en OpenAI (`store: false`): para seguir una ronda de herramientas se le devuelven sus
// propios elementos de salida, con el razonamiento cifrado incluido.
import type { AIFinishReason, AIToolCall, AIWarning } from "@/types/ai";
import { openAIModel } from "../ai.catalog";
import { AIProviderError } from "../ai.errors";
import {
  dataUrl,
  errorMessageOf,
  isRecord,
  numberOf,
  parseDuration,
  parseRetryAfter,
  parseToolArguments,
  postJson,
  type FetchLike,
  type JsonReply,
} from "../ai.http";
import { cleanSchema, isStrictCompatible, objectRoot, unwrapJson } from "../ai.schema";
import { systemText, type AIContentPart, type AIMessage, type AIToolChoice, type ModelProvider, type ProviderCall, type ProviderResult } from "../ai.types";

export interface OpenAIConfig {
  apiKey?: string;
  /** Por defecto https://api.openai.com/v1 */
  baseUrl?: string;
  models: { fast: string; smart: string };
  organization?: string;
  fetch?: FetchLike;
}

type Item = Record<string, unknown>;

/** Errores 429 que no son de ritmo sino de saldo o tope de gasto: reintentar no ayuda. */
const QUOTA_CODES = new Set([
  "insufficient_quota",
  "credit_balance_exhausted",
  "organization_spend_limit_exceeded",
  "project_spend_limit_exceeded",
  "organization_usage_limit_exceeded",
  "billing_hard_limit_reached",
]);

/** Nombre del formato JSON: letras, números, guion y guion bajo (máx. 64). */
export function formatName(name: string | undefined): string {
  const clean = (name ?? "").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
  return clean || "respuesta";
}

function userContent(content: string | AIContentPart[]): unknown {
  if (typeof content === "string") return content;
  return content.map((part) => {
    if (part.type === "text") return { type: "input_text", text: part.text };
    if (part.type === "image") return { type: "input_image", image_url: dataUrl(part.mediaType, part.data), detail: "auto" };
    return { type: "input_file", filename: part.filename ?? "documento.pdf", file_data: dataUrl(part.mediaType, part.data) };
  });
}

/** Los mensajes como elementos de `input`. */
export function toOpenAIInput(messages: readonly AIMessage[]): Item[] {
  const input: Item[] = [];
  for (const message of messages) {
    if (message.role === "user") {
      input.push({ role: "user", content: userContent(message.content) });
      continue;
    }
    if (message.role === "tool") {
      input.push({ type: "function_call_output", call_id: message.toolCallId, output: message.isError ? `Error: ${message.content}` : message.content });
      continue;
    }
    // Un turno de OpenAI se devuelve tal cual (razonamiento cifrado y llamadas incluidas); el de otro proveedor, como
    // texto y llamadas sin id propio.
    const items = message.state?.provider === "openai" && isRecord(message.state.data) ? message.state.data.items : null;
    if (Array.isArray(items)) {
      input.push(...items.filter(isRecord));
      continue;
    }
    if (message.content) input.push({ role: "assistant", content: message.content });
    for (const call of message.toolCalls ?? []) {
      input.push({ type: "function_call", call_id: call.id, name: call.name, arguments: JSON.stringify(call.arguments) });
    }
  }
  return input;
}

function toolChoiceOf(choice: AIToolChoice): unknown {
  return typeof choice === "string" ? choice : { type: "function", name: choice.name };
}

export function buildOpenAIRequest(call: ProviderCall): { body: Item; warnings: AIWarning[]; wrapped: boolean } {
  const { request, model } = call;
  const body: Item = { model: model.id, input: toOpenAIInput(request.messages), max_output_tokens: call.maxOutputTokens, store: false };
  const system = systemText(request.system);
  const instructions: string[] = system ? [system] : [];
  let wrapped = false;

  const format = request.responseFormat;
  if (format?.type === "json") {
    if (format.schema) {
      const root = objectRoot(cleanSchema(format.schema));
      wrapped = root.wrapped;
      body.text = { format: { type: "json_schema", name: formatName(format.name), schema: root.schema, strict: isStrictCompatible(root.schema) } };
    } else {
      body.text = { format: { type: "json_object" } };
      instructions.push("Responde solo con un objeto JSON válido.");
    }
  }
  if (instructions.length) body.instructions = instructions.join("\n\n");

  if (request.tools?.length) {
    body.tools = request.tools.map((tool) => {
      const parameters = cleanSchema(tool.parameters);
      // En la Responses API el modo estricto no se deja al valor por defecto: solo se pide con un esquema que lo admite
      // (todo requerido y sin propiedades extra); con campos opcionales, como casi todas las herramientas de Omni, no.
      return { type: "function", name: tool.name, description: tool.description, parameters, strict: isStrictCompatible(parameters) };
    });
    // Sin estado en OpenAI: el razonamiento cifrado vuelve en la respuesta para el turno siguiente.
    body.include = ["reasoning.encrypted_content"];
    if (request.toolChoice) body.tool_choice = toolChoiceOf(request.toolChoice);
  }
  if (request.reasoning && model.capabilities.reasoningEffort) body.reasoning = { effort: request.reasoning };
  if (request.temperature !== undefined && model.capabilities.temperature) body.temperature = request.temperature;
  return { body, warnings: [], wrapped };
}

/** Error de una respuesta con `status: "failed"`. */
function failedResponse(error: unknown): AIProviderError {
  const code = isRecord(error) && typeof error.code === "string" ? error.code : "";
  const detail = isRecord(error) && typeof error.message === "string" ? error.message : code;
  if (code === "rate_limit_exceeded") return new AIProviderError("rate_limited", { provider: "openai", detail });
  if (code === "invalid_prompt" || code.startsWith("invalid_image") || code.startsWith("image_") || code === "invalid_base64_image") {
    return new AIProviderError("invalid_request", { provider: "openai", detail });
  }
  return new AIProviderError("provider_unavailable", { provider: "openai", detail: detail || "La respuesta falló." });
}

export function parseOpenAIResponse(call: ProviderCall, body: unknown, wrapped: boolean): ProviderResult {
  if (!isRecord(body)) throw new AIProviderError("bad_response", { provider: "openai", detail: "Respuesta que no es un objeto." });
  if (body.status === "failed") throw failedResponse(body.error);

  let text = "";
  let refusal = "";
  const toolCalls: AIToolCall[] = [];
  const output = Array.isArray(body.output) ? body.output.filter(isRecord) : [];
  for (const item of output) {
    if (item.type === "message" && Array.isArray(item.content)) {
      for (const part of item.content.filter(isRecord)) {
        if (part.type === "output_text" && typeof part.text === "string") text += part.text;
        if (part.type === "refusal" && typeof part.refusal === "string") refusal += part.refusal;
      }
    } else if (item.type === "function_call") {
      toolCalls.push({
        id: String(item.call_id ?? item.id ?? `call_${toolCalls.length + 1}`),
        name: String(item.name ?? ""),
        arguments: parseToolArguments("openai", item.arguments),
      });
    }
  }

  let finishReason: AIFinishReason;
  if (body.status === "incomplete") {
    const reason = isRecord(body.incomplete_details) ? body.incomplete_details.reason : null;
    finishReason = reason === "max_output_tokens" ? "length" : reason === "content_filter" ? "content_filter" : "other";
  } else if (toolCalls.length) {
    finishReason = "tool_calls";
  } else if (refusal && !text) {
    finishReason = "content_filter";
    text = refusal;
  } else {
    finishReason = "stop";
  }

  const usage = isRecord(body.usage) ? body.usage : {};
  const inputDetails = isRecord(usage.input_tokens_details) ? usage.input_tokens_details : {};
  const outputDetails = isRecord(usage.output_tokens_details) ? usage.output_tokens_details : {};
  const inputTokens = numberOf(usage.input_tokens);
  const outputTokens = numberOf(usage.output_tokens);
  const model = typeof body.model === "string" ? body.model : call.model.id;

  return {
    model,
    text,
    ...(wrapped && finishReason === "stop" ? { json: unwrapJson(text) } : {}),
    toolCalls,
    finishReason,
    usage: {
      inputTokens,
      outputTokens,
      totalTokens: numberOf(usage.total_tokens) || inputTokens + outputTokens,
      cachedInputTokens: numberOf(inputDetails.cached_tokens),
      reasoningTokens: numberOf(outputDetails.reasoning_tokens),
    },
    state: toolCalls.length ? { provider: "openai", model, data: { items: output } } : null,
    warnings: [],
  };
}

/** Cuánto esperar después de un 429: Retry-After o el reinicio del límite agotado (pedidos o tokens). */
function rateLimitWait(headers: Headers): number | null {
  const retryAfter = parseRetryAfter(headers.get("retry-after"));
  if (retryAfter !== null) return retryAfter;
  if (headers.get("x-ratelimit-remaining-requests") === "0") return parseDuration(headers.get("x-ratelimit-reset-requests"));
  if (headers.get("x-ratelimit-remaining-tokens") === "0") return parseDuration(headers.get("x-ratelimit-reset-tokens"));
  return null;
}

export function openAIError(reply: JsonReply): AIProviderError {
  const error = isRecord(reply.body) && isRecord(reply.body.error) ? reply.body.error : {};
  const code = typeof error.code === "string" ? error.code : "";
  const type = typeof error.type === "string" ? error.type : "";
  const detail = errorMessageOf(reply.body, reply.raw);
  const base = { provider: "openai" as const, httpStatus: reply.status, detail };
  const status = reply.status;
  if (status === 401 || status === 403) return new AIProviderError("auth_failed", base);
  if (status === 404) return new AIProviderError("model_not_found", base);
  if (status === 408) return new AIProviderError("timeout", base);
  if (status === 409) return new AIProviderError("provider_unavailable", base);
  if (status === 413) return new AIProviderError("context_too_long", base);
  if (status === 429) {
    if (QUOTA_CODES.has(code) || type === "insufficient_quota") return new AIProviderError("quota_exceeded", base);
    return new AIProviderError("rate_limited", { ...base, retryAfterMs: rateLimitWait(reply.headers) });
  }
  if (status >= 500) return new AIProviderError("provider_unavailable", { ...base, retryAfterMs: parseRetryAfter(reply.headers.get("retry-after")) });
  if (code === "context_length_exceeded" || /context (window|length)|maximum context|too many tokens|reduce the length/i.test(detail)) {
    return new AIProviderError("context_too_long", base);
  }
  if (code === "invalid_api_key" || /incorrect api key|invalid api key/i.test(detail)) return new AIProviderError("auth_failed", base);
  return new AIProviderError("invalid_request", base);
}

export function openAIProvider(config: OpenAIConfig): ModelProvider {
  const baseUrl = (config.baseUrl ?? "https://api.openai.com/v1").replace(/\/+$/, "");
  const specs = [openAIModel(config.models.fast, "fast"), openAIModel(config.models.smart, "smart")];
  const fetchImpl: FetchLike = config.fetch ?? ((input, init) => fetch(input, init));
  return {
    id: "openai",
    isConfigured: () => Boolean(config.apiKey),
    models: () => specs,
    async generate(call) {
      if (!config.apiKey) throw new AIProviderError("not_configured", { provider: "openai" });
      const { body, warnings, wrapped } = buildOpenAIRequest(call);
      const reply = await postJson({
        provider: "openai",
        url: `${baseUrl}/responses`,
        headers: { authorization: `Bearer ${config.apiKey}`, ...(config.organization ? { "openai-organization": config.organization } : {}) },
        body,
        signal: call.signal,
        fetch: fetchImpl,
      });
      if (reply.status < 200 || reply.status >= 300) throw openAIError(reply);
      const result = parseOpenAIResponse(call, reply.body, wrapped);
      return { ...result, warnings: [...warnings, ...result.warnings] };
    },
  };
}
