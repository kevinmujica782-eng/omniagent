// Sin "server-only": lo usan el proxy, el servidor y el navegador.
// Si faltan las variables, la app sigue sirviendo la landing y /preview (útil en desarrollo).
export function supabaseEnv(): { url: string; key: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  return url && key ? { url, key } : null;
}
