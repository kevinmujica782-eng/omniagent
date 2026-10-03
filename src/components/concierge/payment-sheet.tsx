"use client";

import { CircleAlert, CircleCheck, CreditCard, LockKeyhole, ShieldCheck, Truck, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { Dialog } from "@/components/dialog";
import { WATCH_KIND_ICON } from "@/components/icons";
import { Chip, IconTile, buttonClass, type ButtonSize, type ButtonVariant } from "@/components/ui";
import { cn } from "@/lib/cn";
import { money } from "@/lib/format";
import type { CheckoutView, OrderView } from "@/types/cards";

// Hoja de pago: la autorización explícita de cada compra. Muestra qué se compra, el total con su desglose, el
// medio de pago y la entrega, y deja dos decisiones: Denegar o Permitir. "Permitir" se activa un instante después
// de abrir la hoja (evita toques accidentales) y solo vale para el total que se muestra: si la tienda sube el
// precio, no se cobra y la hoja se actualiza para volver a decidir.

const ARM_DELAY_MS = 1200;

type ApiError = { message: string; code?: string; details?: { checkout?: CheckoutView } | null };

async function post(url: string, body?: unknown): Promise<{ ok: true; data: CheckoutView } | { ok: false; error: ApiError }> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) return { ok: false, error: json?.error ?? { message: "No se pudo completar. Inténtalo de nuevo." } };
    return { ok: true, data: json.data as CheckoutView };
  } catch {
    return { ok: false, error: { message: "Sin conexión. Inténtalo de nuevo." } };
  }
}

async function get(url: string): Promise<{ ok: true; data: CheckoutView } | { ok: false; error: ApiError }> {
  try {
    const res = await fetch(url);
    const json = await res.json().catch(() => null);
    if (!res.ok) return { ok: false, error: json?.error ?? { message: "No se pudo abrir la compra." } };
    return { ok: true, data: json.data as CheckoutView };
  } catch {
    return { ok: false, error: { message: "Sin conexión. Inténtalo de nuevo." } };
  }
}

/** Resultado simulado en la vista previa (sin API). */
function demoDecision(view: CheckoutView, decision: "allow" | "deny", methodId: string): CheckoutView {
  if (decision === "deny") return { ...view, status: "REJECTED", resultMessage: "Denegaste la compra. No se cobró nada y sigo vigilando el precio." };
  const method = view.methods.find((m) => m.id === methodId) ?? view.methods[0];
  if (method.declines) {
    return { ...view, status: "FAILED", resultMessage: "La tarjeta de prueba rechazó el pago (fondos insuficientes, simulado). No se hizo el pedido." };
  }
  const order: OrderView = {
    id: "demo-order",
    status: "PLACED",
    orderNumber: "SMX-7F3K2Q",
    kind: view.kind,
    title: view.title,
    merchant: view.merchant,
    quantity: view.quantity,
    total: view.total,
    currency: view.currency,
    paymentLabel: `${method.label} •••• ${method.last4}`,
    delivery: view.delivery,
    failureReason: null,
    sandbox: true,
    createdAt: new Date().toISOString(),
  };
  return {
    ...view,
    status: "EXECUTED",
    order,
    resultMessage: `Pedido ${order.orderNumber} confirmado por ${money(view.total, view.currency, { cents: true })}. Simulado: no se cobró de verdad.`,
  };
}

function Row({ label, value, note, strong = false }: { label: string; value: string; note?: string | null; strong?: boolean }) {
  const text = note ?? value;
  if (!strong && text.length > 26) {
    // Valores largos (entrega, dirección): etiqueta arriba y texto abajo, sin desbordar.
    return (
      <div className="flex flex-col gap-0.5">
        <dt className="text-sm text-muted">{label}</dt>
        <dd className="text-sm font-medium leading-relaxed text-ink">{text}</dd>
      </div>
    );
  }
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className={cn("min-w-0", strong ? "text-sm font-semibold text-ink" : "text-sm text-muted")}>{label}</dt>
      <dd className={cn("shrink-0 tabular-nums", strong ? "text-2xl font-semibold tracking-tight text-ink" : "text-sm font-medium text-ink")}>
        {note ?? value}
      </dd>
    </div>
  );
}

function Receipt({ view, onClose, onRetry, busy }: { view: CheckoutView; onClose: () => void; onRetry: () => void; busy: boolean }) {
  const m = (n: number) => money(n, view.currency, { cents: true });
  if (view.status === "EXECUTED" && view.order) {
    const order = view.order;
    return (
      <div className="flex flex-col items-center text-center">
        <span className="mt-2 grid size-14 place-items-center rounded-full bg-primary-soft text-primary">
          <CircleCheck className="size-7" aria-hidden />
        </span>
        <p className="mt-4 text-lg font-semibold text-ink">Pedido confirmado</p>
        <p className="mt-1 text-sm text-muted">{order.orderNumber ? `Pedido ${order.orderNumber}` : "Pedido registrado"}</p>
        <dl className="mt-5 flex w-full flex-col gap-2 rounded-2xl bg-surface-2 px-4 py-4 text-left">
          <Row label={order.title} value={m(order.total)} />
          <Row label="Pagado con" value={order.paymentLabel} />
          {order.delivery ? <Row label={order.delivery.label} value={order.delivery.detail ?? ""} /> : null}
        </dl>
        <p className="mt-3 text-xs leading-relaxed text-muted">{view.resultMessage ?? "Simulado: no se cobró de verdad."}</p>
        <button type="button" onClick={onClose} className={cn(buttonClass("primary", "md"), "mt-5 w-full")}>
          Listo
        </button>
      </div>
    );
  }
  const failed = view.status === "FAILED";
  const expired = view.status === "EXPIRED";
  return (
    <div className="flex flex-col items-center text-center">
      <span className={cn("mt-2 grid size-14 place-items-center rounded-full", failed ? "bg-danger-soft text-danger" : "bg-surface-2 text-muted")}>
        {failed ? <CircleAlert className="size-7" aria-hidden /> : <X className="size-7" aria-hidden />}
      </span>
      <p className="mt-4 text-lg font-semibold text-ink">
        {failed ? "El pago no pasó" : expired ? "Esta autorización venció" : "Compra denegada"}
      </p>
      <p className="mt-1 max-w-xs text-sm leading-relaxed text-muted">
        {view.resultMessage ?? (expired ? "Prepárala de nuevo para ver el precio de hoy." : "No se cobró nada.")}
      </p>
      <div className="mt-5 flex w-full flex-col gap-2">
        {(failed || expired) && view.itemId ? (
          <button type="button" onClick={onRetry} disabled={busy} className={cn(buttonClass("primary", "md"), "w-full")}>
            {busy ? "Preparando…" : failed ? "Probar con otra tarjeta" : "Preparar de nuevo"}
          </button>
        ) : null}
        <button type="button" onClick={onClose} className={cn(buttonClass("secondary", "md"), "w-full")}>
          Cerrar
        </button>
      </div>
    </div>
  );
}

export function PaymentSheet({
  initial,
  demo = false,
  onClose,
  onChange,
}: {
  initial: CheckoutView;
  demo?: boolean;
  onClose: () => void;
  onChange?: (view: CheckoutView) => void;
}) {
  const router = useRouter();
  const [view, setView] = useState(initial);
  const [methodId, setMethodId] = useState(initial.defaultMethodId);
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState<"allow" | "deny" | "retry" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const Icon = WATCH_KIND_ICON[view.kind];
  const m = (n: number) => money(n, view.currency, { cents: true });

  // "Permitir" se activa un instante después de mostrar (o de actualizar) el total.
  useEffect(() => {
    setArmed(false);
    const timer = setTimeout(() => setArmed(true), ARM_DELAY_MS);
    return () => clearTimeout(timer);
  }, [view.quoteId]);

  function update(next: CheckoutView) {
    setView(next);
    onChange?.(next);
    if (!demo) router.refresh();
  }

  async function decide(decision: "allow" | "deny") {
    if (decision === "allow" && !armed) return;
    setBusy(decision);
    setError(null);
    if (demo) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      update(demoDecision(view, decision, methodId));
      setBusy(null);
      return;
    }
    const result = await post(`/api/v1/concierge/checkout/${view.actionId}`, { decision, quoteId: view.quoteId, methodId });
    setBusy(null);
    if (result.ok) {
      update(result.data);
      return;
    }
    if (result.error.details?.checkout) update(result.error.details.checkout);
    setError(result.error.message);
  }

  async function retry() {
    if (!view.itemId) return;
    setBusy("retry");
    setError(null);
    if (demo) {
      await new Promise((resolve) => setTimeout(resolve, 400));
      update({ ...initial, status: "PENDING", order: null, resultMessage: null });
      setMethodId(initial.methods.find((x) => !x.declines)?.id ?? initial.defaultMethodId);
      setBusy(null);
      return;
    }
    const result = await post(`/api/v1/concierge/items/${view.itemId}/checkout`, {});
    setBusy(null);
    if (result.ok) {
      update(result.data);
      setMethodId(result.data.methods.find((x) => !x.declines)?.id ?? result.data.defaultMethodId);
    } else setError(result.error.message);
  }

  const pending = view.status === "PENDING";

  return (
    <Dialog title={pending ? "Autorizar compra" : "Compra"} onClose={onClose} closable={busy === null}>
      {!pending ? (
        <Receipt view={view} onClose={onClose} onRetry={retry} busy={busy === "retry"} />
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-3">
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary">
              <LockKeyhole className="size-3.5" aria-hidden />
              Pago protegido por OmniAgent
            </span>
            {view.sandbox ? <Chip tone="attention">Simulado</Chip> : null}
          </div>

          <div className="flex items-start gap-3">
            <IconTile icon={Icon} />
            <div className="min-w-0 flex-1">
              <p className="text-xs text-muted">{view.merchant ?? "Tienda"}</p>
              <p className="mt-0.5 text-[15px] font-semibold leading-snug text-ink">{view.title}</p>
              {view.detail ? <p className="mt-0.5 text-xs text-muted">{view.detail}</p> : null}
            </div>
          </div>

          {view.priceChanged ? (
            <p role="alert" className="rounded-2xl bg-attention-soft px-4 py-3 text-sm font-medium leading-relaxed text-attention">
              El precio cambió de {m(view.priceChanged.from)} a {m(view.priceChanged.to)}. Revisa el nuevo total y decide otra vez.
            </p>
          ) : null}

          <dl className="flex flex-col gap-2 rounded-2xl border border-line px-4 py-3.5">
            {view.lines.map((line) => (
              <Row key={line.label} label={line.label} value={m(line.amount)} note={line.note} />
            ))}
            <div className="my-1 border-t border-dashed border-line-strong" aria-hidden />
            <Row label="Total" value={m(view.total)} strong />
          </dl>

          <p className="flex items-start gap-2 text-sm leading-relaxed text-ink">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
            <span>{view.guard}</span>
          </p>

          <fieldset>
            <legend className="mb-2 text-sm font-semibold text-ink">Medio de pago</legend>
            <div className="flex flex-col gap-2">
              {view.methods.map((method) => (
                <label
                  key={method.id}
                  className={cn(
                    "relative flex cursor-pointer items-center gap-3 rounded-2xl border px-4 py-3 transition-colors",
                    methodId === method.id ? "border-primary bg-primary-soft" : "border-line hover:bg-surface-2",
                  )}
                >
                  <input
                    type="radio"
                    name={`method-${view.actionId}`}
                    value={method.id}
                    checked={methodId === method.id}
                    onChange={() => setMethodId(method.id)}
                    className="sr-only"
                  />
                  <CreditCard className="size-5 shrink-0 text-muted" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-ink">
                      {method.label} <span className="whitespace-nowrap">•••• {method.last4}</span>
                    </span>
                    {method.declines ? <span className="block text-xs text-muted">Para probar un pago rechazado</span> : null}
                  </span>
                  <span
                    aria-hidden
                    className={cn("size-4 shrink-0 rounded-full border-2", methodId === method.id ? "border-primary bg-primary" : "border-line-strong")}
                  />
                </label>
              ))}
            </div>
            <p className="mt-2 text-xs leading-relaxed text-muted">Omni nunca ve ni guarda el número completo de tus tarjetas.</p>
          </fieldset>

          {view.delivery ? (
            <p className="flex items-start gap-2 text-sm leading-relaxed">
              <Truck className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
              <span>
                <span className="font-medium text-ink">{view.delivery.label}</span>
                {view.delivery.detail ? <span className="block text-muted">{view.delivery.detail}</span> : null}
              </span>
            </p>
          ) : null}

          <ul className="flex flex-col gap-1 text-xs leading-relaxed text-muted">
            {view.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
            <li>
              Te quedan {money(view.limits.monthlyRemaining, view.currency)} de tu límite de compras de este mes.
            </li>
          </ul>

          {error ? (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          ) : null}

          <div className="sticky bottom-0 -mx-5 grid grid-cols-2 gap-2 border-t border-line bg-surface px-5 pb-1 pt-3">
            <button
              type="button"
              onClick={() => decide("deny")}
              disabled={busy !== null}
              className={cn(buttonClass("secondary", "lg"), "w-full")}
            >
              {busy === "deny" ? "Denegando…" : "Denegar"}
            </button>
            <button
              type="button"
              onClick={() => decide("allow")}
              disabled={busy !== null}
              aria-disabled={!armed}
              className={cn(buttonClass("primary", "lg"), "relative w-full overflow-hidden", !armed && "cursor-wait opacity-70")}
            >
              {!armed ? <span aria-hidden className="arm-progress absolute inset-y-0 left-0 bg-white/20" /> : null}
              <span className="relative">{busy === "allow" ? "Autorizando…" : "Permitir"}</span>
            </button>
          </div>
        </div>
      )}
    </Dialog>
  );
}

/** Hoja de pago abierta desde el inicio (vista previa y enlaces directos). */
export function OpenPaymentSheet({ checkout, demo = false }: { checkout: CheckoutView; demo?: boolean }) {
  const [open, setOpen] = useState(true);
  return open ? <PaymentSheet initial={checkout} demo={demo} onClose={() => setOpen(false)} /> : null;
}

/** Abre la hoja de pago: prepara la compra (o recupera una pendiente) y la muestra. */
export function CheckoutButton({
  itemId,
  alertId = null,
  actionId = null,
  label,
  variant = "primary",
  size = "sm",
  className,
  demo = false,
  demoCheckout,
  block = false,
}: {
  itemId?: string | null;
  alertId?: string | null;
  actionId?: string | null;
  label: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  demo?: boolean;
  demoCheckout?: CheckoutView;
  /** Ocupa todo el ancho. */
  block?: boolean;
}) {
  const [open, setOpen] = useState<CheckoutView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setError(null);
    if (demo) {
      if (demoCheckout) setOpen(demoCheckout);
      return;
    }
    setBusy(true);
    const result = actionId
      ? await get(`/api/v1/concierge/checkout/${actionId}`)
      : await post(`/api/v1/concierge/items/${itemId}/checkout`, alertId ? { alertId } : {});
    setBusy(false);
    if (result.ok) setOpen(result.data);
    else setError(result.error.message);
  }

  return (
    <>
      <span className={cn("flex-col gap-1", block ? "flex w-full" : "inline-flex items-start")}>
        <button type="button" onClick={start} disabled={busy} className={cn(buttonClass(variant, size), block && "w-full", className)}>
          {busy ? "Preparando…" : label}
        </button>
        {error ? (
          <span role="alert" className="max-w-xs text-xs text-danger">
            {error}
          </span>
        ) : null}
      </span>
      {open ? <PaymentSheet initial={open} demo={demo} onClose={() => setOpen(null)} /> : null}
    </>
  );
}
