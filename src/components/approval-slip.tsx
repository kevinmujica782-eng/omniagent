"use client";

import { Check, CircleAlert, Clock, ExternalLink, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { CheckoutButton } from "@/components/concierge/payment-sheet";
import { ACTION_ICON } from "@/components/icons";
import { actionIntro, amountLabel } from "@/lib/actions-copy";
import { cn } from "@/lib/cn";
import { money } from "@/lib/format";
import type { ApprovalCard, CheckoutView } from "@/types/cards";

/** Vista previa: la hoja de pago de una boleta de compra de ejemplo. */
function demoCheckoutFrom(card: ApprovalCard): CheckoutView {
  const total = card.amount ?? 0;
  const currency = card.currency ?? "USD";
  return {
    actionId: card.actionId,
    status: "PENDING",
    itemId: "demo-item",
    kind: "PRODUCT",
    title: card.title,
    merchant: card.merchant,
    detail: null,
    quantity: 1,
    unitPrice: total,
    currency,
    lines: [
      { label: "Precio", amount: total, note: null },
      { label: "Envío", amount: 0, note: "Gratis" },
    ],
    total,
    quoteId: "demo",
    lockedUntil: new Date(Date.now() + 86_400_000).toISOString(),
    expiresAt: null,
    methods: [
      { id: "pm_sbx_visa", brand: "visa", label: "Visa de prueba", last4: "4242", sandbox: true, declines: false },
      { id: "pm_sbx_decline", brand: "mastercard", label: "Tarjeta de prueba que rechaza", last4: "0002", sandbox: true, declines: true },
    ],
    defaultMethodId: "pm_sbx_visa",
    delivery: { label: "Envío a domicilio", detail: "Llega en 3 días hábiles · a la dirección que tengas guardada en la tienda" },
    guard: `Solo se cobra si el total sigue en ${money(total, currency, { cents: true })} o menos.`,
    notes: ["Pago simulado: no se cobra a ninguna tarjeta ni se envía el pedido a una tienda real."],
    sandbox: true,
    limits: { perOrder: 500, monthlyRemaining: 1000 },
    order: null,
    resultMessage: null,
    priceChanged: null,
  };
}

/**
 * Boleta de aprobación: el elemento de firma de OmniAgent.
 * Arriba, qué quiere hacer Omni; abajo (tras la perforación), cuánto cuesta y tu decisión.
 * Con `demo` no llama a la API (landing y vista previa).
 */
export function ApprovalSlip({ card: initial, demo = false }: { card: ApprovalCard; demo?: boolean }) {
  const router = useRouter();
  const [card, setCard] = useState(initial);
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const Icon = ACTION_ICON[card.type];
  const intro = actionIntro(card.type, card.merchant);

  async function decide(decision: "approve" | "reject") {
    setBusy(decision);
    setError(null);
    try {
      if (demo) {
        await new Promise((resolve) => setTimeout(resolve, 450));
        setCard({
          ...card,
          status: decision === "approve" ? "EXECUTED" : "REJECTED",
          resultMessage: decision === "approve" ? "Demostración: no se cobró ni se envió nada." : null,
        });
        return;
      }
      const res = await fetch(`/api/v1/actions/${card.actionId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setError(json?.error?.message ?? "No se pudo registrar tu decisión.");
        return;
      }
      setCard(json.data as ApprovalCard);
      startTransition(() => router.refresh());
    } catch {
      setError("Sin conexión. Inténtalo de nuevo.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <article className="slip w-full max-w-md" aria-label={`${intro} ${card.title}`}>
      <div className="slip-body px-4 pb-4 pt-4">
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary">
            <Icon className="size-5" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-xs text-muted">{intro}</p>
            <p className="mt-0.5 text-base font-semibold leading-snug text-ink">{card.title}</p>
          </div>
        </div>
        {card.summary ? <p className="mt-3 text-sm leading-relaxed text-muted">{card.summary}</p> : null}
        {card.lines.length > 0 ? (
          <dl className="mt-3 flex flex-col gap-1.5 text-sm">
            {card.lines.map((line) =>
              line.value.length > 40 ? (
                <div key={line.label} className="flex flex-col gap-0.5">
                  <dt className="text-muted">{line.label}</dt>
                  <dd className="whitespace-pre-line rounded-xl bg-surface-2 px-3 py-2 leading-relaxed text-ink">{line.value}</dd>
                </div>
              ) : (
                <div key={line.label} className="flex items-baseline justify-between gap-4">
                  <dt className="shrink-0 text-muted">{line.label}</dt>
                  <dd className="min-w-0 text-right font-medium text-ink tabular-nums">{line.value}</dd>
                </div>
              ),
            )}
          </dl>
        ) : null}
        {card.link ? (
          <a
            href={card.link.href}
            target="_blank"
            rel="noopener"
            className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-primary underline-offset-4 hover:underline"
          >
            {card.link.label}
            <ExternalLink className="size-3.5" aria-hidden />
          </a>
        ) : null}
      </div>

      <div className="slip-stub px-4 pb-4 pt-3.5">
        {card.amount !== null ? (
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-sm text-muted">{amountLabel(card.type)}</span>
            <span className="text-2xl font-semibold tracking-tight text-ink tabular-nums">
              {money(card.amount, card.currency ?? "USD", { cents: true })}
              {card.amountPeriod ? <span className="ml-1 text-sm font-normal text-muted">{card.amountPeriod}</span> : null}
            </span>
          </div>
        ) : null}

        {card.status === "PENDING" && card.type === "PURCHASE" ? (
          <div className={cn("flex flex-col gap-1.5", card.amount !== null && "mt-3.5")}>
            <CheckoutButton
              actionId={card.actionId}
              label="Revisar y decidir"
              size="md"
              block
              demo={demo}
              demoCheckout={demo ? demoCheckoutFrom(card) : undefined}
            />
            <p className="text-center text-xs text-muted">Las compras se autorizan en la hoja de pago: Permitir o Denegar.</p>
          </div>
        ) : card.status === "PENDING" ? (
          <div className={cn("grid grid-cols-2 gap-2", card.amount !== null && "mt-3.5")}>
            <button
              type="button"
              onClick={() => decide("reject")}
              disabled={busy !== null}
              className="rounded-full border border-line-strong bg-surface px-4 py-2.5 text-sm font-semibold text-ink transition-colors hover:bg-surface-2 disabled:opacity-50"
            >
              {busy === "reject" ? "Rechazando…" : "Rechazar"}
            </button>
            <button
              type="button"
              onClick={() => decide("approve")}
              disabled={busy !== null}
              className="rounded-full bg-primary px-4 py-2.5 text-sm font-semibold text-on-primary transition-colors hover:bg-primary-hover disabled:opacity-50"
            >
              {busy === "approve" ? "Aprobando…" : "Aprobar"}
            </button>
          </div>
        ) : (
          <Outcome card={card} spaced={card.amount !== null} />
        )}
        {error ? (
          <p role="alert" className="mt-2 text-sm text-danger">
            {error}
          </p>
        ) : null}
      </div>
    </article>
  );
}

function Outcome({ card, spaced }: { card: ApprovalCard; spaced: boolean }) {
  const base = cn("flex items-start gap-2 text-sm", spaced && "mt-3");
  switch (card.status) {
    case "EXECUTED":
      return (
        <p className={cn(base, "font-medium text-primary")}>
          <Check className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>{card.resultMessage ?? "Hecho."}</span>
        </p>
      );
    case "APPROVED":
      return (
        <p className={cn(base, "text-muted")}>
          <Clock className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>Aprobada. Omni la está ejecutando…</span>
        </p>
      );
    case "REJECTED":
      return (
        <p className={cn(base, "text-muted")}>
          <X className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>Rechazaste esta propuesta. No se hizo nada.</span>
        </p>
      );
    case "FAILED":
      return (
        <p className={cn(base, "text-danger")}>
          <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>{card.resultMessage ?? "No se pudo completar."}</span>
        </p>
      );
    default:
      return (
        <p className={cn(base, "text-muted")}>
          <Clock className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>Esta propuesta venció. Pídele a Omni que la prepare de nuevo.</span>
        </p>
      );
  }
}
