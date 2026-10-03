// Tema de la interfaz: "system" sigue al teléfono; "light" y "dark" se fijan con data-theme en <html>.
// La preferencia vive en una cookie para que el servidor pinte el tema correcto desde el primer byte.

export const THEME_COOKIE = "omni-theme";
export type ThemePref = "system" | "light" | "dark";
export const THEME_COLORS = { light: "#F2F4F1", dark: "#0F1613" } as const;

export function parseTheme(value: string | null | undefined): ThemePref {
  return value === "light" || value === "dark" ? value : "system";
}

/** Solo navegador: aplica y recuerda el tema (un año). */
export function applyTheme(pref: ThemePref): void {
  const root = document.documentElement;
  if (pref === "system") delete root.dataset.theme;
  else root.dataset.theme = pref;
  const secure = window.location.protocol === "https:" ? "; secure" : "";
  document.cookie = `${THEME_COOKIE}=${pref}; path=/; max-age=31536000; samesite=lax${secure}`;
  // La barra del navegador sigue al tema: fijo si se eligió uno; por media query si es "Sistema".
  document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => {
    const media = meta.getAttribute("media") ?? "";
    const color = pref === "system" ? (media.includes("dark") ? THEME_COLORS.dark : THEME_COLORS.light) : THEME_COLORS[pref];
    meta.setAttribute("content", color);
  });
}

/** Solo navegador: el tema elegido ahora mismo. */
export function currentTheme(): ThemePref {
  return parseTheme(document.documentElement.dataset.theme);
}
