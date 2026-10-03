"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { buttonClass } from "@/components/ui";
import { cn } from "@/lib/cn";
import { isNativeApp } from "@/lib/native";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type Mode = "signin" | "signup";

// Entrar con Google solo cuando el proveedor está activo en Supabase (Authentication → Sign In / Providers).
const GOOGLE_ENABLED = process.env.NEXT_PUBLIC_GOOGLE_AUTH === "on";

const INPUT =
  "w-full rounded-xl border border-line-strong bg-surface px-3.5 py-2.5 text-[15px] text-ink outline-none transition-colors placeholder:text-muted focus:border-primary";

function translateAuthError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("invalid login credentials")) return "Correo o contraseña incorrectos.";
  if (m.includes("email not confirmed")) return "Confirma tu correo antes de entrar. Revisa tu bandeja de entrada.";
  if (m.includes("already registered")) return "Ya existe una cuenta con ese correo. Entra con tu contraseña.";
  if (m.includes("rate limit")) return "Demasiados intentos. Espera un momento y vuelve a probar.";
  if (m.includes("password")) return "Revisa la contraseña: usa al menos 8 caracteres.";
  return "No pudimos completar el acceso. Inténtalo de nuevo.";
}

export function LoginForm({ next, initialError }: { next: string; initialError: string | null }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("signin");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(initialError);
  const [info, setInfo] = useState<string | null>(null);

  const callbackUrl = () => `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");
    const fullName = String(form.get("full_name") ?? "").trim();

    setBusy(true);
    setError(null);
    setInfo(null);
    const supabase = createSupabaseBrowserClient();
    try {
      if (mode === "signin") {
        const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
        if (authError) {
          setError(translateAuthError(authError.message));
          return;
        }
        router.replace(next);
        router.refresh();
      } else {
        const { data, error: authError } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { full_name: fullName }, emailRedirectTo: callbackUrl() },
        });
        if (authError) {
          setError(translateAuthError(authError.message));
          return;
        }
        if (data.session) {
          router.replace(next);
          router.refresh();
        } else {
          setInfo("Te enviamos un correo para confirmar tu cuenta. Ábrelo desde este dispositivo.");
        }
      }
    } catch {
      setError("Sin conexión. Inténtalo de nuevo.");
    } finally {
      setBusy(false);
    }
  }

  async function withGoogle() {
    if (isNativeApp()) {
      // Google bloquea OAuth dentro de WebViews: en la app se usará el navegador del sistema (fase 2).
      setError("En la app de Android, entra con tu correo. El acceso con Google llega en la próxima versión.");
      return;
    }
    setBusy(true);
    setError(null);
    const supabase = createSupabaseBrowserClient();
    const { error: authError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: callbackUrl() },
    });
    if (authError) {
      setError(translateAuthError(authError.message));
      setBusy(false);
    }
  }

  return (
    <div className="mt-6">
      <div className="grid grid-cols-2 rounded-full border border-line bg-surface-2 p-1 text-sm font-semibold" role="tablist">
        {(["signin", "signup"] as const).map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={mode === value}
            onClick={() => {
              setMode(value);
              setError(null);
              setInfo(null);
            }}
            className={cn(
              "rounded-full px-3 py-2 transition-colors",
              mode === value ? "bg-surface text-ink shadow-card" : "text-muted hover:text-ink",
            )}
          >
            {value === "signin" ? "Entrar" : "Crear cuenta"}
          </button>
        ))}
      </div>

      <form onSubmit={onSubmit} className="mt-5 flex flex-col gap-3">
        {mode === "signup" ? (
          <label className="flex flex-col gap-1.5 text-sm font-medium text-ink">
            Nombre
            <input name="full_name" autoComplete="name" required className={INPUT} placeholder="Cómo quieres que Omni te llame" />
          </label>
        ) : null}
        <label className="flex flex-col gap-1.5 text-sm font-medium text-ink">
          Correo
          <input name="email" type="email" autoComplete="email" required className={INPUT} placeholder="tu@correo.com" />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium text-ink">
          Contraseña
          <input
            name="password"
            type="password"
            autoComplete={mode === "signin" ? "current-password" : "new-password"}
            minLength={mode === "signup" ? 8 : undefined}
            required
            className={INPUT}
          />
        </label>

        {error ? (
          <p role="alert" className="rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">
            {error}
          </p>
        ) : null}
        {info ? (
          <p role="status" className="rounded-xl bg-primary-soft px-3 py-2 text-sm text-primary">
            {info}
          </p>
        ) : null}

        <button type="submit" disabled={busy} className={cn(buttonClass("primary"), "mt-1 w-full")}>
          {busy ? "Un momento…" : mode === "signin" ? "Entrar" : "Crear cuenta"}
        </button>
      </form>

      {GOOGLE_ENABLED ? (
        <>
          <div className="my-5 flex items-center gap-3 text-xs text-muted">
            <span className="h-px flex-1 bg-line" />o<span className="h-px flex-1 bg-line" />
          </div>
          <button type="button" onClick={withGoogle} disabled={busy} className={cn(buttonClass("secondary"), "w-full")}>
            Continuar con Google
          </button>
        </>
      ) : null}
    </div>
  );
}
