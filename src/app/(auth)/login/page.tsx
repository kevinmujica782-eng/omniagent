import type { Metadata } from "next";
import Link from "next/link";
import { OmniMark } from "@/components/omni-mark";
import { supabaseEnv } from "@/lib/supabase/config";
import { safeNext } from "@/lib/validation";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Entrar" };

const ERRORS: Record<string, string> = {
  auth: "No pudimos completar el inicio de sesión. Inténtalo de nuevo.",
  confirm: "El enlace de confirmación no es válido o ya venció.",
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function LoginPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const next = safeNext(typeof params.next === "string" ? params.next : null);
  const error = typeof params.error === "string" ? (ERRORS[params.error] ?? null) : null;
  const configured = supabaseEnv() !== null;
  const accountDeleted = params.cuenta === "eliminada";

  return (
    <main className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="w-full max-w-sm">
        <Link href="/" className="mb-10 flex items-center gap-2.5">
          <OmniMark size={36} />
          <span className="text-lg font-semibold tracking-tight text-ink">OmniAgent</span>
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Entra a tu cuenta</h1>
        <p className="mt-1 text-sm text-muted">Omni propone; tú apruebas.</p>
        {accountDeleted ? (
          <p role="status" className="mt-5 rounded-2xl bg-primary-soft px-3.5 py-3 text-sm text-ink">
            Eliminamos tu cuenta y todos tus datos. Gracias por probar OmniAgent.
          </p>
        ) : null}
        {configured ? (
          <LoginForm next={next} initialError={error} />
        ) : (
          <div className="mt-6 rounded-2xl border border-dashed border-line-strong bg-surface p-4 text-sm leading-relaxed text-muted">
            <p className="font-semibold text-ink">Falta configurar Supabase</p>
            <p className="mt-1">
              Copia <code>.env.example</code> a <code>.env.local</code> y completa <code>NEXT_PUBLIC_SUPABASE_URL</code> y{" "}
              <code>NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY</code>. Mientras tanto puedes ver todas las pantallas en{" "}
              <Link href="/preview" className="font-semibold text-primary underline underline-offset-2">
                /preview
              </Link>
              .
            </p>
          </div>
        )}
        <p className="mt-8 text-xs leading-relaxed text-muted">
          Al crear tu cuenta aceptas los{" "}
          <Link href="/terminos" className="font-medium text-ink underline underline-offset-2">
            Términos
          </Link>{" "}
          y la{" "}
          <Link href="/privacidad" className="font-medium text-ink underline underline-offset-2">
            Política de privacidad
          </Link>
          .
        </p>
      </div>
    </main>
  );
}
