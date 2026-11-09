const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

/** Evita redirecciones abiertas: solo rutas internas. */
export function safeNext(value: string | null | undefined, fallback = "/inicio"): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return fallback;
  return value;
}

/** Ruta del enlace para crear una contraseña nueva (correo «¿Olvidaste tu contraseña?»). */
export const RESET_PASSWORD_PATH = "/restablecer";

/**
 * Qué aviso muestra /login cuando un enlace del correo no sirve: si llevaba a crear una contraseña nueva, el de
 * recuperar la contraseña («reset»); si no, el que corresponda al enlace.
 */
export function authErrorKey(next: string, fallback: "auth" | "confirm"): "auth" | "confirm" | "reset" {
  const path = next.split(/[?#]/, 1)[0];
  return path === RESET_PASSWORD_PATH ? "reset" : fallback;
}

export function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}
