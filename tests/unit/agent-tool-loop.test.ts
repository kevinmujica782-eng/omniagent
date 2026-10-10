import { describe, expect, it } from "vitest";
import { answeredByLine, autoProviderOf, modelLabel, planModelOf } from "@/lib/ai-copy";
import { resolveProvider, runToolLoop, type ToolLoopInput, type ToolOutcome } from "@/modules/agent/tool-loop";
import { anthropicModel, geminiModel, openAIModel, preferredProviderOf } from "@/modules/ai/ai.catalog";
import { AIProviderError } from "@/modules/ai/ai.errors";
import { AIRouter, type RoutedResult } from "@/modules/ai/ai.router";
import { EMPTY_USAGE, type AIRequestPrompt, type AIToolCall, type ModelProvider } from "@/modules/ai/ai.types";
import type { AIModelsView, AIResponse } from "@/types/ai";
import type { AgentCard } from "@/types/cards";
import { fakeProvider, result } from "../support/ai-fakes";

// El chat del agente sobre el router de IA: rondas de herramientas, el modelo que eligió la persona, el respaldo
// cuando uno falla y el tiempo del turno. Proveedores simulados y reloj controlado; sin red ni base de datos.

const claude = [anthropicModel("claude-haiku-4-5-20251001", "fast"), anthropicModel("claude-sonnet-5-5", "smart")];
const gpt = [openAIModel("gpt-6-luna", "fast"), openAIModel("gpt-6.1-sol", "smart")];
const gemini = [geminiModel("gemini-3.5-flash-lite", "fast"), geminiModel("gemini-3.8-flash", "smart")];

const card = { kind: "monthly_trend" } as unknown as AgentCard;
const toolCall = (id: string, name = "resumen_financiero", args: Record<string, unknown> = { meses: 3 }): AIToolCall => ({ id, name, arguments: args });
const asksTools = (...calls: AIToolCall[]) => result({ text: "", toolCalls: calls, finishReason: "tool_calls" });
const tools = [
  { name: "resumen_financiero", description: "Resumen de gastos", parameters: { type: "object", properties: { meses: { type: "number" } } } },
  { name: "cancelar_suscripcion", description: "Prepara una baja", parameters: { type: "object", properties: {} } },
];

function routerWith(providers: ModelProvider[]) {
  const clock = { now: 1_000_000 };
  const router = new AIRouter({ providers, now: () => clock.now, sleep: async () => undefined, random: () => 0.5 });
  return { router, clock };
}

function loopInput(complete: ToolLoopInput["complete"], overrides: Partial<ToolLoopInput> = {}) {
  const executed: AIToolCall[] = [];
  const input: ToolLoopInput = {
    complete,
    system: [{ text: "Eres Omni.", cache: true }, { text: "Hoy es jueves." }],
    messages: [{ role: "user", content: "¿A dónde se fue mi dinero?" }],
    tools,
    tier: "fast",
    provider: null,
    maxOutputTokens: 1500,
    maxRounds: 6,
    deadline: 1_000_000 + 52_000,
    now: () => 1_000_000,
    execute: async (call): Promise<ToolOutcome> => {
      executed.push(call);
      return { data: { total: 4212 }, isError: false, cards: [card], suggestions: ["a", "b", "c", "d"] };
    },
    ...overrides,
  };
  return { input, executed };
}

function routed(partial: Partial<AIResponse> = {}): RoutedResult {
  return {
    response: {
      id: "r1",
      object: "ai.response",
      provider: "anthropic",
      model: "claude-haiku-4-5-20251001",
      tier: "fast",
      text: "Listo.",
      json: null,
      toolCalls: [],
      finishReason: "stop",
      usage: { ...EMPTY_USAGE, inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      latencyMs: 100,
      fallback: false,
      attempts: [{ provider: "anthropic", model: "claude-haiku-4-5-20251001", ok: true, error: null, latencyMs: 100 }],
      warnings: [],
      createdAt: new Date(0).toISOString(),
      ...partial,
    },
    state: null,
  };
}

describe("chat del agente: rondas de herramientas", () => {
  it("responde sin herramientas con el primer proveedor del orden", async () => {
    const anthropic = fakeProvider("anthropic", claude, [result({ text: "  Gastas $4,212 al mes.  " })]);
    const { router } = routerWith([anthropic, fakeProvider("openai", gpt, [])]);
    const { input } = loopInput((request) => router.complete(request));

    const out = await runToolLoop(input);
    expect(out).toMatchObject({ text: "Gastas $4,212 al mes.", provider: "anthropic", fallbackFrom: null, toolCalls: 0, interrupted: null });
    expect(out.usage).toEqual({ input: 10, output: 5, cached: 0 });
    // Las instrucciones llegan por partes (Claude guarda en caché la parte fija) y con las herramientas.
    expect(anthropic.calls[0].request.system).toEqual(input.system);
    expect(anthropic.calls[0].request.tools?.map((tool) => tool.name)).toEqual(["resumen_financiero", "cancelar_suscripcion"]);
    expect(anthropic.calls[0].request.provider).toBeUndefined();
  });

  it("ejecuta las herramientas, le devuelve los resultados al modelo y junta tarjetas y sugerencias", async () => {
    const anthropic = fakeProvider("anthropic", claude, [
      asksTools(toolCall("t1"), toolCall("t2", "cancelar_suscripcion", {})),
      result({ text: "Preparé las bajas." }),
    ]);
    const { router } = routerWith([anthropic]);
    const { input, executed } = loopInput((request) => router.complete(request));

    const out = await runToolLoop(input);
    expect(executed.map((call) => call.id)).toEqual(["t1", "t2"]);
    expect(out).toMatchObject({ text: "Preparé las bajas.", toolCalls: 2, cards: [card, card], suggestions: ["a", "b", "c"] });
    expect(out.usage).toEqual({ input: 20, output: 10, cached: 0 });

    const second = anthropic.calls[1].request.messages;
    expect(second.slice(1)).toEqual([
      { role: "assistant", content: "", toolCalls: [toolCall("t1"), toolCall("t2", "cancelar_suscripcion", {})], state: null },
      { role: "tool", toolCallId: "t1", name: "resumen_financiero", content: JSON.stringify({ total: 4212 }), isError: false },
      { role: "tool", toolCallId: "t2", name: "cancelar_suscripcion", content: JSON.stringify({ total: 4212 }), isError: false },
    ]);
    // La historia de quien llama no se toca.
    expect(input.messages).toHaveLength(1);
  });

  it("los errores de una herramienta vuelven al modelo marcados como error", async () => {
    const anthropic = fakeProvider("anthropic", claude, [asksTools(toolCall("t1")), result({ text: "No pude leer tus cuentas." })]);
    const { router } = routerWith([anthropic]);
    const { input } = loopInput((request) => router.complete(request), {
      execute: async () => ({ data: { error: "Parámetros inválidos" }, isError: true }),
    });

    const out = await runToolLoop(input);
    expect(out.cards).toEqual([]);
    expect(anthropic.calls[1].request.messages.at(-1)).toMatchObject({ role: "tool", isError: true, content: '{"error":"Parámetros inválidos"}' });
  });

  it("con el máximo de rondas, pide dividir el pedido", async () => {
    const anthropic = fakeProvider("anthropic", claude, [asksTools(toolCall("t1")), asksTools(toolCall("t2")), asksTools(toolCall("t3"))]);
    const { router } = routerWith([anthropic]);
    const { input, executed } = loopInput((request) => router.complete(request), { maxRounds: 2 });

    const out = await runToolLoop(input);
    expect(anthropic.calls).toHaveLength(3);
    expect(executed).toHaveLength(2);
    expect(out.text).toBe("Esto necesita más pasos de los que puedo dar de una vez. ¿Lo dividimos?");
  });
});

describe("chat del agente: el modelo elegido y el respaldo", () => {
  it("usa primero el modelo que eligió la persona", async () => {
    const anthropic = fakeProvider("anthropic", claude, []);
    const google = fakeProvider("gemini", gemini, [result({ text: "Hola, Laura." })]);
    const { router } = routerWith([anthropic, google]);
    const { input } = loopInput((request) => router.complete(request), { provider: "gemini", tier: "smart" });

    const out = await runToolLoop(input);
    expect(out).toMatchObject({ provider: "gemini", model: "gemini-3.8-flash", fallbackFrom: null });
    expect(anthropic.calls).toHaveLength(0);
  });

  it("si el primero falla responde otro, y las rondas siguientes siguen con el que respondió", async () => {
    const anthropic = fakeProvider("anthropic", claude, [new AIProviderError("quota_exceeded", { provider: "anthropic" })]);
    const openai = fakeProvider("openai", gpt, [
      result({ text: "", toolCalls: [toolCall("t1")], finishReason: "tool_calls", state: { provider: "openai", model: "gpt-6-luna", data: ["rs_1"] } }),
      result({ text: "Listo." }),
    ]);
    const { router } = routerWith([anthropic, openai]);
    const { input } = loopInput((request) => router.complete(request));

    const out = await runToolLoop(input);
    expect(out).toMatchObject({ text: "Listo.", provider: "openai", model: "gpt-6-luna", fallbackFrom: "anthropic" });
    expect(anthropic.calls).toHaveLength(1);
    // La segunda ronda va directo a OpenAI (su estado de razonamiento solo le sirve a él).
    expect(openai.calls[1].request.provider).toBe("openai");
    expect(openai.calls[1].request.messages[1]).toMatchObject({ role: "assistant", state: { provider: "openai", data: ["rs_1"] } });
  });

  it("a quién pedirle: el elegido si tiene llave; si no, el primero del orden", () => {
    expect(resolveProvider(["anthropic", "openai"], "openai")).toEqual({ requested: "openai", expected: "openai" });
    expect(resolveProvider(["anthropic", "openai"], null)).toEqual({ requested: null, expected: "anthropic" });
    // Le quitaron la llave al elegido: responde el automático, sin marcarlo como respaldo.
    expect(resolveProvider(["anthropic"], "openai")).toEqual({ requested: null, expected: "anthropic" });
    expect(resolveProvider([], "gemini")).toEqual({ requested: null, expected: null });
  });

  it("si el elegido está apartado (sin cuota), responde otro y queda dicho cuál faltó", async () => {
    const google = fakeProvider("gemini", gemini, [new AIProviderError("quota_exceeded", { provider: "gemini" })]);
    const anthropic = fakeProvider("anthropic", claude, [result({ text: "Uno." }), result({ text: "Dos." })]);
    const { router } = routerWith([anthropic, google]);
    // Primer turno: Gemini se queda sin cuota y el router lo aparta por un rato.
    const first = await runToolLoop(loopInput((request) => router.complete(request), { provider: "gemini" }).input);
    expect(first).toMatchObject({ provider: "anthropic", fallbackFrom: "gemini" });
    // Segundo turno: el router ni lo intenta (va al final), pero igual se dice que respondió otro.
    const second = await runToolLoop(loopInput((request) => router.complete(request), { provider: "gemini" }).input);
    expect(google.calls).toHaveLength(1);
    expect(second).toMatchObject({ text: "Dos.", provider: "anthropic", fallbackFrom: "gemini" });
  });

  it("en automático, si el primero del orden está apartado, también se dice", async () => {
    const anthropic = fakeProvider("anthropic", claude, [new AIProviderError("auth_failed", { provider: "anthropic" })]);
    const openai = fakeProvider("openai", gpt, [result(), result()]);
    const { router } = routerWith([anthropic, openai]);
    await router.complete({ messages: [{ role: "user", content: "Hola" }] });
    const out = await runToolLoop(loopInput((request) => router.complete(request), { provider: "anthropic" }).input);
    expect(anthropic.calls).toHaveLength(1);
    expect(out).toMatchObject({ provider: "openai", fallbackFrom: "anthropic" });
  });

  it("si cambia de proveedor a mitad del turno, cada uno queda con su consumo", async () => {
    const anthropic = fakeProvider("anthropic", claude, [asksTools(toolCall("t1")), new AIProviderError("provider_unavailable", { provider: "anthropic", retryable: false })]);
    const openai = fakeProvider("openai", gpt, [result({ text: "Listo.", usage: { ...EMPTY_USAGE, inputTokens: 40, outputTokens: 8, totalTokens: 48 } })]);
    const { router } = routerWith([anthropic, openai]);
    const out = await runToolLoop(loopInput((request) => router.complete(request), { provider: "anthropic" }).input);
    expect(out).toMatchObject({ text: "Listo.", provider: "openai", fallbackFrom: "anthropic" });
    expect(out.usageByModel).toEqual([
      { provider: "anthropic", model: "claude-haiku-4-5-20251001", input: 10, output: 5, cached: 0 },
      { provider: "openai", model: "gpt-6-luna", input: 40, output: 8, cached: 0 },
    ]);
    expect(out.usage).toEqual({ input: 50, output: 13, cached: 0 });
  });
});

describe("chat del agente: tiempo del turno", () => {
  it("sin tiempo para la primera respuesta, falla con timeout", async () => {
    const { input } = loopInput(async () => routed(), { deadline: 1_000_000 + 2_000 });
    await expect(runToolLoop(input)).rejects.toMatchObject({ code: "timeout" });
  });

  it("si el tiempo se acaba después de usar herramientas, conserva lo hecho", async () => {
    const clock = { now: 1_000_000 };
    const complete = async (): Promise<RoutedResult> => {
      clock.now += 50_000;
      return routed({ text: "", toolCalls: [toolCall("t1")], finishReason: "tool_calls" });
    };
    const { input, executed } = loopInput(complete, { now: () => clock.now });

    const out = await runToolLoop(input);
    expect(executed).toHaveLength(1);
    expect(out).toMatchObject({ cards: [card], interrupted: "timeout", provider: "anthropic" });
    expect(out.text).toMatch(/se me acabó el tiempo/);
  });

  it("le pasa al router el tiempo que queda del turno", async () => {
    const requests: AIRequestPrompt[] = [];
    const clock = { now: 1_000_000 };
    const complete = async (request: AIRequestPrompt): Promise<RoutedResult> => {
      requests.push(request);
      clock.now += 10_000;
      return requests.length === 1 ? routed({ text: "", toolCalls: [toolCall("t1")], finishReason: "tool_calls" }) : routed();
    };
    const { input } = loopInput(complete, { now: () => clock.now });

    await runToolLoop(input);
    expect(requests.map((request) => request.deadlineMs)).toEqual([52_000, 42_000]);
  });

  it("si ningún modelo responde después de usar herramientas, devuelve lo hecho en vez de perderlo", async () => {
    let calls = 0;
    const complete = async (): Promise<RoutedResult> => {
      calls += 1;
      if (calls === 1) return routed({ text: "", toolCalls: [toolCall("t1")], finishReason: "tool_calls" });
      throw new AIProviderError("provider_unavailable", { provider: "anthropic" });
    };
    const { input } = loopInput(complete);

    const out = await runToolLoop(input);
    expect(out).toMatchObject({ cards: [card], toolCalls: 1, interrupted: "provider_unavailable" });
    expect(out.text).toMatch(/no pude terminar la respuesta/);
  });

  it("sin herramientas ejecutadas, el error del router sube tal cual", async () => {
    const { input } = loopInput(async () => {
      throw new AIProviderError("rate_limited", { provider: "anthropic" });
    });
    await expect(runToolLoop(input)).rejects.toMatchObject({ code: "rate_limited" });
  });

  it("un error que no es del router no se oculta", async () => {
    let calls = 0;
    const { input } = loopInput(async () => {
      calls += 1;
      if (calls === 1) return routed({ text: "", toolCalls: [toolCall("t1")], finishReason: "tool_calls" });
      throw new TypeError("fallo de programación");
    });
    await expect(runToolLoop(input)).rejects.toThrow(TypeError);
  });
});

describe("modelo de IA: textos y preferencia", () => {
  it("marca quién respondió: el elegido en Cuenta o el respaldo; en automático sin respaldo, nada", () => {
    expect(answeredByLine(undefined)).toBeNull();
    // Automático: el primero del orden respondió (sea Claude u otro, según AI_PROVIDER_ORDER).
    expect(answeredByLine({ provider: "anthropic", model: "claude-sonnet-5-5", fallbackFrom: null, requested: null })).toBeNull();
    expect(answeredByLine({ provider: "openai", model: "gpt-6.1-sol", fallbackFrom: null, requested: null })).toBeNull();
    // Eligió ChatGPT y respondió ChatGPT.
    expect(answeredByLine({ provider: "openai", model: "gpt-6.1-sol", fallbackFrom: null, requested: "openai" })).toBe("Respondió ChatGPT");
    // Respaldo, elegido o automático.
    expect(answeredByLine({ provider: "gemini", model: "gemini-3.8-flash", fallbackFrom: "openai", requested: "openai" })).toBe(
      "Respondió Gemini porque ChatGPT no estaba disponible",
    );
    expect(answeredByLine({ provider: "anthropic", model: "claude-sonnet-5-5", fallbackFrom: "xai", requested: null })).toBe(
      "Respondió Claude porque Grok no estaba disponible",
    );
  });

  it("el modelo de cada proveedor según el plan y quién responde en automático", () => {
    const view: AIModelsView = {
      plan: "FREE",
      preference: null,
      order: ["anthropic", "openai", "gemini", "xai"],
      limits: { maxOutputTokens: 1024, maxImages: 2, tiers: ["fast"] },
      providers: [
        {
          id: "openai",
          company: "OpenAI",
          assistant: "ChatGPT",
          configured: true,
          available: true,
          models: [
            { tier: "fast", model: "gpt-6-luna", allowed: true },
            { tier: "smart", model: "gpt-6.1-sol", allowed: false },
          ],
          capabilities: { images: true, pdf: true, tools: true, json: true },
        },
        {
          id: "anthropic",
          company: "Anthropic",
          assistant: "Claude",
          configured: false,
          available: false,
          models: [],
          capabilities: { images: true, pdf: true, tools: true, json: true },
        },
      ],
    };
    expect(planModelOf(view.providers[0])).toBe("gpt-6-luna");
    expect(planModelOf({ ...view.providers[0], models: view.providers[0].models.map((model) => ({ ...model, allowed: true })) })).toBe("gpt-6.1-sol");
    expect(planModelOf(view.providers[1])).toBeNull();
    // Claude va primero en el orden pero no tiene llave: en automático responde ChatGPT.
    expect(autoProviderOf(view)).toBe("openai");
    expect(autoProviderOf({ ...view, providers: [] })).toBeNull();
  });

  it("muestra cada modelo con el nombre que le da su proveedor", () => {
    expect(modelLabel("claude-haiku-4-5-20251001")).toBe("Claude Haiku 4.5");
    expect(modelLabel("claude-sonnet-5-5")).toBe("Claude Sonnet 5.5");
    expect(modelLabel("gpt-6-luna")).toBe("GPT-6 Luna");
    expect(modelLabel("gpt-6.1-sol")).toBe("GPT-6.1 Sol");
    expect(modelLabel("gemini-3.5-flash-lite")).toBe("Gemini 3.5 Flash-Lite");
    expect(modelLabel("gemini-3.8-flash")).toBe("Gemini 3.8 Flash");
    expect(modelLabel("grok-4.7")).toBe("Grok 4.7");
    // Un modelo configurado con otra forma se muestra tal cual.
    expect(modelLabel("mi-modelo-propio")).toBe("mi-modelo-propio");
  });

  it("lee la preferencia guardada en el perfil", () => {
    expect(preferredProviderOf({ ai: { provider: "gemini" } })).toBe("gemini");
    expect(preferredProviderOf({ ai: { provider: null } })).toBeNull();
    expect(preferredProviderOf({ ai: { provider: "llama" } })).toBeNull();
    expect(preferredProviderOf({ theme: "dark" })).toBeNull();
    expect(preferredProviderOf(null)).toBeNull();
    expect(preferredProviderOf("openai")).toBeNull();
  });
});
