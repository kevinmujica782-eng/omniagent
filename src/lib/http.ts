import "server-only";
import { NextResponse } from "next/server";
import { getAuthContext, type AuthContext } from "./auth";
import { AppError } from "./errors";
import { classify } from "./error-mapping";
import { log } from "./log";

/** Id de la solicitud: el que manda el cliente o el proxy (x-request-id) o uno nuevo. Viaja en logs y respuestas. */
export function requestIdOf(request: Request): string {
  const incoming = request.headers.get("x-request-id") ?? request.headers.get("x-vercel-id");
  return incoming && /^[\w.:-]{6,128}$/.test(incoming) ? incoming : crypto.randomUUID();
}

function routeOf(request: Request): string {
  try {
    return new URL(request.url).pathname;
  } catch {
    return "?";
  }
}

/** Envoltorio para Route Handlers autenticados: respuesta { data } o { error } con código HTTP e id de solicitud. */
export async function handle<T>(request: Request, fn: (auth: AuthContext) => Promise<T>): Promise<Response> {
  const requestId = requestIdOf(request);
  let userId: string | undefined;
  try {
    const auth = await getAuthContext(request);
    userId = auth.userId;
    const data = await fn(auth);
    const response = NextResponse.json({ data });
    response.headers.set("x-request-id", requestId);
    return response;
  } catch (error) {
    return errorResponse(error, { requestId, route: `${request.method} ${routeOf(request)}`, userId });
  }
}

type ErrorContext = { requestId?: string; route?: string; userId?: string };

export { classify };

/**
 * Traduce cualquier error a una respuesta JSON estable: { error: { code, message, details, requestId } }.
 * Los errores de la app se muestran tal cual; los de infraestructura (base de datos, Stripe, Anthropic)
 * se convierten en mensajes útiles sin filtrar detalles internos (ver error-mapping.ts).
 */
export function errorResponse(error: unknown, ctx: ErrorContext = {}): Response {
  const requestId = ctx.requestId ?? crypto.randomUUID();
  const mapped = classify(error);
  if (mapped.status >= 500) {
    log.error("api.error", { requestId, route: ctx.route, userId: ctx.userId, status: mapped.status, code: mapped.code, error });
  } else if (mapped.status !== 401 && mapped.status !== 404) {
    log.info("api.rejected", { requestId, route: ctx.route, status: mapped.status, code: mapped.code });
  }
  const response = NextResponse.json(
    { error: { code: mapped.code, message: mapped.message, details: mapped.details ?? null, requestId } },
    { status: mapped.status },
  );
  response.headers.set("x-request-id", requestId);
  if (mapped.retryAfter) response.headers.set("Retry-After", String(mapped.retryAfter));
  return response;
}

/** Lee el cuerpo JSON con tope de tamaño (1 MB por defecto; las rutas con imágenes piden más). */
export async function readJson<T>(request: Request, schema: { parse(value: unknown): T }, opts: { maxBytes?: number } = {}): Promise<T> {
  const maxBytes = opts.maxBytes ?? 1_000_000;
  const tooLarge = () => new AppError(413, "payload_too_large", "La solicitud es demasiado grande.");
  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > maxBytes) throw tooLarge();
  let text: string;
  try {
    text = await request.text();
  } catch {
    throw new AppError(400, "invalid_json", "El cuerpo de la solicitud debe ser JSON válido.");
  }
  // Sin content-length (envío por partes) el tope se revisa con lo que llegó.
  if (text.length > maxBytes) throw tooLarge();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new AppError(400, "invalid_json", "El cuerpo de la solicitud debe ser JSON válido.");
  }
  return schema.parse(body);
}
