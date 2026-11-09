import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { OmniMark } from "@/components/omni-mark";
import { supabaseEnv } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ResetForm } from "./reset-form";

export const metadata: Metadata = { title: "Contraseña nueva" };

/**
 * Aquí llega quien abrió el enlace del correo «¿Olvidaste tu contraseña?» (el enlace ya lo dejó con sesión) y quien
 * entra desde Cuenta → Cambiar contraseña. Sin sesión no hay nada que cambiar: vuelve a Entrar.
 */
export default async function ResetPasswordPage() {
  if (!supabaseEnv()) redirect("/login");
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/login?error=reset");

  return (
    <main className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="w-full max-w-sm">
        <Link href="/inicio" className="mb-10 flex items-center gap-2.5">
          <OmniMark size={36} />
          <span className="text-lg font-semibold tracking-tight text-ink">OmniAgent</span>
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Crea tu contraseña nueva</h1>
        {data.user.email ? <p className="mt-1 break-words text-sm text-muted">Cuenta: {data.user.email}</p> : null}
        <ResetForm />
        <p className="mt-8 text-xs leading-relaxed text-muted">
          <Link href="/inicio" className="font-medium text-ink underline underline-offset-2">
            Ahora no
          </Link>
          : seguirás con la contraseña que ya tenías.
        </p>
      </div>
    </main>
  );
}
