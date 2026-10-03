// Contacto y enlaces de los textos legales. Google Play exige un contacto en la política de privacidad, en la página
// para borrar la cuenta y en la ficha de la tienda, y un enlace a la política dentro de la app.

/** Correo público de soporte y privacidad. */
export const SUPPORT_EMAIL = process.env.NEXT_PUBLIC_SUPPORT_EMAIL || "kevinmujica782@gmail.com";

/** Nombre del responsable tal como aparece en la cuenta de desarrollador de Google Play (opcional). */
export const LEGAL_NAME = process.env.NEXT_PUBLIC_LEGAL_NAME || null;

/** Fecha de la última versión de la política de privacidad y los términos. */
export const LEGAL_UPDATED = "2 de octubre de 2026";

export const LEGAL_LINKS = [
  { href: "/privacidad", label: "Privacidad" },
  { href: "/terminos", label: "Términos" },
  { href: "/eliminar-cuenta", label: "Borrar tu cuenta" },
] as const;

/** Dominio público de la app ("omniagent.netlify.app"), para los textos que lo mencionan. */
export function appHost(): string {
  const url = process.env.NEXT_PUBLIC_APP_URL;
  if (!url) return "la web de OmniAgent";
  try {
    return new URL(url).host;
  } catch {
    return "la web de OmniAgent";
  }
}
