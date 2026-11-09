// Mensajes de Supabase Auth traducidos para quien los lee. Puro: se prueba sin red ni navegador.
import { SUPPORT_EMAIL } from "@/lib/legal";

/** Errores al entrar, crear la cuenta o pedir el enlace para recuperar la contraseña. */
export function translateAuthError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("invalid login credentials")) return "Correo o contraseña incorrectos.";
  if (m.includes("email not confirmed")) return "Confirma tu correo antes de entrar. Revisa tu bandeja de entrada.";
  if (m.includes("already registered")) return "Ya existe una cuenta con ese correo. Entra con tu contraseña.";
  // Sin correo propio, Supabase solo envía a los miembros de su equipo: el resto recibe este error.
  if (m.includes("not authorized")) return `No pudimos enviar el correo. Escríbenos a ${SUPPORT_EMAIL} y te ayudamos a entrar.`;
  if (m.includes("security purposes")) return "Espera un minuto antes de pedir otro enlace.";
  if (m.includes("rate limit")) return "Demasiados intentos. Espera un momento y vuelve a probar.";
  if (m.includes("password")) return "Revisa la contraseña: usa al menos 8 caracteres.";
  return "No pudimos completar el acceso. Inténtalo de nuevo.";
}

/** Errores al guardar la contraseña nueva. */
export function translatePasswordChangeError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("different from the old") || m.includes("same as the old")) return "Elige una contraseña distinta a la anterior.";
  if (m.includes("session") && m.includes("missing")) return "El enlace venció. Pide uno nuevo con «¿Olvidaste tu contraseña?».";
  if (m.includes("weak") || m.includes("pwned") || m.includes("easy to guess")) {
    return "Esa contraseña es muy fácil de adivinar o apareció en filtraciones. Elige otra.";
  }
  if (m.includes("at least") || m.includes("too short")) return "Usa al menos 8 caracteres.";
  if (m.includes("rate limit") || m.includes("security purposes")) return "Demasiados intentos. Espera un momento y vuelve a probar.";
  return "No pudimos guardar la contraseña. Inténtalo de nuevo.";
}
