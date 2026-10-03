// Llamadas a /api/v1 desde componentes cliente: desempaqueta { data } y convierte { error } en ApiError.
import { requestUpgrade } from "./upgrade";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string | null;
  readonly details: unknown;
  readonly requestId: string | null;

  constructor(status: number, code: string | null, message: string, details: unknown = null, requestId: string | null = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
    this.requestId = requestId;
  }
}

type ErrorBody = { error?: { code?: string; message?: string; details?: unknown; requestId?: string } };

async function send(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ApiError(0, "network", "Sin conexión. Revisa tu internet e inténtalo de nuevo.");
  }
}

export async function apiFetch<T>(
  url: string,
  init: { method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  const method = init.method ?? "GET";
  const res = await send(url, {
    method,
    headers: method === "GET" ? undefined : { "Content-Type": "application/json" },
    body: method === "GET" ? undefined : JSON.stringify(init.body ?? {}),
    signal: init.signal,
  });
  return unwrap<T>(res);
}

/** Subida de archivos (multipart/form-data, el navegador pone el boundary). Mismos errores que apiFetch. */
export async function apiUpload<T>(url: string, form: FormData, init: { signal?: AbortSignal } = {}): Promise<T> {
  return unwrap<T>(await send(url, { method: "POST", body: form, signal: init.signal }));
}

async function unwrap<T>(res: Response): Promise<T> {
  const json = (await res.json().catch(() => null)) as ({ data?: T } & ErrorBody) | null;
  if (!res.ok) {
    const error = new ApiError(
      res.status,
      json?.error?.code ?? null,
      json?.error?.message ?? (res.status >= 500 ? "El servicio no respondió. Inténtalo de nuevo en un momento." : "No se pudo completar. Inténtalo de nuevo."),
      json?.error?.details ?? null,
      json?.error?.requestId ?? res.headers.get("x-request-id"),
    );
    // Límite del plan Gratis: además del mensaje en el lugar del error, se ofrece Pro en una hoja.
    const details = error.details as { plan?: string; feature?: string; reason?: string } | null;
    if (error.code === "plan_limit" && details?.plan === "FREE") {
      requestUpgrade({ reason: error.message, feature: details.feature ?? null, limit: details.reason ?? null });
    }
    throw error;
  }
  return json?.data as T;
}

export function errorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : "Algo salió mal. Inténtalo de nuevo.";
}

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
