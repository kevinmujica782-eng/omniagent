// Logs estructurados: en producción, una línea JSON por evento (Vercel, Docker y la mayoría de colectores
// los indexan solos); en desarrollo, texto legible. Los campos sensibles se ocultan antes de escribir.
// Sin dependencias de Node: también funciona en el proxy (Edge).

type Level = "debug" | "info" | "warn" | "error";
export type LogFields = Record<string, unknown>;

const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const SENSITIVE_KEY = /(authorization|cookie|password|passwd|secret|token|api[-_]?key|signature|card|cvc|iban|account[-_]?number|email|phone)/i;
const MAX_DEPTH = 4;
const MAX_STRING = 2_000;

function configuredLevel(): Level {
  const value = (process.env.LOG_LEVEL ?? "").toLowerCase();
  if (value === "debug" || value === "info" || value === "warn" || value === "error") return value;
  return process.env.NODE_ENV === "production" ? "info" : "debug";
}

function useJson(): boolean {
  if (process.env.LOG_FORMAT === "json") return true;
  if (process.env.LOG_FORMAT === "pretty") return false;
  return process.env.NODE_ENV === "production";
}

/** Error → objeto serializable (sin la pila en producción, para no filtrar rutas internas en colectores externos). */
export function serializeError(error: unknown): LogFields {
  if (error instanceof Error) {
    const extra = error as Error & { code?: unknown; status?: unknown; digest?: unknown; type?: unknown };
    return {
      name: error.name,
      message: error.message.slice(0, MAX_STRING),
      ...(extra.code !== undefined ? { code: extra.code } : {}),
      ...(typeof extra.status === "number" ? { status: extra.status } : {}),
      ...(typeof extra.type === "string" ? { type: extra.type } : {}),
      ...(extra.digest !== undefined ? { digest: extra.digest } : {}),
      ...(process.env.NODE_ENV !== "production" && error.stack ? { stack: error.stack.split("\n").slice(0, 8).join("\n") } : {}),
    };
  }
  return { value: String(error).slice(0, MAX_STRING) };
}

/** Oculta llaves sensibles y recorta valores largos o profundos. */
export function redact(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
  if (typeof value !== "object") return value;
  if (value instanceof Error) return serializeError(value);
  if (value instanceof Date) return value.toISOString();
  if (depth >= MAX_DEPTH) return "[…]";
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1));
  const out: LogFields = {};
  for (const [key, inner] of Object.entries(value as LogFields)) {
    out[key] = SENSITIVE_KEY.test(key) ? "[oculto]" : redact(inner, depth + 1);
  }
  return out;
}

function write(level: Level, event: string, fields: LogFields) {
  if (ORDER[level] < ORDER[configuredLevel()]) return;
  const payload = redact(fields) as LogFields;
  const sink = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  if (useJson()) {
    sink(JSON.stringify({ level, event, time: new Date().toISOString(), ...payload }));
  } else {
    const rest = Object.keys(payload).length ? ` ${JSON.stringify(payload)}` : "";
    sink(`[${level}] ${event}${rest}`);
  }
}

export interface Logger {
  debug(event: string, fields?: LogFields): void;
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
  child(bindings: LogFields): Logger;
}

function make(bindings: LogFields): Logger {
  return {
    debug: (event, fields = {}) => write("debug", event, { ...bindings, ...fields }),
    info: (event, fields = {}) => write("info", event, { ...bindings, ...fields }),
    warn: (event, fields = {}) => write("warn", event, { ...bindings, ...fields }),
    error: (event, fields = {}) => {
      write("error", event, { ...bindings, ...fields });
      notifyErrorWebhook(event, { ...bindings, ...fields });
    },
    child: (more) => make({ ...bindings, ...more }),
  };
}

export const log: Logger = make({});

// ── Alerta opcional de errores: ERROR_WEBHOOK_URL (compatible con webhooks entrantes de Slack o Discord). ──
// Solo viaja el nombre del evento, el mensaje del error y el id de la solicitud: nunca datos del usuario.
const lastSent = new Map<string, number>();

function notifyErrorWebhook(event: string, fields: LogFields) {
  const url = process.env.ERROR_WEBHOOK_URL;
  if (!url || process.env.NODE_ENV === "test") return;
  const key = `${event}:${String((fields.error as { message?: string } | undefined)?.message ?? "")}`.slice(0, 200);
  const now = Date.now();
  if ((lastSent.get(key) ?? 0) > now - 60_000) return; // como mucho una alerta por minuto por error
  lastSent.set(key, now);
  const error = fields.error instanceof Error ? fields.error : null;
  const text = [
    `OmniAgent · ${event}`,
    error ? `${error.name}: ${error.message.slice(0, 300)}` : null,
    typeof fields.requestId === "string" ? `solicitud ${fields.requestId}` : null,
    typeof fields.route === "string" ? `ruta ${fields.route}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, content: text }) }).catch(
    () => undefined,
  );
}
