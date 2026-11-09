"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { buttonClass } from "@/components/ui";
import { translateAuthError } from "@/lib/auth-errors";
import { cn } from "@/lib/cn";
import { isNativeApp } from "@/lib/native";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { RESET_PASSWORD_PATH } from "@/lib/validation";

type Mode = "signin" | "signup" | "forgot";

// Entrar con Google solo cuando el proveedor está activo en Supabase (Authentication → Sign In / Providers).
const GOOGLE_ENABLED = process.env.NEXT_PUBLIC_GOOGLE_AUTH === "on";

const INPUT =
  "w-full rounded-xl border border-line-strong bg-surface px-3.5 py-2.5 text-[15px] text-ink outline-none transition-colors placeholder:text-muted focus:border-primary";

export function LoginForm({ next, initialError }: { next: string; initialError: string | null }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("signin");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(initialError);
  const [info, setInfo] = useState<string | null>(null);

  const callbackUrl = () => `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;

  function switchMode(value: Mode) {
    setMode(value);
    setError(null);
    setInfo(null);
  }

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
      if (mode === "forgot") {
        const { error: authError } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(RESET_PASSWORD_PATH)}`,
        });
        if (authError) {
          setError(translateAuthError(authError.message));
          return;
        }
        // No decimos si el correo tiene cuenta: así nadie puede averiguar quién usa la app.
        setInfo(
          "Si hay una cuenta con ese correo, te enviamos un enlace para crear una contraseña nueva. Ábrelo desde este dispositivo. Si no llega, revisa la carpeta de spam.",
        );
        return;
      }
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
      {mode === "forgot" ? (
        <div>
          <p className="text-base font-semibold text-ink">Recupera tu cuenta</p>
          <p className="mt-1 text-sm leading-relaxed text-muted">
            Escribe el correo con el que te registraste y te enviamos un enlace para crear una contraseña nueva.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 rounded-full border border-line bg-surface-2 p-1 text-sm font-semibold" role="tablist">
          {(["signin", "signup"] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={mode === value}
              onClick={() => switchMode(value)}
              className={cn(
                "rounded-full px-3 py-2 transition-colors",
                mode === value ? "bg-surface text-ink shadow-card" : "text-muted hover:text-ink",
              )}
            >
              {value === "signin" ? "Entrar" : "Crear cuenta"}
            </button>
          ))}
        </div>
      )}

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
        {mode !== "forgot" ? (
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
        ) : null}
        {mode === "signin" ? (
          <button
            type="button"
            onClick={() => switchMode("forgot")}
            className="-mt-1 self-end text-sm font-medium text-primary underline-offset-2 hover:underline"
          >
            ¿Olvidaste tu contraseña?
          </button>
        ) : null}

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
          {busy ? "Un momento…" : mode === "signin" ? "Entrar" : mode === "signup" ? "Crear cuenta" : "Enviar enlace"}
        </button>
        {mode === "forgot" ? (
          <button
            type="button"
            onClick={() => switchMode("signin")}
            className="self-center text-sm font-medium text-muted hover:text-ink"
          >
            Volver a entrar
          </button>
        ) : null}
      </form>

      {GOOGLE_ENABLED && mode !== "forgot" ? (
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
