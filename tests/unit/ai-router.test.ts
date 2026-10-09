import { describe, expect, it } from "vitest";
import { anthropicModel, geminiModel, needsOf, openAIModel, parseProviderOrder, xaiModel } from "@/modules/ai/ai.catalog";
import { AIProviderError, aiErrorToHttp, summarizeFailure } from "@/modules/ai/ai.errors";
import { AIRouter, CircuitBreaker, cutAtStop, validateRequest, type AttemptEvent, type RouterOptions } from "@/modules/ai/ai.router";
import type { AIRequestPrompt, ModelProvider, ProviderCall, ProviderResult } from "@/modules/ai/ai.types";
import { fakeProvider, result } from "../support/ai-fakes";

// Router de IA: elige proveedor, reintenta lo pasajero, cambia de proveedor si uno falla y devuelve siempre la misma
// respuesta normalizada (o un error normalizado). Proveedores simulados, reloj y espera controlados.

const claude = [anthropicModel("claude-haiku-4-5-20251001", "fast"), anthropicModel("claude-sonnet-5-5", "smart")];
const gpt = [openAIModel("gpt-6-luna", "fast"), openAIModel("gpt-6.1-sol", "smart")];
const gemini = [geminiModel("gemini-3.5-flash-lite", "fast"), geminiModel("gemini-3.8-flash", "smart")];
const grok = [xaiModel("grok-4.3", "fast"), xaiModel("grok-4.7", "smart")];

const ask: AIRequestPrompt = { messages: [{ role: "user", content: "Hola" }] };
const err = (code: AIProviderError["code"], provider: AIProviderError["provider"], extra: { retryAfterMs?: number; retryable?: boolean } = {}) =>
  new AIProviderError(code, { provider, ...extra });

function routerWith(providers: ModelProvider[], options: Partial<RouterOptions> = {}) {
  const clock = { now: 1_000_000 };
  const waits: number[] = [];
  const events: AttemptEvent[] = [];
  let ids = 0;
  const router = new AIRouter({
    providers,
    now: () => clock.now,
    sleep: async (ms) => {
      waits.push(ms);
      clock.now += ms;
    },
    random: () => 0.5,
    newId: () => `r${++ids}`,
    onAttempt: (event) => events.push(event),
    ...options,
  });
  return { router, clock, waits, events };
}

describe("router de IA: respuesta normalizada", () => {
  it("responde el primer proveedor del orden, con la misma forma para todos", async () => {
    const anthropic = fakeProvider("anthropic", claude, [result({ text: "Hola, soy Omni." })]);
    const openai = fakeProvider("openai", gpt, []);
    const { router, events } = routerWith([anthropic, openai]);
    const { response, state } = await router.complete(ask);
    expect(response).toMatchObject({
      id: "r1",
      object: "ai.response",
      provider: "anthropic",
      model: "claude-haiku-4-5-20251001",
      tier: "fast",
      text: "Hola, soy Omni.",
      json: null,
      toolCalls: [],
      finishReason: "stop",
      fallback: false,
      warnings: [],
      attempts: [{ provider: "anthropic", model: "claude-haiku-4-5-20251001", ok: true, error: null }],
    });
    expect(state).toBeNull();
    expect(openai.calls).toHaveLength(0);
    expect(events).toHaveLength(1);
  });

  it("elige el proveedor y el nivel pedidos, y suma la reserva de razonamiento al máximo de tokens", async () => {
    const anthropic = fakeProvider("anthropic", claude, []);
    const openai = fakeProvider("openai", gpt, [result()]);
    const { router } = routerWith([anthropic, openai]);
    const { response } = await router.complete({ ...ask, provider: "openai", tier: "smart", maxOutputTokens: 2000 });
    expect(response).toMatchObject({ provider: "openai", model: "gpt-6.1-sol", tier: "smart", fallback: false });
    expect(openai.calls[0].maxOutputTokens).toBe(2000 + 8_192);
  });

  it("un modelo exacto para el proveedor preferido (uso interno)", async () => {
    const anthropic = fakeProvider("anthropic", claude, [result()]);
    const { router } = routerWith([anthropic]);
    await router.complete({ ...ask, provider: "anthropic", model: "claude-opus-5-5", tier: "smart" });
    expect(anthropic.calls[0].model).toMatchObject({ id: "claude-opus-5-5", capabilities: { forcedToolChoice: false } });
  });

  it("lee el JSON pedido y avisa lo que el modelo no admite", async () => {
    const openai = fakeProvider("openai", gpt, [result({ text: '```json\n{"ok":true}\n```' })]);
    const { router } = routerWith([openai]);
    const { response } = await router.complete({ ...ask, responseFormat: { type: "json" }, temperature: 0.2 });
    expect(response.json).toEqual({ ok: true });
    expect(response.warnings).toEqual(["temperature_ignored"]);
  });

  it("corta el texto en la secuencia de corte si el proveedor no la admite", async () => {
    const grokProvider = fakeProvider("xai", grok, [result({ text: "uno, dos FIN tres", finishReason: "length" })]);
    const { router } = routerWith([grokProvider]);
    const { response } = await router.complete({ ...ask, stop: ["FIN"] });
    expect(response).toMatchObject({ text: "uno, dos ", finishReason: "stop", warnings: ["stop_emulated"] });
    expect(cutAtStop("sin corte", ["FIN"])).toBeNull();
  });

  it("devuelve el estado del proveedor para seguir una ronda de herramientas", async () => {
    const state = { provider: "gemini" as const, model: "gemini-3.5-flash-lite", data: { parts: [{ text: "x" }] } };
    const geminiProvider = fakeProvider("gemini", gemini, [result({ toolCalls: [{ id: "fc-1", name: "clima", arguments: {} }], finishReason: "tool_calls", state })]);
    const { router } = routerWith([geminiProvider]);
    const routed = await router.complete({
      ...ask,
      tools: [{ name: "clima", description: "Clima", parameters: { type: "object", properties: {} } }],
      responseFormat: { type: "json" },
    });
    // Con llamadas a herramientas no se exige JSON.
    expect(routed.response).toMatchObject({ finishReason: "tool_calls", json: null, toolCalls: [{ id: "fc-1" }] });
    expect(routed.state).toEqual(state);
  });
});

describe("router de IA: reintentos y respaldo", () => {
  it("reintenta una falla pasajera con espera y después cambia de proveedor", async () => {
    const anthropic = fakeProvider("anthropic", claude, [err("provider_unavailable", "anthropic"), err("provider_unavailable", "anthropic")]);
    const openai = fakeProvider("openai", gpt, [result({ text: "Respondo yo." })]);
    const { router, waits } = routerWith([anthropic, openai]);
    const { response } = await router.complete(ask);
    expect(response).toMatchObject({
      provider: "openai",
      text: "Respondo yo.",
      fallback: true,
      attempts: [
        { provider: "anthropic", ok: false, error: "provider_unavailable" },
        { provider: "anthropic", ok: false, error: "provider_unavailable" },
        { provider: "openai", ok: true },
      ],
    });
    // 500 ms de base con la mitad de variación (random = 0.5): 375 ms.
    expect(waits).toEqual([375]);
  });

  it("espera lo que pide el proveedor si es poco; si es mucho, pasa al siguiente", async () => {
    const short = fakeProvider("anthropic", claude, [err("rate_limited", "anthropic", { retryAfterMs: 2000 }), result()]);
    const a = routerWith([short]);
    await a.router.complete(ask);
    expect(a.waits).toEqual([2000]);

    const long = fakeProvider("anthropic", claude, [err("rate_limited", "anthropic", { retryAfterMs: 60_000 })]);
    const openai = fakeProvider("openai", gpt, [result(), result()]);
    const b = routerWith([long, openai]);
    const { response } = await b.router.complete(ask);
    expect(b.waits).toEqual([]);
    expect(response.provider).toBe("openai");
    // El cortacircuitos deja a Anthropic al final mientras dure su espera.
    const next = await b.router.complete(ask);
    expect(next.response.provider).toBe("openai");
    expect(long.calls).toHaveLength(1);
  });

  it("sin cuota no reintenta con el mismo; prueba otro y lo deja fuera mientras haya alternativa", async () => {
    const anthropic = fakeProvider("anthropic", claude, [err("quota_exceeded", "anthropic")]);
    const openai = fakeProvider("openai", gpt, [result(), result()]);
    const { router } = routerWith([anthropic, openai]);
    await router.complete(ask);
    await router.complete(ask);
    expect(anthropic.calls).toHaveLength(1);
    expect(openai.calls).toHaveLength(2);
    expect(router.breakerStatus("anthropic")).toBe("hard");
  });

  it("un pedido inválido, demasiado largo o bloqueado no se prueba con otro proveedor", async () => {
    for (const code of ["invalid_request", "context_too_long", "content_blocked"] as const) {
      const anthropic = fakeProvider("anthropic", claude, [err(code, "anthropic")]);
      const openai = fakeProvider("openai", gpt, [result()]);
      const { router } = routerWith([anthropic, openai]);
      await expect(router.complete(ask)).rejects.toMatchObject({ code, attempts: [{ provider: "anthropic", error: code }] });
      expect(openai.calls).toHaveLength(0);
    }
  });

  it("un JSON inválido se reintenta; uno cortado por el máximo de tokens pasa directo al siguiente", async () => {
    const anthropic = fakeProvider("anthropic", claude, [result({ text: "no es json" }), result({ text: '{"ok":true}' })]);
    const a = routerWith([anthropic]);
    const { response } = await a.router.complete({ ...ask, responseFormat: { type: "json" } });
    expect(response).toMatchObject({ json: { ok: true }, attempts: [{ ok: false, error: "bad_response" }, { ok: true }] });

    const cut = fakeProvider("anthropic", claude, [result({ text: '{"ok":', finishReason: "length" })]);
    const openai = fakeProvider("openai", gpt, [result({ text: '{"ok":true}' })]);
    const b = routerWith([cut, openai]);
    const routed = await b.router.complete({ ...ask, responseFormat: { type: "json" } });
    expect(cut.calls).toHaveLength(1);
    expect(routed.response).toMatchObject({ provider: "openai", json: { ok: true } });
  });

  it("con fallback: false solo usa el proveedor pedido", async () => {
    const anthropic = fakeProvider("anthropic", claude, [result()]);
    const openai = fakeProvider("openai", gpt, [err("provider_unavailable", "openai"), err("provider_unavailable", "openai")]);
    const { router } = routerWith([anthropic, openai]);
    await expect(router.complete({ ...ask, provider: "openai", fallback: false })).rejects.toMatchObject({ code: "provider_unavailable", provider: "openai" });
    expect(anthropic.calls).toHaveLength(0);
    const missing = routerWith([anthropic, fakeProvider("gemini", gemini, [], { configured: false })]);
    await expect(missing.router.complete({ ...ask, provider: "gemini", fallback: false })).rejects.toMatchObject({ code: "not_configured", provider: "gemini" });
  });

  it("si todos fallan igual, ese es el error (con la espera más corta)", async () => {
    const anthropic = fakeProvider("anthropic", claude, [err("rate_limited", "anthropic", { retryAfterMs: 20_000 })]);
    const openai = fakeProvider("openai", gpt, [err("rate_limited", "openai", { retryAfterMs: 9_000 })]);
    const { router } = routerWith([anthropic, openai]);
    const failure = await router.complete(ask).catch((error: unknown) => error as AIProviderError);
    expect(failure).toMatchObject({ code: "rate_limited", retryAfterMs: 9000, provider: null });
    expect(aiErrorToHttp(failure as AIProviderError)).toMatchObject({
      status: 429,
      code: "ai_rate_limited",
      message: "Hay mucha demanda en la IA en este momento. Inténtalo en 9 segundos.",
      retryAfter: 9,
      details: { retryAfterSeconds: 9, attempts: [{ provider: "anthropic", error: "rate_limited" }, { provider: "openai", error: "rate_limited" }] },
    });
  });

  it("fallas distintas en varios proveedores: la IA no está disponible", () => {
    const summary = summarizeFailure(
      [],
      [err("timeout", "anthropic"), err("quota_exceeded", "openai")],
    );
    expect(summary.code).toBe("provider_unavailable");
    expect(aiErrorToHttp(summary)).toMatchObject({ status: 503, code: "ai_unavailable" });
  });
});

describe("router de IA: capacidades, plazos y cancelación", () => {
  it("salta a los proveedores que no pueden con el pedido (PDF, tipo de imagen)", async () => {
    const xai = fakeProvider("xai", grok, []);
    const geminiProvider = fakeProvider("gemini", gemini, [result(), result()]);
    const { router } = routerWith([xai, geminiProvider], { order: ["xai", "gemini"] });
    const pdf: AIRequestPrompt = { messages: [{ role: "user", content: [{ type: "file", mediaType: "application/pdf", data: "JVBERi0=" }] }] };
    const webp: AIRequestPrompt = { messages: [{ role: "user", content: [{ type: "image", mediaType: "image/webp", data: "UklGRg==" }] }] };
    expect((await router.complete(pdf)).response.provider).toBe("gemini");
    expect((await router.complete(webp)).response.provider).toBe("gemini");
    expect(xai.calls).toHaveLength(0);
    expect(needsOf(pdf)).toMatchObject({ pdf: true, tools: false });

    const onlyGrok = routerWith([fakeProvider("xai", grok, [])]);
    await expect(onlyGrok.router.complete(pdf)).rejects.toMatchObject({ code: "invalid_request" });
    await expect(routerWith([]).router.complete(ask)).rejects.toMatchObject({ code: "not_configured" });
  });

  it("corta el intento que se pasa de su tiempo (aunque el adaptador no respete la señal) y sigue con otro sin reintentar", async () => {
    const stuck = fakeProvider("anthropic", claude, [() => new Promise<ProviderResult>(() => undefined)]);
    const openai = fakeProvider("openai", gpt, [result()]);
    const router = new AIRouter({ providers: [stuck, openai], sleep: async () => undefined });
    const { response } = await router.complete({ ...ask, timeoutMs: 30 });
    expect(response).toMatchObject({ provider: "openai", fallback: true });
    expect(response.attempts).toMatchObject([
      { provider: "anthropic", ok: false, error: "timeout" },
      { provider: "openai", ok: true },
    ]);
  });

  it("un proveedor colgado deja tiempo para el respaldo dentro del plazo total", async () => {
    // Plazo de 16,6 s: con 15 s guardados para el respaldo, el primero tiene 1,6 s (no sus 30 s).
    const stuck = fakeProvider("anthropic", claude, [() => new Promise<ProviderResult>(() => undefined)]);
    const openai = fakeProvider("openai", gpt, [result()]);
    const { router } = routerWith([stuck, openai]);
    const started = Date.now();
    const { response } = await router.complete({ ...ask, deadlineMs: 16_600 });
    expect(response.provider).toBe("openai");
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it("con provider auto y sin respaldo, usa el primero que está respondiendo", async () => {
    const anthropic = fakeProvider("anthropic", claude, [err("auth_failed", "anthropic")]);
    const openai = fakeProvider("openai", gpt, [result(), result()]);
    const { router } = routerWith([anthropic, openai]);
    await router.complete(ask);
    const { response } = await router.complete({ ...ask, fallback: false });
    expect(response.provider).toBe("openai");
    expect(anthropic.calls).toHaveLength(1);
  });

  it("si quien pidió cancela, no hay reintentos ni respaldo", async () => {
    const controller = new AbortController();
    const slow = fakeProvider("anthropic", claude, [
      (call: ProviderCall) =>
        new Promise<ProviderResult>((_, reject) => {
          call.signal.addEventListener("abort", () => reject(err("aborted", "anthropic")), { once: true });
          setTimeout(() => controller.abort(new Error("La persona cerró la app.")), 5);
        }),
    ]);
    const openai = fakeProvider("openai", gpt, [result()]);
    const router = new AIRouter({ providers: [slow, openai] });
    await expect(router.complete({ ...ask, signal: controller.signal })).rejects.toMatchObject({ code: "aborted" });
    expect(openai.calls).toHaveLength(0);
  });

  it("sin tiempo para un intento, responde tiempo agotado sin llamar", async () => {
    const anthropic = fakeProvider("anthropic", claude, []);
    const { router } = routerWith([anthropic]);
    await expect(router.complete({ ...ask, deadlineMs: 1_000 })).rejects.toMatchObject({ code: "timeout" });
    expect(anthropic.calls).toHaveLength(0);
  });

  it("revisa lo mínimo del pedido antes de llamar", () => {
    expect(() => validateRequest({ messages: [] })).toThrow(AIProviderError);
    expect(() => validateRequest({ messages: [{ role: "user", content: "a" }, { role: "assistant", content: "b" }] })).toThrow("La IA no pudo procesar");
    expect(() =>
      validateRequest({ ...ask, tools: [{ name: "con espacios", description: "", parameters: { type: "object" } }] }),
    ).toThrow(AIProviderError);
    expect(() =>
      validateRequest({ ...ask, tools: [{ name: "a", description: "", parameters: { type: "object" } }], toolChoice: { name: "b" } }),
    ).toThrow(AIProviderError);
    expect(() => validateRequest(ask)).not.toThrow();
  });
});

describe("router de IA: orden y cortacircuitos", () => {
  it("el orden configurado pone primero los nombrados y completa con el resto", () => {
    expect(parseProviderOrder("openai, gemini")).toEqual(["openai", "gemini", "anthropic", "xai"]);
    expect(parseProviderOrder("nadie")).toEqual(["anthropic", "openai", "gemini", "xai"]);
    expect(parseProviderOrder(undefined)).toEqual(["anthropic", "openai", "gemini", "xai"]);
  });

  it("se abre tras varias fallas seguidas, se cierra con un acierto y respeta el Retry-After largo", () => {
    const breaker = new CircuitBreaker({ threshold: 3, cooldownMs: 30_000, longCooldownMs: 300_000 });
    const now = 1_000;
    breaker.failure("openai", err("timeout", "openai"), now);
    breaker.failure("openai", err("timeout", "openai"), now);
    expect(breaker.status("openai", now)).toBe("closed");
    breaker.failure("openai", err("timeout", "openai"), now);
    expect(breaker.status("openai", now)).toBe("open");
    expect(breaker.status("openai", now + 30_001)).toBe("closed");
    breaker.success("openai");
    expect(breaker.status("openai", now)).toBe("closed");
    breaker.failure("xai", err("rate_limited", "xai", { retryAfterMs: 90_000 }), now);
    expect(breaker.status("xai", now + 60_000)).toBe("open");
    breaker.failure("gemini", err("invalid_request", "gemini"), now);
    expect(breaker.status("gemini", now)).toBe("closed");
    breaker.failure("gemini", err("auth_failed", "gemini"), now);
    expect(breaker.status("gemini", now)).toBe("hard");
  });
});
