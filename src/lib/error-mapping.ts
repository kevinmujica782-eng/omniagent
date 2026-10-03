// Traducción de cualquier error a { status, code, message }: pura, sin Next ni base de datos (se prueba sola).
import { ZodError } from "zod";
import { AppError } from "./errors";

export type Mapped = { status: number; code: string; message: string; details?: unknown; retryAfter?: number };

export function classify(error: unknown): Mapped {
  if (error instanceof AppError) {
    const retry = (error.details as { retryAfterSeconds?: number } | undefined)?.retryAfterSeconds;
    return { status: error.status, code: error.code, message: error.message, details: error.details, retryAfter: retry };
  }
  if (error instanceof ZodError) {
    return { status: 422, code: "validation_error", message: "Revisa los datos enviados.", details: error.issues };
  }
  const e = error as { name?: string; code?: unknown; status?: unknown; type?: unknown } | null;
  const code = typeof e?.code === "string" ? e.code : "";
  // Prisma: registro inexistente, llave duplicada o base de datos inaccesible.
  if (code === "P2025") return { status: 404, code: "not_found", message: "Ese registro ya no existe." };
  if (code === "P2002") return { status: 409, code: "conflict", message: "Eso ya existe." };
  // Base caída, saturada o lenta: P1000-P1002, P1008 (timeout), P1017 (cerró la conexión), P2024/P2037 (pool
  // lleno), errores de red de Node y los mensajes de pg al agotar connectionTimeoutMillis (ver src/lib/db.ts).
  const message = error instanceof Error ? error.message : "";
  if (
    /^P10(0[0-2]|08|17)$|^P20(24|37)$/.test(code) ||
    code === "ECONNREFUSED" ||
    code === "ETIMEDOUT" ||
    /timeout exceeded when trying to connect|Connection terminated (due to connection timeout|unexpectedly)/i.test(message)
  ) {
    return { status: 503, code: "database_unavailable", message: "No pudimos conectar con la base de datos. Inténtalo en unos segundos.", retryAfter: 5 };
  }
  // Anthropic: límite de tasa o servicio saturado.
  const name = e?.name ?? "";
  if (name === "RateLimitError" || name === "OverloadedError" || (name.endsWith("Error") && e?.status === 529)) {
    return { status: 503, code: "ai_busy", message: "Omni está con mucha demanda en este momento. Inténtalo en un minuto.", retryAfter: 30 };
  }
  if (name === "APIConnectionError" || name === "APIConnectionTimeoutError") {
    return { status: 503, code: "ai_unavailable", message: "No pudimos hablar con el servicio de IA. Inténtalo de nuevo.", retryAfter: 10 };
  }
  // Stripe: problemas de conexión o del servicio (los errores de tarjeta los maneja Checkout).
  if (typeof e?.type === "string" && e.type.startsWith("Stripe")) {
    return { status: 502, code: "payment_provider_error", message: "El proveedor de pagos no respondió. Inténtalo de nuevo." };
  }
  return { status: 500, code: "internal_error", message: "No pudimos completar la solicitud. Inténtalo de nuevo." };
}

