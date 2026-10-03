"use client";

import { CreditCard, LockKeyhole, Package, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type ChangeEvent, type FormEvent } from "react";
import { WATCH_KIND_ICON } from "@/components/icons";
import { Chip, IconTile, INPUT_CLASS, Progress, buttonClass } from "@/components/ui";
import { cn } from "@/lib/cn";
import { money, shortDate } from "@/lib/format";
import type { ConciergeSettingsView, OrderView } from "@/types/cards";

// Pedidos hechos desde OmniAgent y "Pago y límites": medios de pago (de prueba) y topes de gasto.

const STATUS: Record<OrderView["status"], { label: string; tone: "good" | "danger" | "neutral" }> = {
  PLACED: { label: "Confirmado", tone: "good" },
  FAILED: { label: "Pago rechazado", tone: "danger" },
  CANCELED: { label: "Cancelado", tone: "neutral" },
};

export function OrdersList({ orders, timeZone, highlight = null }: { orders: OrderView[]; timeZone: string; highlight?: string | null }) {
  return (
    <div className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
      {orders.map((order) => {
        const Icon = WATCH_KIND_ICON[order.kind] ?? Package;
        const status = STATUS[order.status];
        return (
          <div key={order.id} className={cn("flex items-start gap-3 px-4 py-3.5", highlight === order.id && "bg-primary-soft")}>
            <IconTile icon={Icon} size="sm" tone="neutral" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-ink">{order.title}</p>
              <p className="truncate text-xs text-muted">
                {[order.orderNumber, order.merchant, shortDate(order.createdAt, timeZone)].filter(Boolean).join(" · ")}
              </p>
              <p className="mt-0.5 truncate text-xs text-muted">
                {order.status === "FAILED" ? (order.failureReason ?? "El pago no pasó.") : (order.delivery?.detail ?? order.paymentLabel)}
              </p>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              <p className="text-sm font-semibold tabular-nums text-ink">{money(order.total, order.currency, { cents: true })}</p>
              <Chip tone={status.tone}>{status.label}</Chip>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function PaymentLimitsPanel({ settings, demo = false }: { settings: ConciergeSettingsView; demo?: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [perOrder, setPerOrder] = useState(String(settings.perOrderLimit));
  const [monthly, setMonthly] = useState(String(settings.monthlyLimit));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const m = (n: number) => money(n, settings.currency);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const perOrderLimit = Number(perOrder.replace(",", "."));
    const monthlyLimit = Number(monthly.replace(",", "."));
    if (!(perOrderLimit > 0) || !(monthlyLimit > 0)) {
      setMessage("Escribe montos mayores que cero.");
      return;
    }
    if (demo) {
      setEditing(false);
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/v1/concierge/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ perOrderLimit, monthlyLimit }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setMessage(json?.error?.message ?? "No se pudo guardar.");
        return;
      }
      setEditing(false);
      router.refresh();
    } catch {
      setMessage("Sin conexión. Inténtalo de nuevo.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <div className="rounded-2xl border border-line bg-surface p-4">
        <p className="flex items-center gap-2 text-sm font-semibold text-ink">
          <CreditCard className="size-4 text-muted" aria-hidden />
          Medios de pago
        </p>
        <ul className="mt-3 flex flex-col gap-2">
          {settings.methods.map((method) => (
            <li key={method.id} className="flex items-center justify-between gap-3 rounded-xl bg-surface-2 px-3 py-2.5 text-sm">
              <span className="min-w-0 text-ink">
                {method.label} <span className="whitespace-nowrap">•••• {method.last4}</span>
              </span>
              {method.declines ? <Chip>Rechaza</Chip> : <Chip tone="good">Predeterminada</Chip>}
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs leading-relaxed text-muted">
          Tarjetas de prueba: ningún cobro sale de OmniAgent. Omni nunca pide ni guarda el número completo de una tarjeta; con un
          proveedor real, la tarjeta se guarda en su bóveda (por ejemplo, Stripe).
        </p>
      </div>

      <div className="rounded-2xl border border-line bg-surface p-4">
        <p className="flex items-center gap-2 text-sm font-semibold text-ink">
          <ShieldCheck className="size-4 text-muted" aria-hidden />
          Límites de compra
        </p>
        {editing ? (
          <form onSubmit={save} className="mt-3 flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-muted">Por compra</span>
                <input value={perOrder} onChange={(event: ChangeEvent<HTMLInputElement>) => setPerOrder(event.target.value)} inputMode="decimal" className={INPUT_CLASS} />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-muted">Al mes</span>
                <input value={monthly} onChange={(event: ChangeEvent<HTMLInputElement>) => setMonthly(event.target.value)} inputMode="decimal" className={INPUT_CLASS} />
              </label>
            </div>
            {message ? (
              <p role="alert" className="text-sm text-danger">
                {message}
              </p>
            ) : null}
            <div className="flex gap-2">
              <button type="submit" disabled={busy} className={buttonClass("primary", "sm")}>
                {busy ? "Guardando…" : "Guardar"}
              </button>
              <button type="button" onClick={() => setEditing(false)} className={buttonClass("ghost", "sm")}>
                Cancelar
              </button>
            </div>
          </form>
        ) : (
          <>
            <dl className="mt-3 grid grid-cols-2 gap-3">
              <div>
                <dt className="text-xs text-muted">Por compra</dt>
                <dd className="mt-0.5 text-lg font-semibold tracking-tight text-ink">{m(settings.perOrderLimit)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Al mes</dt>
                <dd className="mt-0.5 text-lg font-semibold tracking-tight text-ink">{m(settings.monthlyLimit)}</dd>
              </div>
            </dl>
            <div className="mt-3">
              <Progress
                value={settings.spentThisMonth}
                max={settings.monthlyLimit}
                label="Gastado este mes"
                tone={settings.spentThisMonth > settings.monthlyLimit * 0.8 ? "attention" : "primary"}
              />
              <p className="mt-1.5 text-xs text-muted">
                {m(settings.spentThisMonth)} de {m(settings.monthlyLimit)} este mes
              </p>
            </div>
            <button type="button" onClick={() => setEditing(true)} className={cn(buttonClass("secondary", "sm"), "mt-3")}>
              Cambiar límites
            </button>
          </>
        )}
      </div>

      <div className="rounded-2xl bg-surface-2 px-4 py-4 md:col-span-2">
        <p className="flex items-center gap-2 text-sm font-semibold text-ink">
          <LockKeyhole className="size-4 text-muted" aria-hidden />
          Cómo se protegen tus compras
        </p>
        <ul className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1.5 text-sm leading-relaxed text-muted md:grid-cols-2">
          <li>Omni vigila y prepara; solo tú decides con Permitir o Denegar.</li>
          <li>Permitir vale para el total que viste: si sube, no se cobra.</li>
          <li>Antes de cobrar, Omni confirma el precio con la tienda.</li>
          <li>Un doble toque nunca cobra dos veces.</li>
        </ul>
      </div>
    </div>
  );
}
