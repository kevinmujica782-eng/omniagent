"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Paywall } from "@/components/paywall/paywall";
import { buttonClass } from "@/components/ui";
import { cn } from "@/lib/cn";
import { requestUpgrade, UPGRADE_EVENT, type UpgradeRequest } from "@/lib/upgrade";
import type { AgentFeatureId, PlanId } from "@/modules/billing/plans";

// Punto de entrada a Omni Pro desde cualquier parte de la app: un límite del plan Gratis (402 plan_limit), la
// tarjeta del chat, el Inicio o la cuenta piden la mejora y aquí se abre la pantalla de Pro.

/** Escucha los pedidos de mejora (límites del plan, botones "Pro") y abre la pantalla de Pro. Va una vez en el shell. */
export function UpgradeSheetHost({
  preview = false,
  initial = null,
  userId = null,
  previewPlan,
}: {
  preview?: boolean;
  initial?: UpgradeRequest | null;
  userId?: string | null;
  /** Solo vista previa: el plan con el que se muestra la pantalla. */
  previewPlan?: PlanId;
}) {
  const [request, setRequest] = useState<UpgradeRequest | null>(initial);
  useEffect(() => {
    const onRequest = (event: Event) => setRequest((event as CustomEvent<UpgradeRequest>).detail ?? { reason: null, feature: null });
    window.addEventListener(UPGRADE_EVENT, onRequest);
    return () => window.removeEventListener(UPGRADE_EVENT, onRequest);
  }, []);
  if (!request) return null;
  return (
    <Paywall
      request={request}
      onClose={() => setRequest(null)}
      userId={userId}
      preview={preview}
      initialPlan={preview ? (previewPlan ?? "FREE") : undefined}
    />
  );
}

/** Botón que abre la pantalla de Pro (opcionalmente marcando la función que la motivó). */
export function UpgradeButton({
  feature = null,
  reason = null,
  className,
  children,
  variant = "primary",
}: {
  feature?: AgentFeatureId | null;
  reason?: string | null;
  className?: string;
  children: ReactNode;
  variant?: "primary" | "secondary" | "ghost" | "link";
}) {
  return (
    <button
      type="button"
      onClick={() => requestUpgrade({ reason, feature })}
      className={variant === "link" ? cn("text-sm font-semibold text-primary underline-offset-2 hover:underline", className) : cn(buttonClass(variant), className)}
    >
      {children}
    </button>
  );
}
