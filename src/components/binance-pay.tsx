"use client";

import { Loader } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Notice, buttonClass } from "@/components/ui";
import { apiFetch, errorMessage } from "@/lib/api-client";
import { shortDate } from "@/lib/format";
import { PurchaseError, purchasePro } from "@/lib/purchase";

type SyncResult = { paid: boolean; status: string; paidUntil: string | null; plan: "FREE" | "PRO" };

const CLOSED = ["CANCELED", "EXPIRED", "ERROR"];

/**
 * Al volver de Binance Pay: confirma la orden en Binance para activar Pro en el momento. El webhook hace lo mismo;
 * si Binance todavía no marcó la orden como pagada, se vuelve a preguntar unas veces.
 */
export function BinanceReturn({ order, alreadyPro }: { order: string; alreadyPro: boolean }) {
  const router = useRouter();
  const [state, setState] = useState<"syncing" | "done" | "pending" | "closed">("syncing");
  const [paidUntil, setPaidUntil] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function check(attempt: number) {
      const result = await apiFetch<SyncResult>("/api/v1/billing/binance/sync", { method: "POST", body: { orden: order } }).catch(() => null);
      if (cancelled) return;
      if (result?.paid) {
        setPaidUntil(result.paidUntil);
        setState("done");
        if (!alreadyPro) router.refresh();
        return;
      }
      if (result && CLOSED.includes(result.status)) {
        setState("closed");
        return;
      }
      if (attempt >= 5) {
        setState("pending");
        return;
      }
      setTimeout(() => void check(attempt + 1), 3000);
    }
    void check(1);
    return () => {
      cancelled = true;
    };
  }, [order, alreadyPro, router]);

  if (state === "done") {
    return <Notice>¡Listo! Pagaste con Binance Pay{paidUntil ? `: tienes Pro hasta el ${shortDate(paidUntil)}` : " y ya tienes Pro"}.</Notice>;
  }
  if (state === "closed") return <Notice tone="attention">La orden de Binance Pay se cerró sin pago. No se hizo ningún cobro.</Notice>;
  if (state === "pending") {
    return <Notice tone="attention">Todavía no vemos el pago en Binance. Si ya pagaste, Pro se activa en unos minutos: recarga la página.</Notice>;
  }
  return <Notice>Confirmando tu pago con Binance Pay…</Notice>;
}

/** Suma otro mes de Pro con Binance Pay (desde el fin vigente: renovar antes no pierde días). */
export function BinanceRenewButton({ preview = false }: { preview?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function renew() {
    setMessage(null);
    if (preview) {
      setMessage("Vista previa: aquí se abre el pago de Binance Pay.");
      return;
    }
    setBusy(true);
    try {
      const result = await purchasePro(null, "binance");
      if (result.status === "redirect") {
        window.location.assign(result.url);
        return;
      }
      setBusy(false);
    } catch (error) {
      setMessage(error instanceof PurchaseError ? error.message : errorMessage(error));
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <button type="button" onClick={renew} disabled={busy} className={buttonClass("secondary")}>
        {busy ? <Loader className="size-4 animate-spin" aria-hidden /> : null}
        {busy ? "Abriendo Binance Pay…" : "Sumar un mes con Binance Pay"}
      </button>
      {message ? (
        <p role="status" className="text-sm text-muted">
          {message}
        </p>
      ) : null}
    </div>
  );
}
