"use client";

import { Loader } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { buttonClass, type ButtonSize, type ButtonVariant } from "@/components/ui";
import { apiFetch, errorMessage, sleep } from "@/lib/api-client";
import { cn } from "@/lib/cn";

/**
 * "Probar con datos de ejemplo": conecta cuenta nómina, ahorros y tarjeta del sandbox
 * (90 días de movimientos simulados) y pide el primer análisis.
 */
export function DemoDataButton({
  label = "Probar con datos de ejemplo",
  variant = "secondary",
  size = "md",
  className,
  wrapperClassName,
  demo = false,
}: {
  label?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  wrapperClassName?: string;
  demo?: boolean;
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<"idle" | "linking" | "analyzing">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [refreshing, startTransition] = useTransition();

  async function run() {
    setMessage(null);
    setPhase("linking");
    try {
      if (demo) {
        await sleep(900);
        setPhase("analyzing");
        await sleep(900);
        router.push("/preview?screen=finanzas");
        return;
      }
      await apiFetch("/api/v1/finance/demo-bank", { method: "POST" });
      setPhase("analyzing");
      // Si el análisis falla, igual se muestran los datos (el análisis se puede pedir después).
      await apiFetch("/api/v1/finance/analysis?origen=conexion", { method: "POST" }).catch(() => undefined);
      startTransition(() => router.refresh());
      setPhase("idle");
    } catch (error) {
      setMessage(errorMessage(error));
      setPhase("idle");
    }
  }

  const busy = phase !== "idle" || refreshing;
  const text = phase === "linking" ? "Conectando cuentas de ejemplo…" : busy ? "Omni está analizando…" : label;
  return (
    <span className={cn("inline-flex flex-col items-center gap-1", wrapperClassName)}>
      <button type="button" onClick={run} disabled={busy} className={cn(buttonClass(variant, size), className)}>
        {busy ? <Loader className="size-4 animate-spin" aria-hidden /> : null}
        {text}
      </button>
      {message ? (
        <span role="status" className="max-w-xs text-center text-xs text-danger">
          {message}
        </span>
      ) : null}
    </span>
  );
}
