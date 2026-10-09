import { describe, expect, it } from "vitest";
import { anthropicModel, anthropicSupportsForcedTools, geminiModel, openAIModel, xaiModel } from "@/modules/ai/ai.catalog";
import { AIProviderError } from "@/modules/ai/ai.errors";
import { AttemptTimeout, parseDuration, parseRetryAfter } from "@/modules/ai/ai.http";
import { anthropicProvider } from "@/modules/ai/providers/anthropic";
import { SKIP_THOUGHT_SIGNATURE, geminiProvider } from "@/modules/ai/providers/gemini";
import { openAIProvider } from "@/modules/ai/providers/openai";
import { xaiProvider } from "@/modules/ai/providers/openai-compatible";
import type { AIMessage, ProviderCall } from "@/modules/ai/ai.types";
import { callFor, fakeFetch, hangingFetch } from "../support/ai-fakes";

// Router de IA: cada adaptador arma el pedido de la API oficial de su proveedor y traduce su respuesta y sus errores a
// la forma normalizada. Las respuestas de ejemplo siguen la documentación de cada API (octubre de 2026).

const MODELS = { fast: "rapido", smart: "capaz" };
const IMAGE = { type: "image" as const, mediaType: "image/png" as const, data: "iVBORw0KGgo=" };
const PDF = { type: "file" as const, mediaType: "application/pdf" as const, data: "JVBERi0=", filename: "permiso.pdf" };
const WEATHER_TOOL = {
  name: "clima",
  description: "El clima de una ciudad",
  parameters: { type: "object", properties: { ciudad: { type: "string" } }, required: ["ciudad"] },
};
const REPORT_SCHEMA = { type: "object", properties: { titular: { type: "string", maxLength: 90 } }, required: ["titular"] };

/** Una conversación con una ronda de herramientas hecha por otro proveedor. */
const TOOL_ROUND: AIMessage[] = [
  { role: "user", content: "¿Cómo está el clima en Caracas?" },
  { role: "assistant", content: "Lo reviso.", toolCalls: [{ id: "call_1", name: "clima", arguments: { ciudad: "Caracas" } }] },
  { role: "tool", toolCallId: "call_1", name: "clima", content: '{"grados":29}' },
];

async function expectAIError(promise: Promise<unknown>, code: string, extra: Partial<AIProviderError> = {}) {
  await expect(promise).rejects.toBeInstanceOf(AIProviderError);
  await expect(promise).rejects.toMatchObject({ code, ...extra });
}

describe("router de IA: utilidades HTTP", () => {
  it("lee Retry-After en segundos o fecha y las duraciones al estilo Go", () => {
    expect(parseRetryAfter("7")).toBe(7000);
    expect(parseRetryAfter(new Date(10_000 + 3000).toUTCString(), 10_000)).toBeLessThanOrEqual(3000);
    expect(parseRetryAfter(null)).toBeNull();
    expect(parseDuration("6m0s")).toBe(360_000);
    expect(parseDuration("1.5s")).toBe(1500);
    expect(parseDuration("250ms")).toBe(250);
    expect(parseDuration("x")).toBeNull();
  });

  it("Claude Opus/Sonnet 5.5, Fable y Mythos no permiten forzar herramientas; Haiku y los anteriores sí", () => {
    expect(anthropicSupportsForcedTools("claude-sonnet-5-5")).toBe(false);
    expect(anthropicSupportsForcedTools("claude-opus-5-5")).toBe(false);
    expect(anthropicSupportsForcedTools("claude-fable-5-1")).toBe(false);
    expect(anthropicSupportsForcedTools("claude-mythos-5-1")).toBe(false);
    expect(anthropicSupportsForcedTools("claude-haiku-4-5-20251001")).toBe(true);
    expect(anthropicSupportsForcedTools("claude-sonnet-4-20250514")).toBe(true);
    expect(anthropicSupportsForcedTools("claude-opus-4-1-20250805")).toBe(true);
    expect(anthropicSupportsForcedTools("claude-3-5-sonnet-20241022")).toBe(true);
  });
});

describe("router de IA: OpenAI (Responses API)", () => {
  const spec = openAIModel("gpt-6-luna", "fast");

  it("arma el pedido: instrucciones, imagen, PDF, herramientas, JSON con esquema y razonamiento", async () => {
    const { fetch, sent } = fakeFetch([{ body: { status: "completed", model: "gpt-6-luna", output: [] } }]);
    const provider = openAIProvider({ apiKey: "sk-prueba", models: MODELS, fetch });
    await provider.generate(
      callFor(spec, {
        system: "Eres Omni.",
        messages: [{ role: "user", content: [{ type: "text", text: "Lee esto" }, IMAGE, PDF] }],
        tools: [WEATHER_TOOL],
        toolChoice: { name: "clima" },
        responseFormat: { type: "json", schema: REPORT_SCHEMA, name: "informe final" },
        reasoning: "low",
        temperature: 0.2,
      }),
    );
    const [request] = sent;
    expect(request.url).toBe("https://api.openai.com/v1/responses");
    expect(request.headers.authorization).toBe("Bearer sk-prueba");
    expect(request.body).toMatchObject({
      model: "gpt-6-luna",
      instructions: "Eres Omni.",
      max_output_tokens: 1000,
      store: false,
      reasoning: { effort: "low" },
      include: ["reasoning.encrypted_content"],
      tool_choice: { type: "function", name: "clima" },
      tools: [{ type: "function", name: "clima", description: "El clima de una ciudad", parameters: WEATHER_TOOL.parameters }],
      text: { format: { type: "json_schema", name: "informe_final", schema: REPORT_SCHEMA, strict: false } },
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: "Lee esto" },
            { type: "input_image", image_url: "data:image/png;base64,iVBORw0KGgo=", detail: "auto" },
            { type: "input_file", filename: "permiso.pdf", file_data: "data:application/pdf;base64,JVBERi0=" },
          ],
        },
      ],
    });
    // GPT-6 no acepta temperatura.
    expect(request.body.temperature).toBeUndefined();
  });

  it("una ronda de otro proveedor va como llamada y resultado de función", async () => {
    const { fetch, sent } = fakeFetch([{ body: { status: "completed", output: [] } }]);
    await openAIProvider({ apiKey: "k", models: MODELS, fetch }).generate(callFor(spec, { messages: TOOL_ROUND }));
    expect(sent[0].body.input).toEqual([
      { role: "user", content: "¿Cómo está el clima en Caracas?" },
      { role: "assistant", content: "Lo reviso." },
      { type: "function_call", call_id: "call_1", name: "clima", arguments: '{"ciudad":"Caracas"}' },
      { type: "function_call_output", call_id: "call_1", output: '{"grados":29}' },
    ]);
  });

  it("lee texto, llamadas, uso y guarda su salida para devolverla con el razonamiento cifrado", async () => {
    const output = [
      { id: "rs_1", type: "reasoning", summary: [], encrypted_content: "gAAAAB..." },
      { id: "msg_1", type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: "Voy a revisar.", annotations: [] }] },
      { id: "fc_1", type: "function_call", call_id: "call_abc", name: "clima", arguments: '{"ciudad":"Caracas"}', status: "completed" },
    ];
    const { fetch, sent } = fakeFetch([
      {
        body: {
          id: "resp_1",
          object: "response",
          status: "completed",
          model: "gpt-6-luna-2026-09-22",
          output,
          usage: { input_tokens: 120, input_tokens_details: { cached_tokens: 100 }, output_tokens: 60, output_tokens_details: { reasoning_tokens: 40 }, total_tokens: 180 },
        },
      },
      { body: { status: "completed", output: [] } },
    ]);
    const provider = openAIProvider({ apiKey: "k", models: MODELS, fetch });
    const first = await provider.generate(callFor(spec, { tools: [WEATHER_TOOL] }));
    expect(first).toMatchObject({
      model: "gpt-6-luna-2026-09-22",
      text: "Voy a revisar.",
      toolCalls: [{ id: "call_abc", name: "clima", arguments: { ciudad: "Caracas" } }],
      finishReason: "tool_calls",
      usage: { inputTokens: 120, outputTokens: 60, totalTokens: 180, cachedInputTokens: 100, reasoningTokens: 40 },
      state: { provider: "openai", data: { items: output } },
    });
    // El turno siguiente devuelve esos mismos elementos, tal cual.
    await provider.generate(
      callFor(spec, {
        tools: [WEATHER_TOOL],
        messages: [
          { role: "user", content: "Clima" },
          { role: "assistant", content: first.text, toolCalls: first.toolCalls, state: first.state },
          { role: "tool", toolCallId: "call_abc", name: "clima", content: "29 grados" },
        ],
      }),
    );
    expect(sent[1].body.input).toEqual([
      { role: "user", content: "Clima" },
      ...output,
      { type: "function_call_output", call_id: "call_abc", output: "29 grados" },
    ]);
  });

  it("respuesta incompleta, rechazo y falla dentro de la respuesta", async () => {
    const { fetch } = fakeFetch([
      { body: { status: "incomplete", incomplete_details: { reason: "max_output_tokens" }, output: [] } },
      { body: { status: "completed", output: [{ type: "message", content: [{ type: "refusal", refusal: "No puedo ayudar con eso." }] }] } },
      { body: { status: "failed", error: { code: "server_error", message: "boom" }, output: [] } },
    ]);
    const provider = openAIProvider({ apiKey: "k", models: MODELS, fetch });
    await expect(provider.generate(callFor(spec))).resolves.toMatchObject({ finishReason: "length" });
    await expect(provider.generate(callFor(spec))).resolves.toMatchObject({ finishReason: "content_filter", text: "No puedo ayudar con eso." });
    await expectAIError(provider.generate(callFor(spec)), "provider_unavailable");
  });

  it("errores: cuota, límite de tasa con espera, contexto, llave, saturación y red", async () => {
    const { fetch } = fakeFetch([
      { status: 429, body: { error: { message: "You exceeded your current quota", type: "insufficient_quota", code: "insufficient_quota" } } },
      { status: 429, body: { error: { message: "Rate limit reached for requests", type: "requests" } }, headers: { "retry-after": "2" } },
      {
        status: 429,
        body: { error: { message: "Rate limit reached for tokens" } },
        headers: { "x-ratelimit-remaining-tokens": "0", "x-ratelimit-reset-tokens": "6m0s" },
      },
      { status: 400, body: { error: { message: "This model's maximum context length is 1050000 tokens", code: "context_length_exceeded" } } },
      { status: 401, body: { error: { message: "Incorrect API key provided" } } },
      { status: 503, body: { error: { message: "Overloaded", type: "service_unavailable_error", code: "server_is_overloaded" } }, headers: { "retry-after": "5" } },
      { status: 404, body: { error: { message: "The model `gpt-9` does not exist" } } },
      new TypeError("fetch failed"),
    ]);
    const provider = openAIProvider({ apiKey: "k", models: MODELS, fetch });
    await expectAIError(provider.generate(callFor(spec)), "quota_exceeded", { provider: "openai", httpStatus: 429 });
    await expectAIError(provider.generate(callFor(spec)), "rate_limited", { retryAfterMs: 2000 });
    await expectAIError(provider.generate(callFor(spec)), "rate_limited", { retryAfterMs: 360_000 });
    await expectAIError(provider.generate(callFor(spec)), "context_too_long");
    await expectAIError(provider.generate(callFor(spec)), "auth_failed");
    await expectAIError(provider.generate(callFor(spec)), "provider_unavailable", { retryAfterMs: 5000 });
    await expectAIError(provider.generate(callFor(spec)), "model_not_found");
    await expectAIError(provider.generate(callFor(spec)), "network_error");
  });

  it("sin llave no llama; el tiempo agotado y la cancelación se distinguen", async () => {
    await expectAIError(openAIProvider({ models: MODELS }).generate(callFor(spec)), "not_configured");
    const provider = openAIProvider({ apiKey: "k", models: MODELS, fetch: hangingFetch });
    const timed = new AbortController();
    const timedCall: ProviderCall = { ...callFor(spec), signal: timed.signal };
    const pending = provider.generate(timedCall);
    timed.abort(new AttemptTimeout(30_000));
    await expectAIError(pending, "timeout");
    const canceled = new AbortController();
    const canceledCall: ProviderCall = { ...callFor(spec), signal: canceled.signal };
    const pendingCanceled = provider.generate(canceledCall);
    canceled.abort(new Error("La persona cerró la app."));
    await expectAIError(pendingCanceled, "aborted");
  });
});

describe("router de IA: Anthropic (Messages API)", () => {
  const haiku = anthropicModel("claude-haiku-4-5-20251001", "fast");
  const sonnet = anthropicModel("claude-sonnet-5-5", "smart");
  const reply = (content: unknown[], extra: Record<string, unknown> = {}) => ({
    body: {
      id: "msg_01",
      type: "message",
      role: "assistant",
      model: "claude-sonnet-5-5",
      content,
      stop_reason: "end_turn",
      usage: { input_tokens: 50, cache_read_input_tokens: 1000, cache_creation_input_tokens: 0, output_tokens: 20 },
      ...extra,
    },
  });

  it("Haiku: el JSON sale de una herramienta forzada (el camino de siempre)", async () => {
    const { fetch, sent } = fakeFetch([reply([{ type: "tool_use", id: "toolu_1", name: "registrar_informe", input: { titular: "Gastas menos" } }], { stop_reason: "tool_use" })]);
    const provider = anthropicProvider({ apiKey: "sk-ant", models: MODELS, fetch });
    const result = await provider.generate(
      callFor(haiku, { system: "Eres el analista.", responseFormat: { type: "json", schema: REPORT_SCHEMA, name: "registrar_informe" } }),
    );
    const [request] = sent;
    expect(request.url).toBe("https://api.anthropic.com/v1/messages");
    expect(request.headers).toMatchObject({ "x-api-key": "sk-ant", "anthropic-version": "2023-06-01" });
    expect(request.body).toMatchObject({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1000,
      system: [{ type: "text", text: "Eres el analista.", cache_control: { type: "ephemeral" } }],
      tools: [{ name: "registrar_informe", input_schema: REPORT_SCHEMA }],
      tool_choice: { type: "tool", name: "registrar_informe" },
    });
    expect(request.body.output_config).toBeUndefined();
    expect(result).toMatchObject({ json: { titular: "Gastas menos" }, text: '{"titular":"Gastas menos"}', toolCalls: [], finishReason: "stop" });
  });

  it("Sonnet 5.5: el JSON va con salida estructurada, sin forzar herramientas", async () => {
    const { fetch, sent } = fakeFetch([reply([{ type: "text", text: '{"titular":"Gastas menos"}' }])]);
    const result = await anthropicProvider({ apiKey: "k", models: MODELS, fetch }).generate(
      callFor(sonnet, { responseFormat: { type: "json", schema: REPORT_SCHEMA, name: "registrar_informe" } }),
    );
    expect(sent[0].body.tool_choice).toBeUndefined();
    expect(sent[0].body.output_config).toEqual({
      format: {
        type: "json_schema",
        schema: { type: "object", properties: { titular: { type: "string", description: "(máximo 90 caracteres)" } }, required: ["titular"], additionalProperties: false },
      },
    });
    expect(result).toMatchObject({ text: '{"titular":"Gastas menos"}', finishReason: "stop", usage: { inputTokens: 1050, cachedInputTokens: 1000, outputTokens: 20 } });
  });

  it("si un modelo deja de aceptar la herramienta forzada, repite con salida estructurada", async () => {
    const { fetch, sent } = fakeFetch([
      { status: 400, body: { type: "error", error: { type: "invalid_request_error", message: "tool_choice forced tool use is not supported for this model" } } },
      reply([{ type: "text", text: '{"titular":"Hola"}' }]),
    ]);
    const result = await anthropicProvider({ apiKey: "k", models: MODELS, fetch }).generate(callFor(haiku, { responseFormat: { type: "json", schema: REPORT_SCHEMA } }));
    expect(sent).toHaveLength(2);
    expect(sent[1].body.output_config).toBeDefined();
    expect(result.text).toBe('{"titular":"Hola"}');
  });

  it("obligar una herramienta en Sonnet 5.5 se pide en las instrucciones (la API lo rechaza)", async () => {
    const { fetch, sent } = fakeFetch([reply([{ type: "tool_use", id: "toolu_9", name: "clima", input: { ciudad: "Caracas" } }], { stop_reason: "tool_use" })]);
    const result = await anthropicProvider({ apiKey: "k", models: MODELS, fetch }).generate(
      callFor(sonnet, { system: "Eres Omni.", tools: [WEATHER_TOOL], toolChoice: "required" }),
    );
    expect(sent[0].body.tool_choice).toEqual({ type: "auto" });
    expect(sent[0].body.system).toEqual([
      { type: "text", text: "Eres Omni.", cache_control: { type: "ephemeral" } },
      { type: "text", text: "Responde usando una de las herramientas disponibles." },
    ]);
    expect(result).toMatchObject({
      warnings: ["tool_choice_relaxed"],
      finishReason: "tool_calls",
      toolCalls: [{ id: "toolu_9", name: "clima", arguments: { ciudad: "Caracas" } }],
      state: { provider: "anthropic" },
    });
  });

  it("instrucciones por partes: punto de caché solo en las partes fijas", async () => {
    const { fetch, sent } = fakeFetch([reply([{ type: "text", text: "Hola" }])]);
    await anthropicProvider({ apiKey: "k", models: MODELS, fetch }).generate(
      callFor(sonnet, { system: [{ text: "Reglas fijas de Omni.", cache: true }, { text: "Ahora son las 10:00." }] }),
    );
    expect(sent[0].body.system).toEqual([
      { type: "text", text: "Reglas fijas de Omni.", cache_control: { type: "ephemeral" } },
      { type: "text", text: "Ahora son las 10:00." },
    ]);
  });

  it("turnos alternados: resultados de herramientas al inicio del turno, imagen y PDF como bloques", async () => {
    const { fetch, sent } = fakeFetch([reply([{ type: "text", text: "Hace calor." }])]);
    await anthropicProvider({ apiKey: "k", models: MODELS, fetch }).generate(
      callFor(haiku, { messages: [...TOOL_ROUND, { role: "user", content: [{ type: "text", text: "¿Y esto?" }, IMAGE, PDF] }] }),
    );
    expect(sent[0].body.messages).toEqual([
      { role: "user", content: [{ type: "text", text: "¿Cómo está el clima en Caracas?" }] },
      {
        role: "assistant",
        content: [
          { type: "text", text: "Lo reviso." },
          { type: "tool_use", id: "call_1", name: "clima", input: { ciudad: "Caracas" } },
        ],
      },
      {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "call_1", content: '{"grados":29}' },
          { type: "text", text: "¿Y esto?" },
          { type: "image", source: { type: "base64", media_type: "image/png", data: "iVBORw0KGgo=" } },
          { type: "document", source: { type: "base64", media_type: "application/pdf", data: "JVBERi0=" }, title: "permiso.pdf" },
        ],
      },
    ]);
  });

  it("motivos de fin: tope de tokens, rechazo y ventana de contexto", async () => {
    const { fetch } = fakeFetch([
      reply([{ type: "text", text: "Hasta aquí" }], { stop_reason: "max_tokens" }),
      reply([{ type: "text", text: "" }], { stop_reason: "refusal" }),
      reply([{ type: "text", text: "..." }], { stop_reason: "model_context_window_exceeded" }),
    ]);
    const provider = anthropicProvider({ apiKey: "k", models: MODELS, fetch });
    await expect(provider.generate(callFor(sonnet))).resolves.toMatchObject({ finishReason: "length" });
    await expect(provider.generate(callFor(sonnet))).resolves.toMatchObject({ finishReason: "content_filter" });
    await expect(provider.generate(callFor(sonnet))).resolves.toMatchObject({ finishReason: "length" });
  });

  it("errores: saturación (529), límite de tasa, tope de gasto, saldo, contexto y modelo", async () => {
    const error = (status: number, type: string, message: string, extra: Record<string, unknown> = {}) => ({
      status,
      body: { type: "error", error: { type, message, ...extra }, request_id: "req_1" },
    });
    const { fetch } = fakeFetch([
      error(529, "overloaded_error", "Overloaded"),
      { ...error(429, "rate_limit_error", "Number of request tokens has exceeded your per-minute rate limit"), headers: { "retry-after": "7" } },
      error(429, "rate_limit_error", "You have reached your monthly spend limit", { details: { error_code: "enforced_spend_limit_reached" } }),
      error(400, "invalid_request_error", "Your credit balance is too low to access the Anthropic API."),
      error(402, "billing_error", "There is an issue with your billing."),
      error(400, "invalid_request_error", "prompt is too long: 1200000 tokens > 1000000 maximum"),
      error(404, "not_found_error", "model: claude-x"),
      error(504, "timeout_error", "Request timed out"),
      error(400, "invalid_request_error", "messages: roles must alternate"),
    ]);
    const provider = anthropicProvider({ apiKey: "k", models: MODELS, fetch });
    await expectAIError(provider.generate(callFor(sonnet)), "provider_unavailable", { httpStatus: 529 });
    await expectAIError(provider.generate(callFor(sonnet)), "rate_limited", { retryAfterMs: 7000 });
    await expectAIError(provider.generate(callFor(sonnet)), "quota_exceeded");
    await expectAIError(provider.generate(callFor(sonnet)), "quota_exceeded");
    await expectAIError(provider.generate(callFor(sonnet)), "quota_exceeded");
    await expectAIError(provider.generate(callFor(sonnet)), "context_too_long");
    await expectAIError(provider.generate(callFor(sonnet)), "model_not_found");
    await expectAIError(provider.generate(callFor(sonnet)), "timeout");
    await expectAIError(provider.generate(callFor(sonnet)), "invalid_request");
  });
});

describe("router de IA: Gemini (generateContent)", () => {
  const flash = geminiModel("gemini-3.8-flash", "smart");

  it("arma el pedido: roles user/model, sistema, imágenes y PDF, JSON con esquema OpenAPI y herramientas", async () => {
    const { fetch, sent } = fakeFetch([{ body: { candidates: [{ content: { role: "model", parts: [{ text: "{}" }] }, finishReason: "STOP" }] } }]);
    await geminiProvider({ apiKey: "AIza-prueba", models: MODELS, fetch }).generate(
      callFor(flash, {
        system: "Eres Omni.",
        messages: [{ role: "user", content: [{ type: "text", text: "Lee" }, IMAGE, PDF] }],
        stop: ["FIN"],
        reasoning: "low",
        temperature: 0.4,
        tools: [WEATHER_TOOL],
        toolChoice: { name: "clima" },
        responseFormat: { type: "json", schema: REPORT_SCHEMA },
      }),
    );
    const [request] = sent;
    expect(request.url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent");
    expect(request.headers["x-goog-api-key"]).toBe("AIza-prueba");
    expect(request.body).toMatchObject({
      systemInstruction: { parts: [{ text: "Eres Omni." }] },
      contents: [
        {
          role: "user",
          parts: [
            { text: "Lee" },
            { inlineData: { mimeType: "image/png", data: "iVBORw0KGgo=" } },
            { inlineData: { mimeType: "application/pdf", data: "JVBERi0=" } },
          ],
        },
      ],
      generationConfig: {
        maxOutputTokens: 1000,
        stopSequences: ["FIN"],
        thinkingConfig: { thinkingLevel: "low" },
        responseMimeType: "application/json",
        responseSchema: { type: "object", properties: { titular: { type: "string", description: "(máximo 90 caracteres)" } }, required: ["titular"], propertyOrdering: ["titular"] },
      },
      tools: [{ functionDeclarations: [{ name: "clima", description: "El clima de una ciudad", parameters: { type: "object", properties: { ciudad: { type: "string" } }, required: ["ciudad"] } }] }],
      toolConfig: { functionCallingConfig: { mode: "ANY", allowedFunctionNames: ["clima"] } },
    });
    // Gemini 3.6+ ya no acepta temperatura.
    expect((request.body.generationConfig as Record<string, unknown>).temperature).toBeUndefined();
  });

  it("llamadas de otro proveedor: firma para saltar la validación y respuestas con su id, juntas", async () => {
    const { fetch, sent } = fakeFetch([{ body: { candidates: [{ content: { parts: [{ text: "29 grados." }] }, finishReason: "STOP" }] } }]);
    await geminiProvider({ apiKey: "k", models: MODELS, fetch }).generate(callFor(flash, { messages: TOOL_ROUND }));
    expect(sent[0].body.contents).toEqual([
      { role: "user", parts: [{ text: "¿Cómo está el clima en Caracas?" }] },
      {
        role: "model",
        parts: [{ text: "Lo reviso." }, { functionCall: { id: "call_1", name: "clima", args: { ciudad: "Caracas" } }, thoughtSignature: SKIP_THOUGHT_SIGNATURE }],
      },
      { role: "user", parts: [{ functionResponse: { id: "call_1", name: "clima", response: { grados: 29 } } }] },
    ]);
  });

  it("lee llamadas con su firma, ignora el pensamiento y guarda las partes para el turno siguiente", async () => {
    const parts = [
      { text: "pensando...", thought: true },
      { functionCall: { id: "fc-1", name: "clima", args: { ciudad: "Caracas" } }, thoughtSignature: "firma-A" },
      { functionCall: { id: "fc-2", name: "hora", args: {} } },
    ];
    const { fetch, sent } = fakeFetch([
      {
        body: {
          candidates: [{ content: { role: "model", parts }, finishReason: "STOP" }],
          usageMetadata: { promptTokenCount: 30, candidatesTokenCount: 10, thoughtsTokenCount: 25, cachedContentTokenCount: 5, totalTokenCount: 65 },
          modelVersion: "gemini-3.8-flash",
        },
      },
      { body: { candidates: [{ content: { parts: [{ text: "Listo" }] }, finishReason: "STOP" }] } },
    ]);
    const provider = geminiProvider({ apiKey: "k", models: MODELS, fetch });
    const first = await provider.generate(callFor(flash, { tools: [WEATHER_TOOL] }));
    expect(first).toMatchObject({
      text: "",
      finishReason: "tool_calls",
      toolCalls: [
        { id: "fc-1", name: "clima", arguments: { ciudad: "Caracas" } },
        { id: "fc-2", name: "hora", arguments: {} },
      ],
      usage: { inputTokens: 30, outputTokens: 35, totalTokens: 65, cachedInputTokens: 5, reasoningTokens: 25 },
      state: { provider: "gemini", data: { parts } },
    });
    await provider.generate(
      callFor(flash, {
        tools: [WEATHER_TOOL],
        messages: [
          { role: "user", content: "Clima y hora" },
          { role: "assistant", content: "", toolCalls: first.toolCalls, state: first.state },
          { role: "tool", toolCallId: "fc-1", name: "clima", content: "29 grados" },
          { role: "tool", toolCallId: "fc-2", name: "hora", content: '{"hora":"10:00"}', isError: false },
        ],
      }),
    );
    expect(sent[1].body.contents).toEqual([
      { role: "user", parts: [{ text: "Clima y hora" }] },
      { role: "model", parts },
      {
        role: "user",
        parts: [
          { functionResponse: { id: "fc-1", name: "clima", response: { result: "29 grados" } } },
          { functionResponse: { id: "fc-2", name: "hora", response: { hora: "10:00" } } },
        ],
      },
    ]);
  });

  it("motivos de fin y pedidos bloqueados", async () => {
    const { fetch } = fakeFetch([
      { body: { candidates: [{ content: { parts: [{ text: "Hasta" }] }, finishReason: "MAX_TOKENS" }] } },
      { body: { candidates: [{ content: { parts: [] }, finishReason: "SAFETY" }] } },
      { body: { promptFeedback: { blockReason: "PROHIBITED_CONTENT" } } },
      { body: { candidates: [{ content: { parts: [] }, finishReason: "MALFORMED_FUNCTION_CALL" }] } },
    ]);
    const provider = geminiProvider({ apiKey: "k", models: MODELS, fetch });
    await expect(provider.generate(callFor(flash))).resolves.toMatchObject({ finishReason: "length", text: "Hasta" });
    await expect(provider.generate(callFor(flash))).resolves.toMatchObject({ finishReason: "content_filter" });
    await expect(provider.generate(callFor(flash))).resolves.toMatchObject({ finishReason: "content_filter", text: "" });
    await expectAIError(provider.generate(callFor(flash)), "bad_response");
  });

  it("errores: llave inválida (400), límite por minuto con RetryInfo, cuota diaria, saturación y entrada larga (500)", async () => {
    const error = (status: number, state: string, message: string, details: unknown[] = []) => ({
      status,
      body: { error: { code: status, message, status: state, details } },
    });
    const { fetch } = fakeFetch([
      error(400, "INVALID_ARGUMENT", "API key not valid. Please pass a valid API key.", [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason: "API_KEY_INVALID" }]),
      error(429, "RESOURCE_EXHAUSTED", "Resource has been exhausted (e.g. check quota).", [
        { "@type": "type.googleapis.com/google.rpc.QuotaFailure", violations: [{ quotaId: "GenerateRequestsPerMinutePerProjectPerModel" }] },
        { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "33s" },
      ]),
      error(429, "RESOURCE_EXHAUSTED", "You exceeded your current quota, please check your plan and billing details.", [
        { "@type": "type.googleapis.com/google.rpc.QuotaFailure", violations: [{ quotaId: "GenerateContentInputTokensPerModelPerMinute-FreeTier" }] },
        { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "45s" },
      ]),
      error(429, "RESOURCE_EXHAUSTED", "Quota exceeded", [
        { "@type": "type.googleapis.com/google.rpc.QuotaFailure", violations: [{ quotaId: "GenerateRequestsPerDayPerProjectPerModel" }] },
      ]),
      error(402, "RESOURCE_EXHAUSTED", "Prepaid credits exhausted"),
      error(503, "UNAVAILABLE", "The model is overloaded."),
      error(500, "INTERNAL", "The input token count exceeds the maximum context length."),
      error(404, "NOT_FOUND", "models/gemini-9 is not found"),
      error(403, "PERMISSION_DENIED", "Permission denied"),
    ]);
    const provider = geminiProvider({ apiKey: "k", models: MODELS, fetch });
    await expectAIError(provider.generate(callFor(flash)), "auth_failed");
    await expectAIError(provider.generate(callFor(flash)), "rate_limited", { retryAfterMs: 33_000 });
    await expectAIError(provider.generate(callFor(flash)), "rate_limited", { retryAfterMs: 45_000 });
    await expectAIError(provider.generate(callFor(flash)), "quota_exceeded");
    await expectAIError(provider.generate(callFor(flash)), "quota_exceeded");
    await expectAIError(provider.generate(callFor(flash)), "provider_unavailable");
    await expectAIError(provider.generate(callFor(flash)), "context_too_long");
    await expectAIError(provider.generate(callFor(flash)), "model_not_found");
    await expectAIError(provider.generate(callFor(flash)), "auth_failed");
  });

  it("si la API ya no acepta responseSchema, repite con responseFormat", async () => {
    const { fetch, sent } = fakeFetch([
      { status: 400, body: { error: { code: 400, status: "INVALID_ARGUMENT", message: 'Invalid JSON payload received. Unknown name "responseSchema" at generation_config' } } },
      { body: { candidates: [{ content: { parts: [{ text: '{"titular":"Hola"}' }] }, finishReason: "STOP" }] } },
    ]);
    const result = await geminiProvider({ apiKey: "k", models: MODELS, fetch }).generate(callFor(flash, { responseFormat: { type: "json", schema: REPORT_SCHEMA } }));
    expect(sent[1].body.generationConfig).toMatchObject({ responseFormat: { text: { mimeType: "application/json", schema: REPORT_SCHEMA } } });
    expect((sent[1].body.generationConfig as Record<string, unknown>).responseSchema).toBeUndefined();
    expect(result.text).toBe('{"titular":"Hola"}');
  });
});

describe("router de IA: xAI (Grok, compatible con OpenAI)", () => {
  const grok = xaiModel("grok-4.3", "fast");

  it("arma el pedido de Chat Completions: max_completion_tokens, imagen, herramientas, esfuerzo y JSON", async () => {
    const { fetch, sent } = fakeFetch([{ body: { choices: [{ message: { role: "assistant", content: "{}" }, finish_reason: "stop" }] } }]);
    await xaiProvider({ apiKey: "xai-prueba", models: MODELS, fetch }).generate(
      callFor(grok, {
        system: "Eres Omni.",
        messages: [...TOOL_ROUND.slice(0, 3), { role: "user", content: [{ type: "text", text: "¿Y esto?" }, IMAGE] }],
        tools: [WEATHER_TOOL],
        toolChoice: { name: "clima" },
        temperature: 0.3,
        stop: ["FIN"],
        reasoning: "high",
        responseFormat: { type: "json", schema: REPORT_SCHEMA, name: "informe" },
      }),
    );
    const [request] = sent;
    expect(request.url).toBe("https://api.x.ai/v1/chat/completions");
    expect(request.headers.authorization).toBe("Bearer xai-prueba");
    expect(request.body).toMatchObject({
      model: "grok-4.3",
      max_completion_tokens: 1000,
      temperature: 0.3,
      reasoning_effort: "high",
      response_format: { type: "json_schema", json_schema: { name: "informe", schema: REPORT_SCHEMA } },
      tools: [{ type: "function", function: { name: "clima", description: "El clima de una ciudad", parameters: WEATHER_TOOL.parameters } }],
      tool_choice: { type: "function", function: { name: "clima" } },
      messages: [
        { role: "system", content: "Eres Omni." },
        { role: "user", content: "¿Cómo está el clima en Caracas?" },
        {
          role: "assistant",
          content: "Lo reviso.",
          tool_calls: [{ id: "call_1", type: "function", function: { name: "clima", arguments: '{"ciudad":"Caracas"}' } }],
        },
        { role: "tool", tool_call_id: "call_1", content: '{"grados":29}' },
        {
          role: "user",
          content: [
            { type: "text", text: "¿Y esto?" },
            { type: "image_url", image_url: { url: "data:image/png;base64,iVBORw0KGgo=", detail: "auto" } },
          ],
        },
      ],
    });
    // Los modelos de razonamiento de Grok rechazan `stop`: el router corta el texto.
    expect(request.body.stop).toBeUndefined();
    expect(request.body.max_tokens).toBeUndefined();
  });

  it("lee llamadas aunque finish_reason diga stop, y el uso con razonamiento", async () => {
    const { fetch } = fakeFetch([
      {
        body: {
          id: "chatcmpl-1",
          object: "chat.completion",
          model: "grok-4.3",
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                content: null,
                reasoning_content: "...",
                tool_calls: [{ id: "call_9", type: "function", function: { name: "clima", arguments: '{"ciudad":"Caracas"}' } }],
              },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 40, completion_tokens: 30, total_tokens: 70, prompt_tokens_details: { cached_tokens: 10 }, completion_tokens_details: { reasoning_tokens: 20 } },
        },
      },
    ]);
    const result = await xaiProvider({ apiKey: "k", models: MODELS, fetch }).generate(callFor(grok, { tools: [WEATHER_TOOL] }));
    expect(result).toMatchObject({
      model: "grok-4.3",
      text: "",
      finishReason: "tool_calls",
      toolCalls: [{ id: "call_9", name: "clima", arguments: { ciudad: "Caracas" } }],
      usage: { inputTokens: 40, outputTokens: 30, totalTokens: 70, cachedInputTokens: 10, reasoningTokens: 20 },
      state: null,
    });
  });

  it("no lee PDF y traduce sus errores (llave como 400, créditos, límite de tasa)", async () => {
    await expectAIError(
      xaiProvider({ apiKey: "k", models: MODELS, fetch: fakeFetch([]).fetch }).generate(callFor(grok, { messages: [{ role: "user", content: [PDF] }] })),
      "invalid_request",
    );
    const { fetch } = fakeFetch([
      { status: 400, body: { code: "Client specified an invalid argument", error: "Incorrect API key provided: xa***. You can obtain an API key from https://console.x.ai." } },
      { status: 429, body: { error: { message: "Your team has run out of credits." } } },
      { status: 429, body: { code: "Too many requests", error: "Rate limit exceeded" }, headers: { "retry-after": "3" } },
      { status: 403, body: { error: "Your team has reached its monthly spending limit." } },
      { status: 404, body: { error: "The model grok-9 does not exist or your team does not have access to it." } },
      { status: 502, raw: "<html>Bad gateway</html>" },
    ]);
    const provider = xaiProvider({ apiKey: "k", models: MODELS, fetch });
    await expectAIError(provider.generate(callFor(grok)), "auth_failed");
    await expectAIError(provider.generate(callFor(grok)), "quota_exceeded");
    await expectAIError(provider.generate(callFor(grok)), "rate_limited", { retryAfterMs: 3000 });
    await expectAIError(provider.generate(callFor(grok)), "quota_exceeded");
    await expectAIError(provider.generate(callFor(grok)), "model_not_found");
    await expectAIError(provider.generate(callFor(grok)), "provider_unavailable", { detail: "<html>Bad gateway</html>" });
  });
});
