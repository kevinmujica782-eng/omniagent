// Bucle de herramientas del agente sobre el router de IA: pide la respuesta, ejecuta las herramientas que pida el
// modelo y le devuelve sus resultados, hasta que responde o se acaban las rondas o el tiempo del turno. Sin base de
// datos ni Next: quien llama ejecuta cada herramienta (y guarda lo que haga falta), así se prueba con proveedores
// simulados.
import { AIProviderError } from "@/modules/ai/ai.errors";
import type { RoutedResult } from "@/modules/ai/ai.router";
import type { AIMessage, AIRequestPrompt, AISystemPart, AIToolCall, AIToolDefinition } from "@/modules/ai/ai.types";
import type { AIErrorCode, AIProviderId, AITier } from "@/types/ai";
import type { AgentCard } from "@/types/cards";

/** Lo que devuelve una herramienta: datos para el modelo y, para la persona, tarjetas y preguntas sugeridas. */
export interface ToolOutcome {
  data: unknown;
  isError: boolean;
  cards?: AgentCard[];
  suggestions?: string[];
}

export interface ToolLoopInput {
  /** El router (aiRouter().complete) o uno simulado. */
  complete: (request: AIRequestPrompt) => Promise<RoutedResult>;
  system: readonly AISystemPart[];
  /** Historia y el mensaje nuevo de la persona (el último). */
  messages: readonly AIMessage[];
  tools: readonly AIToolDefinition[];
  tier: AITier;
  /**
   * A quién se le pide la respuesta (ver `resolveProvider`): el modelo que eligió la persona o el primero del orden. Si
   * responde otro, ese es el que falló (`fallbackFrom`). null: decide el router.
   */
  provider: AIProviderId | null;
  maxOutputTokens: number;
  /** Rondas de herramientas antes de pedirle que lo divida. */
  maxRounds: number;
  /** Momento límite del turno (ms desde 1970): la ruta tiene 60 s. */
  deadline: number;
  now?: () => number;
  execute: (call: AIToolCall) => Promise<ToolOutcome>;
}

/** Consumo de un modelo en el turno (si respondió más de uno, cada uno con lo suyo). */
export interface ModelUsage {
  provider: AIProviderId;
  model: string;
  input: number;
  output: number;
  cached: number;
}

export interface ToolLoopResult {
  text: string;
  cards: AgentCard[];
  suggestions: string[];
  /** Total del turno. */
  usage: { input: number; output: number; cached: number };
  /** Por modelo, en el orden en que respondieron. */
  usageByModel: ModelUsage[];
  toolCalls: number;
  /** Quién respondió la última ronda. */
  provider: AIProviderId;
  model: string;
  /** Si respondió otro porque el que se pidió falló: cuál se pidió. */
  fallbackFrom: AIProviderId | null;
  /** El turno quedó a medias después de ejecutar herramientas (sin tiempo o sin modelo que respondiera). */
  interrupted: AIErrorCode | null;
}

/** Con menos tiempo que esto no se empieza otra ronda: no alcanzaría para una respuesta y se cobraría igual. */
const MIN_ROUND_MS = 6_000;

/**
 * A quién pedirle la respuesta. `requested`: el modelo que eligió la persona, si tiene llave (si se la quitaron,
 * responde el automático). `expected`: ese o, en automático, el primero del orden con llave; si responde otro, el
 * chat dice que este no estaba disponible.
 */
export function resolveProvider(
  configured: readonly AIProviderId[],
  preferred: AIProviderId | null,
): { requested: AIProviderId | null; expected: AIProviderId | null } {
  const requested = preferred && configured.includes(preferred) ? preferred : null;
  return { requested, expected: requested ?? configured[0] ?? null };
}

export async function runToolLoop(input: ToolLoopInput): Promise<ToolLoopResult> {
  const now = input.now ?? Date.now;
  const messages: AIMessage[] = [...input.messages];
  const cards: AgentCard[] = [];
  let suggestions: string[] = [];
  const usageByModel: ModelUsage[] = [];
  let toolCalls = 0;
  let provider = input.provider;
  let answered: { provider: AIProviderId; model: string } | null = null;
  let fallbackFrom: AIProviderId | null = null;
  let interrupted: AIErrorCode | null = null;
  let text = "";

  for (let round = 0; ; round++) {
    const remaining = input.deadline - now();
    if (remaining < MIN_ROUND_MS) {
      if (!answered) throw new AIProviderError("timeout", { detail: "No quedó tiempo para responder en este turno." });
      // Ya corrieron herramientas (sus tarjetas se muestran), pero no hay tiempo para la respuesta final.
      text = "Avancé con lo que alcancé, pero se me acabó el tiempo para terminar. ¿Lo retomamos desde aquí?";
      interrupted = "timeout";
      break;
    }
    const asked = provider;
    let routed: RoutedResult;
    try {
      routed = await input.complete({
        system: input.system,
        messages,
        tools: input.tools,
        tier: input.tier,
        ...(asked ? { provider: asked } : {}),
        maxOutputTokens: input.maxOutputTokens,
        deadlineMs: remaining,
      });
    } catch (error) {
      // Si ya corrieron herramientas, lo que hicieron (y sus tarjetas) vale: se responde con eso en vez de perderlo.
      if (!(error instanceof AIProviderError) || !answered || toolCalls === 0) throw error;
      text = "Avancé con lo que alcancé, pero no pude terminar la respuesta. ¿Lo retomamos desde aquí?";
      interrupted = error.code;
      break;
    }
    const { response, state } = routed;
    addUsage(usageByModel, response.provider, response.model, response.usage);
    // Respondió otro que el pedido: el pedido falló o el router lo apartó (sin cuota, fallando seguido). Sin pedido
    // (decide el router), cuenta el primero que intentó.
    if (fallbackFrom === null) {
      const expected = asked ?? response.attempts[0]?.provider ?? null;
      if (expected && expected !== response.provider) fallbackFrom = expected;
    }
    answered = { provider: response.provider, model: response.model };
    // Las rondas siguientes van al mismo proveedor: su estado (razonamiento, firmas) solo le sirve a él. Si falla, el
    // router sigue con otro.
    provider = response.provider;
    text = response.text.trim();

    const pending = response.finishReason === "tool_calls" ? response.toolCalls : [];
    if (pending.length === 0) break;
    if (round >= input.maxRounds) {
      text = text || "Esto necesita más pasos de los que puedo dar de una vez. ¿Lo dividimos?";
      break;
    }

    messages.push({ role: "assistant", content: response.text, toolCalls: pending, state });
    for (const call of pending) {
      toolCalls += 1;
      const outcome = await input.execute(call);
      if (outcome.cards?.length) cards.push(...outcome.cards);
      if (outcome.suggestions?.length) suggestions = outcome.suggestions.slice(0, 3);
      messages.push({ role: "tool", toolCallId: call.id, name: call.name, content: JSON.stringify(outcome.data ?? null), isError: outcome.isError });
    }
  }

  if (!answered) throw new AIProviderError("bad_response", { detail: "El turno terminó sin respuesta." });
  const usage = usageByModel.reduce(
    (total, entry) => ({ input: total.input + entry.input, output: total.output + entry.output, cached: total.cached + entry.cached }),
    { input: 0, output: 0, cached: 0 },
  );
  return { text, cards, suggestions, usage, usageByModel, toolCalls, provider: answered.provider, model: answered.model, fallbackFrom, interrupted };
}

function addUsage(
  list: ModelUsage[],
  provider: AIProviderId,
  model: string,
  usage: { inputTokens: number; outputTokens: number; cachedInputTokens: number },
): void {
  let entry = list.find((item) => item.provider === provider && item.model === model);
  if (!entry) {
    entry = { provider, model, input: 0, output: 0, cached: 0 };
    list.push(entry);
  }
  entry.input += usage.inputTokens;
  entry.output += usage.outputTokens;
  entry.cached += usage.cachedInputTokens;
}
