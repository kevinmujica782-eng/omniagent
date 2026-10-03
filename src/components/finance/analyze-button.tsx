"use client";

import { Loader, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { buttonClass, type ButtonSize, type ButtonVariant } from "@/components/ui";
import { apiFetch, errorMessage, sleep } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import type { InsightsCard } from "@/types/cards";

/** Pide a Omni un análisis nuevo de los últimos 3 meses (con límite de frecuencia según el plan). */
export function AnalyzeButton({
  label = "Analizar mis finanzas",
  variant = "primary",
  size = "md",
  className,
  demo = false,
}: {
  label?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  demo?: boolean;
}) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [refreshing, startTransition] = useTransition();

  async function run() {
    setRunning(true);
    setMessage(null);
    try {
      if (demo) {
        await sleep(1200);
        setMessage("Vista previa: el análisis real lo hace Claude con tus movimientos.");
        return;
      }
      await apiFetch<InsightsCard>("/api/v1/finance/analysis", { method: "POST" });
      startTransition(() => router.refresh());
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setRunning(false);
    }
  }

  const busy = running || refreshing;
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button type="button" onClick={run} disabled={busy} className={cn(buttonClass(variant, size), className)}>
        {busy ? (
          <Loader className="size-4 animate-spin" aria-hidden />
        ) : (
          <Sparkles className="size-4" aria-hidden />
        )}
        {busy ? "Omni está analizando…" : label}
      </button>
      {message ? (
        <span role="status" className="max-w-xs text-xs text-muted">
          {message}
        </span>
      ) : null}
    </span>
  );
}
