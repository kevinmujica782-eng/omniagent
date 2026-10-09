// Dobles del router de IA para las pruebas: un fetch que responde lo que se le indica (y guarda lo que recibió) y un
// proveedor con respuestas programadas. Sin red.
import type { AIProviderError } from "@/modules/ai/ai.errors";
import type { FetchLike } from "@/modules/ai/ai.http";
import type { AIProviderId, AIRequestPrompt, ModelProvider, ModelSpec, ProviderCall, ProviderResult } from "@/modules/ai/ai.types";
import { EMPTY_USAGE } from "@/modules/ai/ai.types";

export interface FakeReply {
  status?: number;
  body?: unknown;
  /** Cuerpo tal cual (para respuestas que no son JSON). */
  raw?: string;
  headers?: Record<string, string>;
}

export interface SentRequest {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

/** fetch simulado: cada llamada usa la próxima respuesta (o lanza el error indicado). */
export function fakeFetch(replies: (FakeReply | Error)[]): { fetch: FetchLike; sent: SentRequest[] } {
  const sent: SentRequest[] = [];
  const queue = [...replies];
  const fetch: FetchLike = async (url, init) => {
    sent.push({
      url,
      headers: Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>)),
      body: JSON.parse(String(init.body)) as Record<string, unknown>,
    });
    const next = queue.shift();
    if (!next) throw new Error("La prueba no programó más respuestas.");
    if (next instanceof Error) throw next;
    return new Response(next.raw ?? JSON.stringify(next.body ?? {}), {
      status: next.status ?? 200,
      headers: { "content-type": "application/json", ...next.headers },
    });
  };
  return { fetch, sent };
}

/** fetch que no responde hasta que cortan el pedido (para probar tiempos y cancelaciones). */
export const hangingFetch: FetchLike = (_url, init) =>
  new Promise((_resolve, reject) => {
    init.signal?.addEventListener("abort", () => reject(init.signal?.reason ?? new Error("abort")), { once: true });
  });

/** Un pedido listo para un adaptador. */
export function callFor(spec: ModelSpec, request: Partial<AIRequestPrompt> = {}, maxOutputTokens = 1000): ProviderCall {
  return {
    model: spec,
    request: { messages: [{ role: "user", content: "Hola" }], ...request },
    maxOutputTokens,
    signal: new AbortController().signal,
  };
}

export function result(partial: Partial<ProviderResult> = {}): ProviderResult {
  return {
    model: "modelo",
    text: "Listo.",
    toolCalls: [],
    finishReason: "stop",
    usage: { ...EMPTY_USAGE, inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    state: null,
    warnings: [],
    ...partial,
  };
}

type Step = ProviderResult | AIProviderError | ((call: ProviderCall) => Promise<ProviderResult>);

/** Proveedor con respuestas en orden; guarda cada pedido que recibió. */
export function fakeProvider(
  id: AIProviderId,
  models: ModelSpec[],
  steps: Step[],
  opts: { configured?: boolean } = {},
): ModelProvider & { calls: ProviderCall[] } {
  const queue = [...steps];
  const calls: ProviderCall[] = [];
  return {
    id,
    calls,
    isConfigured: () => opts.configured ?? true,
    models: () => models,
    async generate(call) {
      calls.push(call);
      const step = queue.shift();
      if (!step) throw new Error(`${id}: la prueba no programó más respuestas.`);
      if (typeof step === "function") return step(call);
      if (step instanceof Error) throw step;
      return { ...step, model: step.model === "modelo" ? call.model.id : step.model };
    },
  };
}
