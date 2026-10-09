// HTTP común de los adaptadores: POST con JSON, corte por tiempo (AbortSignal) y lectura de las cabeceras de espera.
// Las fallas de red, de tiempo y las cancelaciones salen ya como AIProviderError. Sin SDK: cada adaptador llama a la
// API oficial de su proveedor con fetch, así todos fallan, esperan y se cortan de la misma forma.
import type { AIProviderId } from "@/types/ai";
import { AIProviderError } from "./ai.errors";

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

/** Motivo con el que el router corta un intento que se pasó de su tiempo (distingue tiempo agotado de cancelación). */
export class AttemptTimeout extends Error {
  readonly ms: number;

  constructor(ms: number) {
    super(`Pasaron ${ms} ms sin respuesta del proveedor.`);
    this.name = "AttemptTimeout";
    this.ms = ms;
  }
}

export interface JsonReply {
  status: number;
  headers: Headers;
  /** El cuerpo ya leído como JSON (null si no era JSON). */
  body: unknown;
  raw: string;
}

/** Error de un intento cortado: por su tiempo (`timeout`) o porque quien pidió canceló (`aborted`). */
export function abortError(provider: AIProviderId, signal: AbortSignal, cause?: unknown): AIProviderError {
  if (signal.reason instanceof AttemptTimeout) {
    return new AIProviderError("timeout", { provider, detail: signal.reason.message, cause: cause ?? signal.reason });
  }
  return new AIProviderError("aborted", { provider, detail: "Cancelado por quien pidió la respuesta.", cause: cause ?? signal.reason });
}

/** Mensaje corto de una falla de red de Node (sin la pila). */
function networkDetail(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause = (error as { cause?: unknown }).cause;
  const code = typeof cause === "object" && cause !== null ? (cause as { code?: unknown }).code : undefined;
  return [error.message, typeof code === "string" ? code : null].filter(Boolean).join(" · ");
}

export async function postJson(input: {
  provider: AIProviderId;
  url: string;
  headers: Record<string, string>;
  body: unknown;
  signal: AbortSignal;
  fetch: FetchLike;
}): Promise<JsonReply> {
  const { provider, signal } = input;
  if (signal.aborted) throw abortError(provider, signal);
  let response: Response;
  let raw: string;
  try {
    response = await input.fetch(input.url, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json", ...input.headers },
      body: JSON.stringify(input.body),
      signal,
    });
    raw = await response.text();
  } catch (error) {
    if (signal.aborted) throw abortError(provider, signal, error);
    throw new AIProviderError("network_error", { provider, detail: networkDetail(error), cause: error });
  }
  let body: unknown = null;
  if (raw) {
    try {
      body = JSON.parse(raw);
    } catch {
      body = null;
    }
  }
  return { status: response.status, headers: response.headers, body, raw };
}

/** `Retry-After`: segundos o una fecha HTTP → milisegundos. */
export function parseRetryAfter(value: string | null | undefined, now = Date.now()): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^\d+(\.\d+)?$/.test(trimmed)) return Math.round(Number(trimmed) * 1000);
  const date = Date.parse(trimmed);
  return Number.isNaN(date) ? null : Math.max(0, date - now);
}

const DURATION_UNITS: Record<string, number> = { h: 3_600_000, m: 60_000, s: 1000, ms: 1, us: 0.001, µs: 0.001, ns: 0.000001 };

/** Duración al estilo Go ("1s", "6m0s", "250ms", "1.5s"), como la mandan OpenAI y Google → milisegundos. */
export function parseDuration(value: string | null | undefined): number | null {
  if (!value) return null;
  const parts = [...value.trim().matchAll(/(\d+(?:\.\d+)?)(ms|us|µs|ns|h|m|s)/g)];
  if (parts.length === 0) return null;
  return Math.round(parts.reduce((total, [, amount, unit]) => total + Number(amount) * (DURATION_UNITS[unit] ?? 0), 0));
}

/** Lo que dijo el proveedor en su error, sea `{ error: { message } }`, `{ error: "..." }` o `{ message }`. */
export function errorMessageOf(body: unknown, raw: string): string {
  if (body && typeof body === "object") {
    const record = body as { error?: unknown; message?: unknown };
    if (typeof record.error === "string") return record.error;
    if (record.error && typeof record.error === "object") {
      const message = (record.error as { message?: unknown }).message;
      if (typeof message === "string") return message;
    }
    if (typeof record.message === "string") return record.message;
  }
  return raw.replace(/\s+/g, " ").trim().slice(0, 300);
}

// ── Lectura de respuestas ────────────────────────────────────────────────────

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Un número de la respuesta (0 si falta o no es número). */
export const numberOf = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? value : 0);

/** Base64 dentro de una URL data: (OpenAI y xAI reciben así las imágenes y los PDF). */
export function dataUrl(mediaType: string, base64: string): string {
  return `data:${mediaType};base64,${base64}`;
}

/** Argumentos de una herramienta que llegan como texto JSON (OpenAI, xAI). */
export function parseToolArguments(provider: AIProviderId, text: unknown): Record<string, unknown> {
  if (text && typeof text === "object" && !Array.isArray(text)) return text as Record<string, unknown>;
  if (typeof text !== "string" || text.trim() === "") return {};
  try {
    const parsed = JSON.parse(text) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch {
    // Abajo: el modelo devolvió argumentos que no son JSON.
  }
  throw new AIProviderError("bad_response", { provider, detail: "Argumentos de herramienta que no son un objeto JSON." });
}
