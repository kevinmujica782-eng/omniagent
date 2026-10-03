import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { Errors } from "@/lib/errors";
import { supabaseEnv } from "./config";

/** Cliente de Supabase para Server Components, Route Handlers y Server Actions. */
export async function createSupabaseServerClient() {
  const config = supabaseEnv();
  if (!config) throw Errors.notConfigured("Supabase");
  const cookieStore = await cookies();

  return createServerClient(config.url, config.key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Llamado desde un Server Component: no puede escribir cookies.
          // No pasa nada: src/proxy.ts ya refresca la sesión en cada request.
        }
      },
    },
  });
}
