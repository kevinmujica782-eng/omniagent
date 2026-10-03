"use client";

import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { buttonClass, type ButtonSize, type ButtonVariant } from "@/components/ui";
import { cn } from "@/lib/cn";
import { isNativeApp } from "@/lib/native";

/**
 * Botón que llama a un endpoint de /api/v1. Si la respuesta trae `data.url` (Stripe), redirige;
 * si no, refresca los Server Components. En la app nativa puede mostrar un aviso en su lugar.
 */
export function ActionButton({
  endpoint,
  method = "POST",
  body,
  label,
  pendingLabel,
  variant = "primary",
  size = "md",
  className,
  nativeNotice,
  disabled = false,
}: {
  endpoint: string;
  method?: "POST" | "PATCH" | "DELETE";
  body?: Record<string, unknown>;
  label: ReactNode;
  pendingLabel?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  nativeNotice?: string;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function run() {
    setMessage(null);
    if (nativeNotice && isNativeApp()) {
      setMessage(nativeNotice);
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(endpoint, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body ?? {}),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setMessage(json?.error?.message ?? "No se pudo completar. Inténtalo de nuevo.");
        return;
      }
      const url = json?.data?.url;
      if (typeof url === "string") {
        window.location.href = url;
        return;
      }
      router.refresh();
    } catch {
      setMessage("Sin conexión. Inténtalo de nuevo.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={run}
        disabled={busy || disabled}
        className={cn(buttonClass(variant, size), className)}
      >
        {busy ? (pendingLabel ?? "Un momento…") : label}
      </button>
      {message ? (
        <span role="status" className="max-w-xs text-xs text-muted">
          {message}
        </span>
      ) : null}
    </span>
  );
}
