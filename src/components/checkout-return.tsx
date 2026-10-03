"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Notice } from "@/components/ui";
import { apiFetch } from "@/lib/api-client";

/**
 * Al volver de Stripe Checkout: confirma la sesión en el servidor para activar Pro en el momento
 * (el webhook hace lo mismo; si todavía no llegó, esto no espera por él).
 */
export function CheckoutReturn({ sessionId, alreadyPro }: { sessionId: string | null; alreadyPro: boolean }) {
  const router = useRouter();
  const [state, setState] = useState<"syncing" | "done" | "pending">(alreadyPro ? "done" : sessionId ? "syncing" : "pending");

  useEffect(() => {
    if (alreadyPro || !sessionId) return;
    let cancelled = false;
    apiFetch<{ plan: "FREE" | "PRO" }>("/api/v1/billing/sync", { method: "POST", body: { sessionId } })
      .then((result) => {
        if (cancelled) return;
        setState(result.plan === "PRO" ? "done" : "pending");
        if (result.plan === "PRO") router.refresh();
      })
      .catch(() => {
        if (!cancelled) setState("pending");
      });
    return () => {
      cancelled = true;
    };
  }, [alreadyPro, sessionId, router]);

  if (state === "done") return <Notice>¡Listo! Ya tienes Pro: tus agentes pasan a piloto automático.</Notice>;
  if (state === "syncing") return <Notice>Confirmando tu pago…</Notice>;
  return <Notice>Recibimos tu pago. Pro se activa en unos segundos; si no lo ves, recarga la página.</Notice>;
}
