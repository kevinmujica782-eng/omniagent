// Router de IA: recibe un pedido normalizado (AIRequestPrompt), elige proveedor y modelo, y devuelve siempre la misma
// respuesta (AIResponse) o un AIProviderError normalizado. Puro: los proveedores, el reloj y la espera se inyectan.
//
// 1. Candidatos: el proveedor pedido primero y después el orden configurado; solo los que tienen llave y pueden
//    atender el pedido (imágenes, PDF, herramientas, JSON con esquema).
// 2. Cada candidato tiene hasta `attemptsPerProvider` intentos ante fallas pasajeras (red, tiempo, 429, 5xx), con
//    espera exponencial o la que pide el proveedor (Retry-After) si es corta.
// 3. Si el proveedor no responde, sigue el próximo (respaldo). Un pedido inválido, demasiado largo o bloqueado no se
//    prueba con otro: fallaría igual.
// 4. Cortacircuitos por proveedor: después de varias fallas seguidas pasa al final de la fila por un rato; sin cuota
//    o con la llave inválida, solo se usa si no queda otro.
// 5. Todo dentro de un plazo total; cada intento se corta con su propio tiempo o si quien pidió cancela.
import type { AIAttempt, AIErrorCode, AIProviderId, AIResponse, AIWarning } from "@/types/ai";
import { DEFAULT_PROVIDER_ORDER, MODEL_SPEC_BUILDERS, needsOf, unsupportedNeed } from "./ai.catalog";
import { AIProviderError, summarizeFailure, withAttempts } from "./ai.errors";
import { AttemptTimeout, abortError } from "./ai.http";
import { parseJsonText } from "./ai.schema";
import type { AIProviderState, AIRequestPrompt, ModelProvider, ModelSpec, ProviderResult } from "./ai.types";

export const DEFAULT_MAX_OUTPUT_TOKENS = 1024;
/** No se empieza un intento con menos tiempo que esto. */
const MIN_ATTEMPT_MS = 1_500;
const TOOL_NAME = /^[a-zA-Z0-9_-]{1,64}$/;

export interface AttemptEvent {
  provider: AIProviderId;
  model: string;
  ok: boolean;
  error: AIErrorCode | null;
  httpStatus: number | null;
  latencyMs: number;
  retryAfterMs: number | null;
  /** Lo que dijo el proveedor (para los logs). */
  detail: string | null;
}

export interface RouterOptions {
  providers: readonly ModelProvider[];
  /** Orden por defecto de los proveedores. */
  order?: readonly AIProviderId[];
  now?: () => number;
  /** Espera entre reintentos; termina antes si quien pidió cancela. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  random?: () => number;
  newId?: () => string;
  /** Intentos por proveedor ante fallas pasajeras (por defecto 2). */
  attemptsPerProvider?: number;
  /** Espera base del primer reintento (por defecto 500 ms; luego se duplica). */
  baseDelayMs?: number;
  /** El Retry-After más largo que se espera con el mismo proveedor; si piden más, se pasa al siguiente. */
  maxWaitMs?: number;
  /** Plazo total por defecto (por defecto 55 s: cabe en una función de 60 s). */
  defaultDeadlineMs?: number;
  breaker?: { threshold?: number; cooldownMs?: number; longCooldownMs?: number };
  onAttempt?: (event: AttemptEvent) => void;
}

export interface RoutedResult {
  response: AIResponse;
  /** Estado del proveedor para seguir una ronda de herramientas (va en el mensaje del asistente siguiente). */
  state: AIProviderState | null;
}

export interface Candidate {
  provider: ModelProvider;
  spec: ModelSpec;
}

export type BreakerStatus = "closed" | "open" | "hard";

/** Errores que no se arreglan en segundos: el proveedor queda al final por un rato largo. */
const HARD_FAILURES = new Set<AIErrorCode>(["quota_exceeded", "auth_failed", "model_not_found", "not_configured"]);

export class CircuitBreaker {
  private readonly states = new Map<AIProviderId, { failures: number; openUntil: number; hard: boolean }>();
  private readonly threshold: number;
  private readonly cooldownMs: number;
  private readonly longCooldownMs: number;

  constructor(opts: { threshold?: number; cooldownMs?: number; longCooldownMs?: number } = {}) {
    this.threshold = opts.threshold ?? 3;
    this.cooldownMs = opts.cooldownMs ?? 30_000;
    this.longCooldownMs = opts.longCooldownMs ?? 5 * 60_000;
  }

  status(provider: AIProviderId, now: number): BreakerStatus {
    const state = this.states.get(provider);
    if (!state || state.openUntil <= now) return "closed";
    return state.hard ? "hard" : "open";
  }

  openUntil(provider: AIProviderId): number | null {
    return this.states.get(provider)?.openUntil ?? null;
  }

  success(provider: AIProviderId): void {
    this.states.delete(provider);
  }

  failure(provider: AIProviderId, error: AIProviderError, now: number): void {
    const current = this.states.get(provider) ?? { failures: 0, openUntil: 0, hard: false };
    if (HARD_FAILURES.has(error.code)) {
      this.states.set(provider, { failures: current.failures + 1, openUntil: now + this.longCooldownMs, hard: true });
      return;
    }
    // Un pedido inválido o cancelado no es culpa del proveedor.
    if (!error.retryable) return;
    const failures = current.failures + 1;
    let openUntil = current.openUntil;
    if (failures >= this.threshold) openUntil = Math.max(openUntil, now + this.cooldownMs);
    if (error.code === "rate_limited" && error.retryAfterMs) openUntil = Math.max(openUntil, now + Math.min(error.retryAfterMs, this.longCooldownMs));
    this.states.set(provider, { failures, openUntil, hard: false });
  }
}

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const done = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal?.addEventListener("abort", done, { once: true });
  });
}

/** Texto hasta la primera secuencia de corte (null si no aparece ninguna). */
export function cutAtStop(text: string, stops: readonly string[]): string | null {
  const positions = stops.filter(Boolean).map((stop) => text.indexOf(stop)).filter((index) => index >= 0);
  return positions.length ? text.slice(0, Math.min(...positions)) : null;
}

/** Revisa lo mínimo que todo proveedor exige; si falla, el pedido es inválido para todos. */
export function validateRequest(request: AIRequestPrompt): void {
  const invalid = (detail: string) => new AIProviderError("invalid_request", { detail });
  if (request.messages.length === 0) throw invalid("El pedido no tiene mensajes.");
  const last = request.messages.at(-1);
  if (last?.role === "assistant") throw invalid("El último mensaje debe ser de la persona o el resultado de una herramienta.");
  const names = new Set<string>();
  for (const tool of request.tools ?? []) {
    if (!TOOL_NAME.test(tool.name)) throw invalid(`Nombre de herramienta inválido: ${tool.name}`);
    if (names.has(tool.name)) throw invalid(`Herramienta repetida: ${tool.name}`);
    names.add(tool.name);
  }
  const choice = request.toolChoice;
  if (choice && typeof choice === "object" && !names.has(choice.name)) throw invalid(`No existe la herramienta ${choice.name}.`);
  if (request.maxOutputTokens !== undefined && (!Number.isInteger(request.maxOutputTokens) || request.maxOutputTokens < 1)) {
    throw invalid("maxOutputTokens debe ser un entero positivo.");
  }
}

export class AIRouter {
  private readonly byId: Map<AIProviderId, ModelProvider>;
  private readonly order: readonly AIProviderId[];
  private readonly now: () => number;
  private readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  private readonly random: () => number;
  private readonly newId: () => string;
  private readonly attemptsPerProvider: number;
  private readonly baseDelayMs: number;
  private readonly maxWaitMs: number;
  private readonly defaultDeadlineMs: number;
  private readonly onAttempt?: (event: AttemptEvent) => void;
  readonly breaker: CircuitBreaker;

  constructor(options: RouterOptions) {
    this.byId = new Map(options.providers.map((provider) => [provider.id, provider]));
    const order = options.order ?? DEFAULT_PROVIDER_ORDER;
    this.order = [...new Set([...order, ...options.providers.map((provider) => provider.id)])];
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? defaultSleep;
    this.random = options.random ?? Math.random;
    this.newId = options.newId ?? (() => globalThis.crypto.randomUUID());
    this.attemptsPerProvider = Math.max(1, options.attemptsPerProvider ?? 2);
    this.baseDelayMs = options.baseDelayMs ?? 500;
    this.maxWaitMs = options.maxWaitMs ?? 4_000;
    this.defaultDeadlineMs = options.defaultDeadlineMs ?? 55_000;
    this.onAttempt = options.onAttempt;
    this.breaker = new CircuitBreaker(options.breaker);
  }

  /** Proveedores con llave, en el orden del router. */
  configured(): AIProviderId[] {
    return this.order.filter((id) => this.byId.get(id)?.isConfigured());
  }

  provider(id: AIProviderId): ModelProvider | undefined {
    return this.byId.get(id);
  }

  /** Orden por defecto (con los no configurados). */
  providerOrder(): readonly AIProviderId[] {
    return this.order;
  }

  /** Estado del cortacircuitos de cada proveedor. */
  breakerStatus(id: AIProviderId): BreakerStatus {
    return this.breaker.status(id, this.now());
  }

  /** Quiénes pueden atender el pedido, en el orden en que se intentarían. */
  candidates(request: AIRequestPrompt): Candidate[] {
    const tier = request.tier ?? "fast";
    const needs = needsOf(request);
    const allowed = request.providers?.length ? request.providers : this.order;
    const ids = [...new Set(request.provider ? [request.provider, ...allowed] : allowed)];
    const list: Candidate[] = [];
    for (const id of ids) {
      const provider = this.byId.get(id);
      if (!provider?.isConfigured()) {
        if (id === request.provider && request.fallback === false) {
          throw new AIProviderError("not_configured", { provider: id, detail: "Ese proveedor no tiene llave en este entorno." });
        }
        continue;
      }
      const base = provider.models().find((model) => model.tier === tier) ?? provider.models()[0];
      if (!base) continue;
      const spec = id === request.provider && request.model && request.model !== base.id ? MODEL_SPEC_BUILDERS[id](request.model, tier) : base;
      const missing = unsupportedNeed(spec, needs);
      if (missing) {
        if (id === request.provider && request.fallback === false) {
          throw new AIProviderError("invalid_request", { provider: id, detail: `El modelo ${spec.id} ${missing}.` });
        }
        continue;
      }
      list.push({ provider, spec });
    }
    if (request.fallback === false) return list.slice(0, 1);
    // Los que fallaron hace poco van al final; los que no tienen cuota o llave válida, solo si no queda otro.
    const now = this.now();
    const closed = list.filter((candidate) => this.breaker.status(candidate.provider.id, now) === "closed");
    const open = list.filter((candidate) => this.breaker.status(candidate.provider.id, now) === "open");
    const usable = [...closed, ...open];
    return usable.length ? usable : list;
  }

  async complete(request: AIRequestPrompt): Promise<RoutedResult> {
    validateRequest(request);
    const started = this.now();
    const deadline = started + (request.deadlineMs ?? this.defaultDeadlineMs);
    const candidates = this.candidates(request);
    if (candidates.length === 0) {
      const anyConfigured = this.configured().length > 0;
      throw new AIProviderError(anyConfigured ? "invalid_request" : "not_configured", {
        detail: anyConfigured ? "Ningún proveedor configurado puede atender este pedido (imágenes, PDF o herramientas)." : "No hay proveedores de IA configurados.",
      });
    }
    const firstChoice = request.provider ?? candidates[0].provider.id;
    const attempts: AIAttempt[] = [];
    const errors: AIProviderError[] = [];

    for (const candidate of candidates) {
      const id = candidate.provider.id;
      for (let attempt = 1; attempt <= this.attemptsPerProvider; attempt++) {
        if (request.signal?.aborted) throw withAttempts(abortError(id, request.signal), attempts);
        const remaining = deadline - this.now();
        if (remaining < MIN_ATTEMPT_MS) {
          if (errors.length === 0) errors.push(new AIProviderError("timeout", { provider: id, detail: "Se acabó el plazo del pedido." }));
          throw summarizeFailure(attempts, errors);
        }
        const timeoutMs = Math.min(request.timeoutMs ?? candidate.spec.timeoutMs, remaining);
        const startedAttempt = this.now();
        try {
          const result = await this.attempt(candidate, request, timeoutMs);
          const response = this.normalize(candidate, request, result);
          const latencyMs = this.now() - startedAttempt;
          attempts.push({ provider: id, model: candidate.spec.id, ok: true, error: null, latencyMs });
          this.breaker.success(id);
          this.emit({ provider: id, model: candidate.spec.id, ok: true, error: null, httpStatus: null, latencyMs, retryAfterMs: null, detail: null });
          return {
            response: { ...response, attempts, latencyMs: this.now() - started, fallback: id !== firstChoice },
            state: result.state,
          };
        } catch (error) {
          const failure = error instanceof AIProviderError ? error : new AIProviderError("bad_response", { provider: id, detail: String(error), cause: error });
          const latencyMs = this.now() - startedAttempt;
          attempts.push({ provider: id, model: candidate.spec.id, ok: false, error: failure.code, latencyMs });
          errors.push(failure);
          this.breaker.failure(id, failure, this.now());
          this.emit({
            provider: id,
            model: candidate.spec.id,
            ok: false,
            error: failure.code,
            httpStatus: failure.httpStatus,
            latencyMs,
            retryAfterMs: failure.retryAfterMs,
            detail: failure.detail || null,
          });
          // Cancelado, inválido, demasiado largo o bloqueado: otro intento u otro proveedor no lo arreglan.
          if (failure.code === "aborted" || !failure.canFallback) throw withAttempts(failure, attempts);
          if (failure.retryable && attempt < this.attemptsPerProvider) {
            const wait = this.backoff(attempt, failure.retryAfterMs);
            if (wait !== null && this.now() + wait + MIN_ATTEMPT_MS < deadline) {
              await this.sleep(wait, request.signal);
              continue;
            }
          }
          break;
        }
      }
    }
    throw summarizeFailure(attempts, errors);
  }

  /** Espera antes de reintentar con el mismo proveedor (null: mejor pasar al siguiente). */
  private backoff(attempt: number, retryAfterMs: number | null): number | null {
    if (retryAfterMs !== null) return retryAfterMs <= this.maxWaitMs ? retryAfterMs : null;
    const base = this.baseDelayMs * 2 ** (attempt - 1);
    return Math.round(base / 2 + (this.random() * base) / 2);
  }

  /** Un intento con su propio tiempo; se corta también si quien pidió cancela. */
  private async attempt(candidate: Candidate, request: AIRequestPrompt, timeoutMs: number): Promise<ProviderResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new AttemptTimeout(timeoutMs)), timeoutMs);
    const forward = () => controller.abort(request.signal?.reason ?? new Error("Cancelado"));
    if (request.signal?.aborted) forward();
    else request.signal?.addEventListener("abort", forward, { once: true });
    const maxOutputTokens = Math.min(
      candidate.spec.maxOutputTokens,
      (request.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS) + candidate.spec.reasoningReserveTokens,
    );
    try {
      const pending = candidate.provider.generate({ model: candidate.spec, request, maxOutputTokens, signal: controller.signal });
      // Si un adaptador no respeta el corte, el router no se queda esperando.
      const cut = new Promise<never>((_, reject) => {
        const onAbort = () => reject(abortError(candidate.provider.id, controller.signal));
        if (controller.signal.aborted) onAbort();
        else controller.signal.addEventListener("abort", onAbort, { once: true });
      });
      pending.catch(() => undefined);
      cut.catch(() => undefined);
      return await Promise.race([pending, cut]);
    } finally {
      clearTimeout(timer);
      request.signal?.removeEventListener("abort", forward);
    }
  }

  /** La respuesta del adaptador en la forma de la app: avisos, corte de texto y JSON ya leído. */
  private normalize(candidate: Candidate, request: AIRequestPrompt, result: ProviderResult): AIResponse {
    const id = candidate.provider.id;
    const caps = candidate.spec.capabilities;
    const warnings = new Set<AIWarning>(result.warnings);
    if (request.temperature !== undefined && !caps.temperature) warnings.add("temperature_ignored");
    if (request.reasoning && !caps.reasoningEffort) warnings.add("reasoning_ignored");

    let text = result.text;
    let finishReason = result.finishReason;
    if (request.stop?.length && !caps.stop) {
      warnings.add("stop_emulated");
      const cut = cutAtStop(text, request.stop);
      if (cut !== null) {
        text = cut;
        finishReason = "stop";
      }
    }

    let json: unknown = null;
    if (request.responseFormat?.type === "json" && finishReason !== "content_filter" && result.toolCalls.length === 0) {
      if (result.json !== undefined) {
        json = result.json;
      } else {
        const parsed = parseJsonText(text);
        if (!parsed.ok) {
          const truncated = finishReason === "length";
          throw new AIProviderError("bad_response", {
            provider: id,
            detail: truncated ? "El JSON quedó cortado por el máximo de tokens." : "La respuesta no es JSON válido.",
            // Cortado por el máximo: repetir lo mismo con el mismo proveedor daría lo mismo.
            ...(truncated ? { retryable: false } : {}),
          });
        }
        json = parsed.value;
      }
    }

    return {
      id: this.newId(),
      object: "ai.response",
      provider: id,
      model: result.model,
      tier: candidate.spec.tier,
      text,
      json,
      toolCalls: result.toolCalls,
      finishReason,
      usage: result.usage,
      latencyMs: 0,
      fallback: false,
      attempts: [],
      warnings: [...warnings],
      createdAt: new Date(this.now()).toISOString(),
    };
  }

  private emit(event: AttemptEvent): void {
    try {
      this.onAttempt?.(event);
    } catch {
      // Un log que falla no cambia la respuesta.
    }
  }
}
