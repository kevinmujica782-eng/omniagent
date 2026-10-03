"use client";

import { Check, CircleAlert, Loader, Lock, RotateCcw, ShieldCheck, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { AutopilotDial } from "@/components/paywall/autopilot-dial";
import { apiFetch, errorMessage } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { PurchaseError, purchaseChannel, purchasePro, storePrice, waitForPro, type PurchaseChannel } from "@/lib/purchase";
import type { UpgradeRequest } from "@/lib/upgrade";
import { autopilotPerMonth, paywallRows, rowForLimit, type PaywallRow } from "@/modules/billing/paywall";
import { PLANS, type PlanId } from "@/modules/billing/plans";

// Pantalla de Omni Pro (paywall). Siempre oscura (clase theme-dark), a pantalla completa en el teléfono y en dos
// columnas en pantallas grandes. Los números salen de PLANS; el botón usa la pasarela que corresponde: Stripe en la
// web y Google Play (RevenueCat) en la app de Android.

const FREE = PLANS.FREE;
const PRO = PLANS.PRO;

type Phase = "idle" | "paying" | "confirming" | "active";
type BillingState = { plan: PlanId; checkoutAvailable: boolean };

const FOCUSABLE = 'button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface PaywallProps {
  request: UpgradeRequest;
  onClose: () => void;
  /** Id de la persona: RevenueCat lo usa para que el webhook sepa a quién activar Pro. */
  userId?: string | null;
  /** Vista previa: nada se cobra ni se llama al servidor. */
  preview?: boolean;
  /** Plan conocido de antemano (la vista previa); si no, se consulta al abrir. */
  initialPlan?: PlanId;
}

export function Paywall({ request, onClose, userId = null, preview = false, initialPlan }: PaywallProps) {
  const router = useRouter();
  const titleId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [channel, setChannel] = useState<PurchaseChannel>("stripe");
  const [billing, setBilling] = useState<BillingState | null>(initialPlan ? { plan: initialPlan, checkoutAvailable: true } : null);
  const [price, setPrice] = useState(PRO.price);
  const [phase, setPhase] = useState<Phase>(initialPlan === "PRO" ? "active" : "idle");
  const [message, setMessage] = useState<string | null>(null);
  const busy = phase === "paying" || phase === "confirming";
  const highlighted = rowForLimit(request.limit ?? null, request.feature);
  const month = autopilotPerMonth(PRO);

  // Foco dentro de la pantalla y sin desplazar la página de atrás; al cerrar, el foco vuelve a donde estaba.
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    rootRef.current?.focus();
    return () => {
      document.documentElement.style.overflow = overflow;
      previous?.focus();
    };
  }, []);

  // El plan de verdad y, en Android, el precio que cobra Google Play en la moneda de la persona.
  useEffect(() => {
    const current = purchaseChannel();
    setChannel(current);
    if (preview) return;
    let alive = true;
    apiFetch<BillingState>("/api/v1/billing")
      .then((data) => {
        if (!alive) return;
        setBilling({ plan: data.plan, checkoutAvailable: data.checkoutAvailable });
        if (data.plan === "PRO") setPhase("active");
      })
      .catch(() => undefined);
    if (current === "google_play") {
      void storePrice(userId).then((value) => {
        if (alive && value) setPrice(value);
      });
    }
    return () => {
      alive = false;
    };
  }, [preview, userId]);

  function close() {
    if (busy) return;
    if (phase === "active" && !preview) router.refresh();
    onClose();
  }

  async function unlock() {
    setMessage(null);
    if (preview) {
      setMessage(channel === "google_play" ? "Vista previa: aquí se abre el pago de Google Play." : "Vista previa: aquí se abre el pago seguro de Stripe.");
      return;
    }
    if (channel === "stripe" && billing && !billing.checkoutAvailable) {
      setMessage("El pago con tarjeta todavía no está configurado en este entorno.");
      return;
    }
    setPhase("paying");
    try {
      const result = await purchasePro(userId);
      if (result.status === "redirect") {
        // Se queda en "pagando" mientras el navegador abre Stripe.
        window.location.assign(result.url);
        return;
      }
      if (result.status === "cancelled") {
        setPhase("idle");
        return;
      }
      if (result.status === "unavailable") {
        setMessage(result.message);
        setPhase("idle");
        return;
      }
      setPhase("confirming");
      const active = await waitForPro();
      setPhase(active ? "active" : "idle");
      if (!active) setMessage("Google Play ya confirmó tu compra. Pro se activa en unos segundos; puedes cerrar esta pantalla.");
    } catch (error) {
      setMessage(error instanceof PurchaseError ? error.message : errorMessage(error));
      setPhase("idle");
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.stopPropagation();
      close();
      return;
    }
    if (event.key !== "Tab" || !rootRef.current) return;
    const focusables = [...rootRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null);
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  const checkout = (
    <CheckoutPanel phase={phase} price={price} channel={channel} message={message} onUnlock={unlock} onDone={close} />
  );

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className="theme-dark fixed inset-0 z-50 overflow-y-auto overscroll-contain bg-canvas text-ink outline-none"
    >
      <div aria-hidden className="paywall-sky pointer-events-none absolute inset-x-0 top-0 h-[34rem]" />
      <div className="relative mx-auto flex min-h-full w-full max-w-5xl flex-col px-4 pt-[max(0.75rem,env(safe-area-inset-top))] sm:px-8">
        <div className="flex justify-end py-2">
          <button
            type="button"
            onClick={close}
            disabled={busy}
            aria-label="Cerrar"
            className="grid size-10 place-items-center rounded-full bg-surface/80 text-ink transition-colors hover:bg-surface-2 disabled:opacity-40"
          >
            <X className="size-5" aria-hidden />
          </button>
        </div>

        <div className="grid flex-1 content-start gap-9 pb-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:content-center lg:items-center lg:gap-16 lg:pb-14">
          <section className="text-center lg:text-left">
            <AutopilotDial plan={PRO} className="lg:items-start" />
            <h2 id={titleId} className="mx-auto mt-7 max-w-[15ch] text-[31px] font-semibold leading-[1.12] tracking-[-0.02em] text-balance sm:text-4xl lg:mx-0 lg:text-[44px]">
              Pon a Omni en piloto automático
            </h2>
            {/* El resumen del tiempo que Pro trabaja por ti, con los números del plan. */}
            <p className="mx-auto mt-4 max-w-[42ch] text-[15px] leading-relaxed text-muted text-pretty lg:mx-0 lg:text-base">
              Cada mes, Omni hace por ti <strong className="font-semibold text-ink tabular-nums">{month.prices.toLocaleString("es-US")}</strong> revisiones de
              cada precio y <strong className="font-semibold text-ink tabular-nums">{month.mail.toLocaleString("es-US")}</strong> de tu correo, y te deja listo
              el informe de tus gastos. Tú solo decides.
            </p>
            <TrustList channel={channel} className="mt-8 hidden lg:flex" />
          </section>

          <section>
            {request.reason ? (
              <p className="mb-5 flex items-start gap-2.5 rounded-2xl bg-attention-soft px-4 py-3 text-[14px] leading-snug text-attention">
                <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span>{request.reason}</span>
              </p>
            ) : null}
            <PlanComparison rows={paywallRows(FREE, PRO)} price={price} highlighted={highlighted} />
            <div className="mt-8 hidden lg:block">{checkout}</div>
            <TrustList channel={channel} className="mt-8 lg:hidden" />
            {phase !== "active" ? (
              <button type="button" onClick={close} disabled={busy} className="mx-auto mt-6 block text-sm font-medium text-muted underline-offset-4 hover:text-ink hover:underline lg:mx-0">
                Seguir con Gratis
              </button>
            ) : null}
          </section>
        </div>

        {/* En el teléfono, el botón queda siempre a mano, con el precio y la renovación al lado. */}
        <div className="sticky bottom-0 z-10 -mx-4 mt-auto border-t border-line bg-canvas/95 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur-lg sm:-mx-8 sm:px-8 lg:hidden">
          {checkout}
        </div>
      </div>
    </div>
  );
}

// ─── Comparación Gratis / Pro ─────────────────────────────────────────────

function Cell({ value, strong }: { value: string | true; strong: boolean }) {
  if (value === true) {
    return (
      <>
        <Check className={cn("size-4", strong ? "text-primary" : "text-muted")} aria-hidden />
        <span className="sr-only">Incluido</span>
      </>
    );
  }
  return <>{value}</>;
}

function PlanComparison({ rows, price, highlighted }: { rows: PaywallRow[]; price: string; highlighted: PaywallRow["id"] | null }) {
  return (
    <div className="relative">
      {/* El anillo de Pro: la columna recomendada, con el punto ámbar de la órbita de Omni. */}
      <div aria-hidden className="paywall-ring pointer-events-none absolute inset-y-0 right-0 w-[40%] rounded-[1.375rem]" />
      <table className="relative w-full table-fixed border-separate border-spacing-0 text-[14px] leading-snug">
        <caption className="sr-only">Qué incluye cada plan</caption>
        <colgroup>
          <col className="w-[33%]" />
          <col className="w-[27%]" />
          {/* El mismo ancho que el anillo de Pro. */}
          <col className="w-[40%]" />
        </colgroup>
        <thead>
          <tr>
            <th scope="col" className="pb-3 align-bottom">
              <span className="sr-only">Función</span>
            </th>
            <th scope="col" className="px-2 pb-3 pt-10 text-left align-bottom font-normal">
              <span className="block text-[15px] font-semibold text-ink">{FREE.name}</span>
              <span className="block text-[13px] text-muted tabular-nums">{FREE.price}</span>
            </th>
            <th scope="col" className="relative px-3.5 pb-3 pt-10 text-left align-bottom font-normal">
              <span className="absolute left-3.5 top-3 rounded-full bg-orbit px-2 py-0.5 text-[11px] font-semibold leading-4 text-[#2a1d05]">Recomendado</span>
              <span className="block text-[15px] font-semibold text-ink">{PRO.name}</span>
              <span className="block text-[13px] text-muted tabular-nums">{price} al mes</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const hit = row.id === highlighted;
            const last = index === rows.length - 1;
            return (
              <tr key={row.id}>
                <th scope="row" className={cn("border-t border-line py-3 pr-2 text-left align-top font-normal", hit ? "text-ink" : "text-muted")}>
                  {hit ? <span aria-hidden className="mb-0.5 mr-1.5 inline-block size-1.5 rounded-full bg-orbit align-middle" /> : null}
                  {row.label}
                  {hit ? <span className="sr-only"> (tu límite)</span> : null}
                </th>
                <td className={cn("border-t border-line px-2 py-3 align-top", hit ? "font-medium text-attention" : "text-muted")}>
                  <Cell value={row.free} strong={false} />
                </td>
                <td className={cn("border-t border-primary/15 px-3.5 py-3 align-top font-semibold text-ink", last && "pb-4")}>
                  <Cell value={row.pro} strong />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── Confianza y pago ─────────────────────────────────────────────────────

function TrustList({ channel, className }: { channel: PurchaseChannel; className?: string }) {
  const items: { icon: typeof Lock; text: ReactNode }[] = [
    { icon: ShieldCheck, text: "Omni no compra ni envía nada sin tu permiso, tampoco en Pro." },
    { icon: RotateCcw, text: "Cancela cuando quieras: Pro sigue hasta el final del mes que pagaste." },
    {
      icon: Lock,
      text: channel === "google_play" ? "Pagas con tu cuenta de Google Play." : "Pago seguro con Stripe: Omni nunca ve tu tarjeta.",
    },
  ];
  return (
    <ul className={cn("flex flex-col gap-3 text-[14px] leading-snug text-muted", className)}>
      {items.map(({ icon: Icon, text }, index) => (
        <li key={index} className="flex items-start gap-3 text-left">
          <Icon className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
          <span>{text}</span>
        </li>
      ))}
    </ul>
  );
}

function CheckoutPanel({
  phase,
  price,
  channel,
  message,
  onUnlock,
  onDone,
}: {
  phase: Phase;
  price: string;
  channel: PurchaseChannel;
  message: string | null;
  onUnlock: () => void;
  onDone: () => void;
}) {
  if (phase === "active") {
    return (
      <div className="rounded-2xl border border-primary/40 bg-primary-soft px-4 py-4 text-center lg:text-left">
        <p className="text-base font-semibold text-ink">Ya tienes Omni Pro</p>
        <p className="mt-1 text-sm text-muted">Tus agentes ya trabajan en piloto automático.</p>
        <button type="button" onClick={onDone} className="paywall-cta mt-4 h-12 w-full rounded-2xl bg-primary text-base font-semibold text-on-primary hover:bg-primary-hover">
          Listo
        </button>
      </div>
    );
  }
  const busy = phase === "paying" || phase === "confirming";
  const busyLabel = phase === "confirming" ? "Activando Pro…" : channel === "google_play" ? "Abriendo Google Play…" : "Abriendo el pago…";
  return (
    <div>
      <button
        type="button"
        onClick={onUnlock}
        disabled={busy}
        className="paywall-cta flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-primary text-[17px] font-semibold text-on-primary transition-[background-color,transform] duration-150 hover:bg-primary-hover active:scale-[0.99] disabled:opacity-75"
      >
        {busy ? <Loader className="size-5 animate-spin" aria-hidden /> : null}
        {busy ? busyLabel : "Desbloquear Omni Pro"}
      </button>
      <p className="mt-2.5 text-center text-[13px] leading-snug text-muted">
        <span className="font-semibold text-ink tabular-nums">{price} al mes.</span> Se renueva cada mes hasta que canceles
        {channel === "google_play" ? " en Google Play" : ""}.
      </p>
      {message ? (
        <p role="status" className="mt-3 rounded-xl bg-surface-2 px-3.5 py-2.5 text-center text-[13px] leading-snug text-ink">
          {message}
        </p>
      ) : null}
    </div>
  );
}
