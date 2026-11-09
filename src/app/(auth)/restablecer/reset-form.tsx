"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { buttonClass } from "@/components/ui";
import { translatePasswordChangeError } from "@/lib/auth-errors";
import { cn } from "@/lib/cn";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

const MIN_LENGTH = 8;

const INPUT =
  "w-full rounded-xl border border-line-strong bg-surface px-3.5 py-2.5 text-[15px] text-ink outline-none transition-colors placeholder:text-muted focus:border-primary";

export function ResetForm() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") ?? "");
    const repeat = String(form.get("repeat") ?? "");
    if (password.length < MIN_LENGTH) {
      setError(`Usa al menos ${MIN_LENGTH} caracteres.`);
      return;
    }
    if (password !== repeat) {
      setError("Las dos contraseñas no son iguales.");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const supabase = createSupabaseBrowserClient();
      const { error: authError } = await supabase.auth.updateUser({ password });
      if (authError) {
        setError(translatePasswordChangeError(authError.message));
        return;
      }
      router.replace("/inicio");
      router.refresh();
    } catch {
      setError("Sin conexión. Inténtalo de nuevo.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-3">
      <label className="flex flex-col gap-1.5 text-sm font-medium text-ink">
        Contraseña nueva
        <input
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={MIN_LENGTH}
          required
          className={INPUT}
          aria-describedby="password-help"
        />
      </label>
      <p id="password-help" className="-mt-1 text-xs text-muted">
        Al menos {MIN_LENGTH} caracteres.
      </p>
      <label className="flex flex-col gap-1.5 text-sm font-medium text-ink">
        Repítela
        <input name="repeat" type="password" autoComplete="new-password" minLength={MIN_LENGTH} required className={INPUT} />
      </label>

      {error ? (
        <p role="alert" className="rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      ) : null}

      <button type="submit" disabled={busy} className={cn(buttonClass("primary"), "mt-1 w-full")}>
        {busy ? "Un momento…" : "Guardar contraseña"}
      </button>
    </form>
  );
}
