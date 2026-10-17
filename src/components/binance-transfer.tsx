"use client";

import { Check, Copy, Loader } from "lucide-react";
import { useEffect, useId, useState, type FormEvent } from "react";
import { INPUT_CLASS, buttonClass } from "@/components/ui";
import { ApiError, apiFetch, errorMessage, sleep } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import type { BinanceTransferClaimView, BinanceTransferStartView } from "@/types/billing";

// Pago de Omni Pro con Binance Pay a la cuenta personal que cobra: la persona envía USDT a su Pay ID y pega el ID de la
// orden que le muestra Binance. El servidor busca ese pago en el historial de Binance Pay y suma los meses de Pro.
// Sirve en la pantalla de Pro (oscura) y en Cuenta (clara): solo usa los colores del tema.

const PREVIEW_START: BinanceTransferStartView = {
  payId: "123456789",
  payName: "Omni",
  amount: 19.99,
  currency: "USDT",
  currencies: ["USDT", "USDC"],
  startedAt: new Date(0).toISOString(),
};

/** 123456789 → "123 456 789" (se copia sin espacios). */
function groupDigits(value: string): string {
  return /^\d+$/.test(value) ? value.replace(/\B(?=(\d{3})+(?!\d))/g, " ") : value;
}

const usd = (amount: number) => amount.toFixed(2);

/** Binance tarda unos segundos en mostrar un envío en el historial: se busca de nuevo antes de dar el aviso. */
const NOT_FOUND_RETRIES = 2;
const RETRY_DELAY_MS = 4_000;

export function BinanceTransferPanel({
  onPaid,
  preview = false,
  className,
}: {
  onPaid: (result: BinanceTransferClaimView) => void;
  preview?: boolean;
  className?: string;
}) {
  const inputId = useId();
  const [start, setStart] = useState<BinanceTransferStartView | null>(preview ? PREVIEW_START : null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [code, setCode] = useState("");
  const [checking, setChecking] = useState(false);
  const [status, setStatus] = useState<{ tone: "info" | "problem"; text: string } | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (preview) return;
    let alive = true;
    setLoadError(null);
    apiFetch<BinanceTransferStartView>("/api/v1/billing/binance/transfer", { method: "POST" })
      .then((data) => {
        if (alive) setStart(data);
      })
      .catch((error) => {
        if (alive) setLoadError(errorMessage(error));
      });
    return () => {
      alive = false;
    };
  }, [preview, attempt]);

  async function copyPayId() {
    if (!start) return;
    try {
      await navigator.clipboard.writeText(start.payId);
      setCopied(true);
      setTimeout(() => setCopied(false), 2_000);
    } catch {
      setStatus({ tone: "problem", text: `No se pudo copiar. El Pay ID es ${start.payId}.` });
    }
  }

  async function confirm(event: FormEvent) {
    event.preventDefault();
    if (checking) return;
    const value = code.trim();
    if (!value) {
      setStatus({ tone: "problem", text: "Pega el ID de la orden que te mostró Binance." });
      return;
    }
    if (preview) {
      setStatus({ tone: "info", text: "Vista previa: aquí Omni busca tu pago en Binance y activa Pro." });
      return;
    }
    setChecking(true);
    setStatus({ tone: "info", text: "Buscando tu pago en Binance…" });
    for (let round = 0; ; round++) {
      try {
        const result = await apiFetch<BinanceTransferClaimView>("/api/v1/billing/binance/transfer/claim", {
          method: "POST",
          body: { codigo: value },
        });
        setChecking(false);
        setStatus(null);
        onPaid(result);
        return;
      } catch (error) {
        if (error instanceof ApiError && error.code === "payment_not_found" && round < NOT_FOUND_RETRIES) {
          await sleep(RETRY_DELAY_MS);
          continue;
        }
        setChecking(false);
        setStatus({ tone: "problem", text: errorMessage(error) });
        return;
      }
    }
  }

  if (!start) {
    return (
      <div className={cn("rounded-2xl border border-line bg-surface px-4 py-5 text-sm text-muted", className)}>
        {loadError ? (
          <div className="flex flex-col items-start gap-3">
            <p role="alert" className="text-ink">
              {loadError}
            </p>
            <button type="button" onClick={() => setAttempt((n) => n + 1)} className={buttonClass("secondary", "sm")}>
              Reintentar
            </button>
          </div>
        ) : (
          <p className="flex items-center gap-2" role="status">
            <Loader className="size-4 animate-spin" aria-hidden />
            Preparando el pago…
          </p>
        )}
      </div>
    );
  }

  const price = `${usd(start.amount)} ${start.currency}`;
  const otherCurrencies = start.currencies.filter((currency) => currency !== start.currency);
  return (
    <ol className={cn("flex flex-col gap-6", className)}>
      <li className="grid grid-cols-[1.75rem_minmax(0,1fr)] gap-x-3">
        <span aria-hidden className="grid size-7 place-items-center rounded-full bg-primary text-[13px] font-semibold text-on-primary">
          1
        </span>
        <div>
          <p className="text-[15px] font-semibold leading-7 text-ink">
            Envía <span className="tabular-nums">{price}</span> a este Pay ID
          </p>
          {/* El Pay ID nunca se corta: si no cabe al lado del botón, el botón baja. */}
          <div className="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2.5 rounded-2xl border border-line-strong bg-surface px-4 py-3">
            <span className="min-w-0">
              <span className="block text-[12px] text-muted">Pay ID de Binance</span>
              <span className="block whitespace-nowrap text-[22px] font-semibold leading-tight tracking-[0.02em] text-ink tabular-nums">
                {groupDigits(start.payId)}
              </span>
            </span>
            <button
              type="button"
              onClick={copyPayId}
              className={cn(buttonClass("secondary", "sm"), "shrink-0")}
              aria-label={copied ? "Pay ID copiado" : "Copiar el Pay ID"}
            >
              {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
              {copied ? "Copiado" : "Copiar"}
            </button>
          </div>
          <p className="mt-2.5 text-[13px] leading-relaxed text-muted">
            En la app de Binance: Pay → Enviar → Pay ID.
            {start.payName ? <> Verás el nombre «{start.payName}».</> : null}
            {otherCurrencies.length > 0 ? <> También sirve {otherCurrencies.join(" o ")}.</> : null} Con{" "}
            <span className="tabular-nums">{usd(start.amount * 2)}</span> pagas 2 meses.
          </p>
        </div>
      </li>

      <li className="grid grid-cols-[1.75rem_minmax(0,1fr)] gap-x-3">
        <span aria-hidden className="grid size-7 place-items-center rounded-full border border-line-strong text-[13px] font-semibold text-ink">
          2
        </span>
        <form onSubmit={confirm} noValidate>
          <label htmlFor={inputId} className="block text-[15px] font-semibold leading-7 text-ink">
            Pega el ID de la orden
          </label>
          <p className="text-[13px] leading-relaxed text-muted">
            Binance te lo muestra al terminar el envío. Si ya cerraste esa pantalla, búscalo en Pay → Historial.
          </p>
          <input
            id={inputId}
            value={code}
            onChange={(event) => setCode(event.target.value)}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            inputMode="text"
            maxLength={200}
            placeholder="Ej. 284567891234567890"
            className={cn(INPUT_CLASS, "mt-3 h-12 text-base tabular-nums")}
          />
          <button
            type="submit"
            disabled={checking}
            className="mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-primary text-base font-semibold text-on-primary transition-colors hover:bg-primary-hover disabled:opacity-75"
          >
            {checking ? <Loader className="size-5 animate-spin" aria-hidden /> : null}
            {checking ? "Buscando tu pago…" : "Confirmar pago"}
          </button>
          <p
            role="status"
            aria-live="polite"
            className={cn(
              "mt-3 text-[13px] leading-snug empty:hidden",
              status?.tone === "problem" ? "rounded-xl bg-attention-soft px-3.5 py-2.5 text-attention" : "text-muted",
            )}
          >
            {status && !(checking && status.tone === "info") ? status.text : ""}
          </p>
        </form>
      </li>
    </ol>
  );
}
