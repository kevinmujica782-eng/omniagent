import { Check, CircleAlert, Clock, Sparkles, X } from "lucide-react";
import Link from "next/link";
import { AlertCard } from "@/components/concierge/alert-card";
import { OrdersList } from "@/components/concierge/orders-panel";
import { CheckoutButton } from "@/components/concierge/payment-sheet";
import { PriceChart, Sparkline } from "@/components/concierge/price-chart";
import { TrackButton } from "@/components/concierge/track-dialog";
import { WATCH_KIND_ICON } from "@/components/icons";
import { Chip, IconTile } from "@/components/ui";
import { changeText, METHOD_LABEL, ruleText, statusLine } from "@/lib/concierge-copy";
import { money } from "@/lib/format";
import type { CheckoutCard, OffersCard, OrdersCard, PriceAlertCard, PriceHistoryCard, TrackedItemCard } from "@/types/cards";

// Tarjetas del concierge en el chat: seguimientos, ofertas encontradas, alertas, historial, hoja de pago y pedidos.

const shell = "w-full max-w-md rounded-2xl border border-line bg-surface p-4";

function MoreLink({ demo, label = "Ver en Compras" }: { demo: boolean; label?: string }) {
  return (
    <Link href={demo ? "/preview?screen=compras" : "/compras"} className="text-sm font-semibold text-primary underline-offset-2 hover:underline">
      {label}
    </Link>
  );
}

export function TrackedItemCardView({ card, timeZone, demo = false }: { card: TrackedItemCard; timeZone: string; demo?: boolean }) {
  const item = card.item;
  const Icon = WATCH_KIND_ICON[item.kind];
  const change = changeText(item.changePct);
  return (
    <section className={shell}>
      <div className="flex items-start gap-3">
        <IconTile icon={Icon} tone="attention" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs text-muted">Siguiendo{item.merchant ? ` en ${item.merchant}` : ""}</p>
          <p className="mt-0.5 text-[15px] font-semibold leading-snug text-ink">{item.title}</p>
        </div>
        {item.currentPrice !== null ? (
          <div className="shrink-0 text-right">
            <p className="text-lg font-semibold tracking-tight text-ink">{money(item.currentPrice, item.currency, { cents: !Number.isInteger(item.currentPrice) })}</p>
            {change ? <p className="text-[11px] text-muted">{change}</p> : null}
          </div>
        ) : null}
      </div>
      {item.spark.length > 2 ? (
        <div className="mt-3">
          <Sparkline values={item.spark} reference={item.referencePrice} width={320} height={40} className="w-full max-w-full" label={`Precio de ${item.title} en 30 días`} />
        </div>
      ) : null}
      <p className="mt-3 text-sm leading-relaxed text-muted">{ruleText(item.dropAlertPct, item.targetPrice, item.currency)}.</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {item.method ? (
          <Chip tone={item.method === "ai" ? "good" : "neutral"}>
            {item.method === "ai" ? <Sparkles className="size-3" aria-hidden /> : null}
            {METHOD_LABEL[item.method]}
          </Chip>
        ) : null}
        {item.source === "sandbox" ? <Chip tone="attention">Tienda de prueba</Chip> : null}
        <span className="text-xs text-muted">{statusLine(item, new Date(), timeZone)}</span>
      </div>
      <div className="mt-3">
        <MoreLink demo={demo} />
      </div>
    </section>
  );
}

export function OffersCardView({ card, demo = false }: { card: OffersCard; demo?: boolean }) {
  return (
    <section className="w-full max-w-md overflow-hidden rounded-2xl border border-line bg-surface">
      <p className="px-4 pb-2 pt-3.5 text-xs font-semibold text-muted">Tiendas de prueba · “{card.query}”</p>
      <ul className="divide-y divide-line">
        {card.results.slice(0, 4).map((result) => {
          const Icon = WATCH_KIND_ICON[result.kind];
          return (
            <li key={result.url} className="flex items-center gap-3 px-4 py-3">
              <IconTile icon={Icon} size="sm" tone="neutral" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-ink">{result.title}</p>
                <p className="truncate text-xs text-muted">
                  {result.merchant}
                  {result.price !== null ? ` · ${money(result.price, result.currency ?? "USD", { cents: !Number.isInteger(result.price) })}` : ""}
                </p>
              </div>
              {result.blocked ? (
                <Chip>No permite revisiones</Chip>
              ) : (
                <TrackButton
                  label="Seguir"
                  variant="secondary"
                  icon={false}
                  currency={card.currency ?? result.currency ?? "USD"}
                  checkEveryMinutes={card.checkEveryMinutes ?? 1440}
                  demo={demo}
                  initial={result}
                  autoOpen={false}
                />
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function PriceAlertCardView({ card, timeZone, demo = false }: { card: PriceAlertCard; timeZone: string; demo?: boolean }) {
  return (
    <div className="w-full max-w-md">
      <AlertCard alert={card.alert} timeZone={timeZone} demo={demo} compact />
    </div>
  );
}

export function PriceHistoryCardView({ card, timeZone }: { card: PriceHistoryCard; timeZone: string }) {
  const item = card.item;
  const m = (n: number) => money(n, item.currency, { cents: !Number.isInteger(n) });
  return (
    <section className={shell}>
      <p className="text-xs text-muted">Historial de precio · {card.stats.days} días</p>
      <p className="mt-0.5 text-[15px] font-semibold leading-snug text-ink">{item.title}</p>
      <div className="mt-3">
        <PriceChart points={card.points} currency={item.currency} reference={item.referencePrice} target={item.targetPrice} timeZone={timeZone} height={170} />
      </div>
      <dl className="mt-3 grid grid-cols-3 gap-3 rounded-xl bg-surface-2 px-3 py-2.5 text-center">
        <div>
          <dt className="text-xs text-muted">Mínimo</dt>
          <dd className="text-sm font-semibold tabular-nums text-ink">{m(card.stats.min)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Mediana</dt>
          <dd className="text-sm font-semibold tabular-nums text-ink">{m(card.stats.median)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Máximo</dt>
          <dd className="text-sm font-semibold tabular-nums text-ink">{m(card.stats.max)}</dd>
        </div>
      </dl>
    </section>
  );
}

export function CheckoutCardView({ card, demo = false }: { card: CheckoutCard; demo?: boolean }) {
  const view = card.checkout;
  const Icon = WATCH_KIND_ICON[view.kind];
  const total = money(view.total, view.currency, { cents: true });
  return (
    <section className={shell}>
      <div className="flex items-start gap-3">
        <IconTile icon={Icon} tone="attention" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs text-muted">Compra en {view.merchant ?? "la tienda"}</p>
          <p className="mt-0.5 text-[15px] font-semibold leading-snug text-ink">{view.title}</p>
        </div>
        <p className="shrink-0 text-lg font-semibold tracking-tight text-ink">{total}</p>
      </div>
      <div className="mt-3">
        {view.status === "PENDING" ? (
          <>
            <p className="mb-3 text-sm leading-relaxed text-muted">Nada se cobra hasta que lo permitas. {view.guard}</p>
            <CheckoutButton actionId={view.actionId} label="Revisar y decidir" demo={demo} demoCheckout={view} />
          </>
        ) : view.status === "EXECUTED" ? (
          <p className="flex items-start gap-2 text-sm font-medium text-primary">
            <Check className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>{view.resultMessage ?? `Pedido ${view.order?.orderNumber ?? ""} confirmado.`}</span>
          </p>
        ) : view.status === "FAILED" ? (
          <p className="flex items-start gap-2 text-sm text-danger">
            <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>{view.resultMessage ?? "El pago no pasó."}</span>
          </p>
        ) : view.status === "REJECTED" ? (
          <p className="flex items-start gap-2 text-sm text-muted">
            <X className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>Denegaste esta compra. No se cobró nada.</span>
          </p>
        ) : (
          <p className="flex items-start gap-2 text-sm text-muted">
            <Clock className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>Esta autorización venció. Pídele a Omni que la prepare de nuevo.</span>
          </p>
        )}
      </div>
    </section>
  );
}

export function OrdersCardView({ card, timeZone }: { card: OrdersCard; timeZone: string }) {
  return (
    <div className="w-full max-w-md">
      <OrdersList orders={card.items.slice(0, 5)} timeZone={timeZone} />
    </div>
  );
}
