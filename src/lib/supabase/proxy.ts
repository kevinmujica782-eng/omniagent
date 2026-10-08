import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { supabaseEnv } from "./config";

// Las páginas legales, la de descarga de la app y las páginas web que arma Omni (/s/{slug}) son públicas: se comparten
// y deben abrir sin sesión. La vista previa de una página sin publicar la valida la propia página (solo su dueño).
const PUBLIC_PREFIXES = ["/login", "/auth", "/bot", "/privacidad", "/terminos", "/eliminar-cuenta", "/descargar", "/s"];

function isPublicPath(pathname: string): boolean {
  if (pathname === "/") return true;
  // Galería de pantallas con datos de ejemplo: en desarrollo, o en producción con ENABLE_PREVIEW=true.
  const previewEnabled = process.env.NODE_ENV !== "production" || process.env.ENABLE_PREVIEW === "true";
  if (previewEnabled && pathname.startsWith("/preview")) return true;
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/**
 * Refresca la sesión de Supabase en cada request (cookies) y protege las rutas privadas.
 * Basado en el patrón oficial de @supabase/ssr: no pongas lógica entre createServerClient y getClaims().
 */
export async function updateSession(request: NextRequest, { protect }: { protect: boolean }) {
  let response = NextResponse.next({ request });
  const { pathname } = request.nextUrl;
  const config = supabaseEnv();

  if (!config) {
    // Sin Supabase configurado: solo lo público funciona; lo demás lleva a /login, que explica qué falta.
    if (protect && !isPublicPath(pathname)) return redirectKeepingCookies(request, response, "/login");
    return response;
  }

  const supabase = createServerClient(config.url, config.key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims?.sub);

  if (protect && !signedIn && !isPublicPath(pathname)) {
    return redirectKeepingCookies(request, response, "/login", pathname + request.nextUrl.search);
  }
  if (protect && signedIn && pathname === "/login") {
    return redirectKeepingCookies(request, response, "/inicio");
  }
  return response;
}

function redirectKeepingCookies(request: NextRequest, source: NextResponse, to: string, next?: string) {
  const url = request.nextUrl.clone();
  url.pathname = to;
  url.search = "";
  if (next && next !== "/") url.searchParams.set("next", next);
  const redirect = NextResponse.redirect(url);
  source.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
  return redirect;
}
