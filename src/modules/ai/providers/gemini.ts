// Google Gemini con generateContent (POST /v1beta/models/{modelo}:generateContent), llave en `x-goog-api-key`.
// - Gemini 3 exige devolver la firma de pensamiento (`thoughtSignature`) de sus llamadas a funciones en el turno
//   siguiente: se guarda en el estado del proveedor y vuelve tal cual. Para llamadas que hizo otro proveedor se usa
//   el valor que Google documenta para saltar esa validación.
// - Cada respuesta de función lleva el `id` de su llamada, y todas van juntas en un solo turno del usuario.
// - JSON con esquema: `responseMimeType` + `responseSchema` (subconjunto de OpenAPI). Si la API ya no los acepta, se
//   repite con `responseFormat`, la forma nueva.
import type { AIFinishReason, AIToolCall, AIWarning } from "@/types/ai";
import { geminiModel } from "../ai.catalog";
import { AIProviderError } from "../ai.errors";
import { errorMessageOf, isRecord, numberOf, parseDuration, parseRetryAfter, postJson, type FetchLike, type JsonReply } from "../ai.http";
import { cleanSchema, objectRoot, toGeminiSchema, unwrapJson } from "../ai.schema";
import type { AIContentPart, AIMessage, AIToolChoice, ModelProvider, ProviderCall, ProviderResult } from "../ai.types";

export interface GeminiConfig {
  apiKey?: string;
  /** Por defecto https://generativelanguage.googleapis.com */
  baseUrl?: string;
  apiVersion?: string;
  models: { fast: string; smart: string };
  fetch?: FetchLike;
}

type Part = Record<string, unknown>;
export interface GeminiContent {
  role: "user" | "model";
  parts: Part[];
}

/** Firma que Google acepta para llamadas a funciones que no generó Gemini (conversación que viene de otro modelo). */
export const SKIP_THOUGHT_SIGNATURE = "skip_thought_signature_validator";
/** Prefijo de los ids que inventa el router cuando un modelo viejo no devuelve id en sus llamadas. */
const GENERATED_ID = "gemini-sin-id-";

/** Cómo se pide el JSON con esquema: los campos de siempre o `responseFormat`. */
export type GeminiSchemaStyle = "response_schema" | "response_format";

function userParts(content: string | AIContentPart[]): Part[] {
  if (typeof content === "string") return content ? [{ text: content }] : [];
  return content.map((part) => (part.type === "text" ? { text: part.text } : { inlineData: { mimeType: part.mediaType, data: part.data } }));
}

/** Resultado de una función como objeto (lo que pide `functionResponse.response`). */
function responseObject(content: string, isError?: boolean): Record<string, unknown> {
  try {
    const parsed = JSON.parse(content) as unknown;
    if (isRecord(parsed)) return isError ? { error: parsed } : parsed;
  } catch {
    // Texto: va dentro de `result` o `error`.
  }
  return isError ? { error: content } : { result: content };
}

export function toGeminiContents(messages: readonly AIMessage[]): GeminiContent[] {
  const out: GeminiContent[] = [];
  const push = (role: GeminiContent["role"], parts: Part[]) => {
    if (parts.length === 0) return;
    const last = out.at(-1);
    if (last?.role === role) last.parts.push(...parts);
    else out.push({ role, parts: [...parts] });
  };
  for (const message of messages) {
    if (message.role === "user") {
      push("user", userParts(message.content));
    } else if (message.role === "tool") {
      const id = message.toolCallId.startsWith(GENERATED_ID) ? null : message.toolCallId;
      push("user", [{ functionResponse: { ...(id ? { id } : {}), name: message.name, response: responseObject(message.content, message.isError) } }]);
    } else {
      const replay = message.state?.provider === "gemini" && isRecord(message.state.data) ? message.state.data.parts : null;
      if (Array.isArray(replay)) {
        push("model", replay.filter(isRecord));
        continue;
      }
      const parts: Part[] = message.content ? [{ text: message.content }] : [];
      (message.toolCalls ?? []).forEach((call, index) => {
        const id = call.id.startsWith(GENERATED_ID) ? null : call.id;
        parts.push({
          functionCall: { ...(id ? { id } : {}), name: call.name, args: call.arguments },
          ...(index === 0 ? { thoughtSignature: SKIP_THOUGHT_SIGNATURE } : {}),
        });
      });
      push("model", parts);
    }
  }
  return out;
}

function toolConfigOf(choice: AIToolChoice): Record<string, unknown> {
  if (choice === "auto") return { functionCallingConfig: { mode: "AUTO" } };
  if (choice === "none") return { functionCallingConfig: { mode: "NONE" } };
  if (choice === "required") return { functionCallingConfig: { mode: "ANY" } };
  return { functionCallingConfig: { mode: "ANY", allowedFunctionNames: [choice.name] } };
}

export function buildGeminiRequest(call: ProviderCall, style: GeminiSchemaStyle = "response_schema"): { body: Part; warnings: AIWarning[]; wrapped: boolean } {
  const { request, model } = call;
  const body: Part = { contents: toGeminiContents(request.messages) };
  const generationConfig: Part = { maxOutputTokens: call.maxOutputTokens };
  if (request.stop?.length && model.capabilities.stop) generationConfig.stopSequences = request.stop.slice(0, 5);
  if (request.reasoning && model.capabilities.reasoningEffort) generationConfig.thinkingConfig = { thinkingLevel: request.reasoning };

  let wrapped = false;
  const format = request.responseFormat;
  if (format?.type === "json") {
    if (format.schema) {
      const root = objectRoot(cleanSchema(format.schema));
      wrapped = root.wrapped;
      if (style === "response_schema") {
        generationConfig.responseMimeType = "application/json";
        generationConfig.responseSchema = toGeminiSchema(root.schema, { ordered: true });
      } else {
        generationConfig.responseFormat = { text: { mimeType: "application/json", schema: root.schema } };
      }
    } else {
      generationConfig.responseMimeType = "application/json";
    }
  }
  body.generationConfig = generationConfig;
  if (request.system?.trim()) body.systemInstruction = { parts: [{ text: request.system.trim() }] };

  if (request.tools?.length) {
    body.tools = [
      {
        functionDeclarations: request.tools.map((tool) => {
          const parameters = toGeminiSchema(tool.parameters);
          const hasParameters = isRecord(parameters.properties) && Object.keys(parameters.properties).length > 0;
          return { name: tool.name, description: tool.description, ...(hasParameters ? { parameters } : {}) };
        }),
      },
    ];
    if (request.toolChoice) body.toolConfig = toolConfigOf(request.toolChoice);
  }
  return { body, warnings: [], wrapped };
}

const BLOCKED = new Set(["SAFETY", "RECITATION", "BLOCKLIST", "PROHIBITED_CONTENT", "SPII", "IMAGE_SAFETY", "LANGUAGE"]);

export function parseGeminiResponse(call: ProviderCall, body: unknown, wrapped: boolean): ProviderResult {
  if (!isRecord(body)) throw new AIProviderError("bad_response", { provider: "gemini", detail: "Respuesta que no es un objeto." });
  const meta = isRecord(body.usageMetadata) ? body.usageMetadata : {};
  const thoughts = numberOf(meta.thoughtsTokenCount);
  const inputTokens = numberOf(meta.promptTokenCount) + numberOf(meta.toolUsePromptTokenCount);
  const outputTokens = numberOf(meta.candidatesTokenCount) + thoughts;
  const usage = {
    inputTokens,
    outputTokens,
    totalTokens: numberOf(meta.totalTokenCount) || inputTokens + outputTokens,
    cachedInputTokens: numberOf(meta.cachedContentTokenCount),
    reasoningTokens: thoughts,
  };
  const model = typeof body.modelVersion === "string" ? body.modelVersion : call.model.id;

  const candidate = Array.isArray(body.candidates) ? body.candidates.find(isRecord) : undefined;
  if (!candidate) {
    // Pedido bloqueado por las políticas de Google: no hay candidatos.
    const feedback = isRecord(body.promptFeedback) ? body.promptFeedback : {};
    if (typeof feedback.blockReason === "string") {
      return { model, text: "", toolCalls: [], finishReason: "content_filter", usage, state: null, warnings: [] };
    }
    throw new AIProviderError("bad_response", { provider: "gemini", detail: "Respuesta sin candidatos." });
  }

  const content = isRecord(candidate.content) ? candidate.content : {};
  const parts = Array.isArray(content.parts) ? content.parts.filter(isRecord) : [];
  let text = "";
  const toolCalls: AIToolCall[] = [];
  for (const part of parts) {
    if (part.thought === true) continue;
    if (typeof part.text === "string") text += part.text;
    if (isRecord(part.functionCall)) {
      const fc = part.functionCall;
      toolCalls.push({
        id: typeof fc.id === "string" && fc.id ? fc.id : `${GENERATED_ID}${toolCalls.length + 1}`,
        name: String(fc.name ?? ""),
        arguments: isRecord(fc.args) ? fc.args : {},
      });
    }
  }

  const reason = typeof candidate.finishReason === "string" ? candidate.finishReason : "STOP";
  if (reason === "MALFORMED_FUNCTION_CALL" || reason === "UNEXPECTED_TOOL_CALL") {
    throw new AIProviderError("bad_response", { provider: "gemini", detail: `Llamada a función inválida (${reason}).` });
  }
  let finishReason: AIFinishReason;
  if (reason === "STOP") finishReason = toolCalls.length ? "tool_calls" : "stop";
  else if (reason === "MAX_TOKENS") finishReason = "length";
  else if (BLOCKED.has(reason)) finishReason = "content_filter";
  else finishReason = "other";

  return {
    model,
    text,
    ...(wrapped && finishReason === "stop" ? { json: unwrapJson(text) } : {}),
    toolCalls,
    finishReason,
    usage,
    state: toolCalls.length ? { provider: "gemini", model, data: { parts } } : null,
    warnings: [],
  };
}

/**
 * ¿Es una cuota que no vuelve en segundos (por día, créditos prepagados, tope de gasto)? Manda el detalle de Google
 * (QuotaFailure, RetryInfo): el 429 por minuto también dice "check your plan and billing details" en el mensaje.
 */
function isLongQuota(details: Record<string, unknown>[], detail: string, hasRetryInfo: boolean): boolean {
  const ids = details.flatMap((item) =>
    Array.isArray(item.violations)
      ? item.violations.filter(isRecord).map((violation) => `${String(violation.quotaId ?? "")} ${String(violation.quotaMetric ?? "")}`)
      : [],
  );
  if (ids.some((id) => /PerDay|per_day|daily/i.test(id))) return true;
  if (ids.some((id) => /PerMinute|per_minute|PerSecond|per_second/i.test(id)) || hasRetryInfo) return false;
  return /per day|daily|prepaid|credits|spend(ing)? (cap|limit)/i.test(detail);
}

export function geminiError(reply: JsonReply): AIProviderError {
  const error = isRecord(reply.body) && isRecord(reply.body.error) ? reply.body.error : {};
  const status = typeof error.status === "string" ? error.status : "";
  const details = Array.isArray(error.details) ? error.details.filter(isRecord) : [];
  const detail = errorMessageOf(reply.body, reply.raw);
  const base = { provider: "gemini" as const, httpStatus: reply.status, detail };
  const reason = details.map((item) => item.reason).find((value): value is string => typeof value === "string") ?? "";
  const retryInfo = details.find((item) => typeof item["@type"] === "string" && item["@type"].endsWith("RetryInfo"));
  const retryAfterMs =
    parseRetryAfter(reply.headers.get("retry-after")) ?? parseDuration(typeof retryInfo?.retryDelay === "string" ? retryInfo.retryDelay : null);
  const code = reply.status;

  if (code === 400) {
    // Una llave inválida llega como 400 INVALID_ARGUMENT; un país sin acceso, como FAILED_PRECONDITION.
    if (reason === "API_KEY_INVALID" || /api key not valid|api key expired|invalid api key/i.test(detail)) return new AIProviderError("auth_failed", base);
    if (status === "FAILED_PRECONDITION") return new AIProviderError("auth_failed", base);
    if (/token count|exceeds the maximum|too long|context length/i.test(detail)) return new AIProviderError("context_too_long", base);
    return new AIProviderError("invalid_request", base);
  }
  if (code === 401 || code === 403) return new AIProviderError("auth_failed", base);
  if (code === 402) return new AIProviderError("quota_exceeded", base);
  if (code === 404) return new AIProviderError("model_not_found", base);
  if (code === 408 || code === 504) return new AIProviderError("timeout", base);
  if (code === 429) {
    return isLongQuota(details, detail, retryInfo !== undefined)
      ? new AIProviderError("quota_exceeded", base)
      : new AIProviderError("rate_limited", { ...base, retryAfterMs });
  }
  if (code >= 500) {
    // Google documenta que una entrada demasiado larga puede llegar como 500 INTERNAL.
    if (/too long|context length|token count/i.test(detail)) return new AIProviderError("context_too_long", base);
    return new AIProviderError("provider_unavailable", { ...base, retryAfterMs });
  }
  return new AIProviderError("invalid_request", base);
}

export function geminiProvider(config: GeminiConfig): ModelProvider {
  const baseUrl = (config.baseUrl ?? "https://generativelanguage.googleapis.com").replace(/\/+$/, "");
  const version = config.apiVersion ?? "v1beta";
  const specs = [geminiModel(config.models.fast, "fast"), geminiModel(config.models.smart, "smart")];
  const fetchImpl: FetchLike = config.fetch ?? ((input, init) => fetch(input, init));
  return {
    id: "gemini",
    isConfigured: () => Boolean(config.apiKey),
    models: () => specs,
    async generate(call) {
      if (!config.apiKey) throw new AIProviderError("not_configured", { provider: "gemini" });
      const wantsSchema = call.request.responseFormat?.type === "json" && Boolean(call.request.responseFormat.schema);
      let style: GeminiSchemaStyle = "response_schema";
      for (let pass = 0; ; pass++) {
        const { body, warnings, wrapped } = buildGeminiRequest(call, style);
        const reply = await postJson({
          provider: "gemini",
          url: `${baseUrl}/${version}/models/${encodeURIComponent(call.model.id)}:generateContent`,
          headers: { "x-goog-api-key": config.apiKey },
          body,
          signal: call.signal,
          fetch: fetchImpl,
        });
        if (reply.status >= 200 && reply.status < 300) {
          const result = parseGeminiResponse(call, reply.body, wrapped);
          return { ...result, warnings: [...warnings, ...result.warnings] };
        }
        const error = geminiError(reply);
        // Si la API ya no acepta responseMimeType/responseSchema, se repite con responseFormat.
        if (
          pass === 0 &&
          wantsSchema &&
          error.code === "invalid_request" &&
          /response_?schema|response_?mime_?type|responseSchema|responseMimeType/i.test(error.detail)
        ) {
          style = "response_format";
          continue;
        }
        throw error;
      }
    },
  };
}
