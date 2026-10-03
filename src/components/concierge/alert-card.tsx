"use client";

import { Check, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { CheckoutButton } from "@/components/concierge/payment-sheet";
import { Sparkline } from "@/components/concierge/price-chart";
import { WATCH_KIND_ICON } from "@/components/icons";
import { Chip, IconTile, buttonClass } from "@/components/ui";
import { cn } from "@/lib/cn";
import { whenText } from "@/lib/concierge-copy";
import { money, plural } from "@/lib/format";
import type { CheckoutView, PriceAlertView } from "@/types/cards";

// Alerta inteligente: la bajada detectada por el agente, con su resumen, la evidencia (precio normal, mínimo,
// objetivo, existencias) y la compra rápida: "Comprar" abre la hoja de pago, donde se Permite o se Deniega.

function unitWords(kind: PriceAlertView["kind"]): [string, string] {
  return kind === "EVENT_TICKET" ? ["entrada", "entradas"] : kind === "HOTEL" ? ["habitación", "habitaciones"] : kind === "FLIGHT" ? ["asiento", "asientos"] : ["unidad", "unidades"];
}

export function AlertCard({
  alert,
  timeZone,
  demo = false,
  demoCheckout,
  compact = false,
  now,
}: {
  alert: PriceAlertView;
  timeZone: string;
  demo?: boolean;
  demoCheckout?: CheckoutView;
  compact?: boolean;
  now?: string;
}) {
  const router = useRouter();
  const [status, setStatus] = useState(alert.status);
  const [busy, setBusy] = useState(false);
  const Icon = WATCH_KIND_ICON[alert.kind];
  const m = (n: number) => money(n, alert.currency, { cents: !Number.isInteger(n) });
  const closed = status === "DISMISSED" || status === "EXPIRED";
  const bought = alert.actionStatus === "EXECUTED";
  const pendingPurchase = alert.actionStatus === "PENDING" || alert.actionStatus === "APPROVED";
  const unit = unitWords(alert.kind);

  async function dismiss() {
    setBusy(true);
    if (!demo) {
      const res = await fetch(`/api/v1/concierge/alerts/${alert.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "DISMISSED" }),
      }).catch(() => null);
      setBusy(false);
      if (!res?.ok) return;
      router.refresh();
    } else setBusy(false);
    setStatus("DISMISSED");
  }

  return (
    <article className={cn("w-full rounded-2xl border bg-surface p-4", status === "NEW" ? "border-orbit" : "border-line", closed && "opacity-70")}>
      <div className="flex items-start gap-3">
        <IconTile icon={Icon} tone="attention" />
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-xs text-muted">
            Oferta detectada{alert.merchant ? ` · ${alert.merchant}` : ""} · {whenText(alert.createdAt, now ? new Date(now) : new Date(), timeZone)}
          </p>
          <p className="mt-0.5 text-[15px] font-semibold leading-snug text-ink">{alert.headline}</p>
        </div>
        {status === "NEW" ? <Chip tone="attention">Nueva</Chip> : null}
      </div>

      <div className="mt-3 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-2xl font-semibold tracking-tight text-ink">{m(alert.price)}</span>
            {alert.referencePrice !== null && alert.referencePrice > alert.price ? (
              <span className="text-sm text-muted">
                normal <s>{m(alert.referencePrice)}</s>
              </span>
            ) : null}
          </p>
          {/* El titular por reglas ya nombra el producto; si lo escribió Claude con otras palabras, se muestra el nombre completo. */}
          {!alert.headline.includes(alert.title) ? (
            <p className="mt-0.5 truncate text-xs text-muted">{alert.title}</p>
          ) : alert.detail ? (
            <p className="mt-0.5 truncate text-xs text-muted">{alert.detail}</p>
          ) : null}
        </div>
        {alert.spark.length > 2 ? (
          <Sparkline values={alert.spark} reference={alert.referencePrice} width={104} height={36} label={`Precio de los últimos 30 días; hoy ${m(alert.price)}`} />
        ) : null}
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {alert.dropPct !== null && alert.dropPct > 0 ? <Chip tone="good">−{alert.dropPct}%</Chip> : null}
        {alert.savings !== null ? <Chip tone="good">Ahorras {m(alert.savings)}</Chip> : null}
        {alert.reasons.includes("LOWEST") ? <Chip>Mínimo desde que lo sigo</Chip> : null}
        {alert.reasons.includes("TARGET") ? <Chip>Bajo tu objetivo</Chip> : null}
        {alert.stockCount !== null && alert.stockCount <= 20 ? <Chip tone="attention">Quedan {plural(alert.stockCount, unit[0], unit[1])}</Chip> : null}
      </div>

      {!compact || alert.summary.length < 160 ? <p className="mt-3 text-sm leading-relaxed text-muted">{alert.summary}</p> : null}

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        {alert.verdict ? (
          <span className={cn("inline-flex items-center gap-1.5 text-xs font-semibold", alert.verdict === "buy" ? "text-primary" : "text-attention")}>
            <span aria-hidden className={cn("size-2 rounded-full", alert.verdict === "buy" ? "bg-primary" : "bg-orbit")} />
            {alert.verdict === "buy" ? "Buen momento para comprar" : "Podría bajar más"}
          </span>
        ) : null}
        {alert.source === "AI" ? (
          <span className="inline-flex items-center gap-1 text-xs text-muted">
            <Sparkles className="size-3" aria-hidden />
            Resumen de Omni
          </span>
        ) : null}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {bought ? (
          <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary">
            <Check className="size-4" aria-hidden />
            Comprado
          </span>
        ) : closed ? (
          <span className="text-sm text-muted">{status === "DISMISSED" ? "Seguiste esperando. Te aviso si baja más." : "Esta oferta ya pasó."}</span>
        ) : pendingPurchase && alert.actionId ? (
          <CheckoutButton actionId={alert.actionId} label="Continuar la compra" demo={demo} demoCheckout={demoCheckout} />
        ) : (
          <>
            <CheckoutButton
              itemId={alert.itemId}
              alertId={alert.id}
              label={alert.kind === "PRODUCT" ? `Comprar por ${m(alert.price)}` : "Comprar"}
              demo={demo}
              demoCheckout={demoCheckout}
            />
            <button type="button" onClick={dismiss} disabled={busy} className={buttonClass("secondary", "sm")}>
              Seguir esperando
            </button>
          </>
        )}
      </div>
    </article>
  );
}
