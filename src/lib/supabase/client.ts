import { createBrowserClient } from "@supabase/ssr";

/** Cliente de Supabase para componentes de cliente (login, Realtime). */
export function createSupabaseBrowserClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );
}
