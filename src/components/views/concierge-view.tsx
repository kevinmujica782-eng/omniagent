import { ArrowRight, BellRing, MessageCircle, ShieldCheck, TrendingDown } from "lucide-react";
import Link from "next/link";
import { OmniMark } from "@/components/omni-mark";
import { AlertCard } from "@/components/concierge/alert-card";
import { OrdersList, PaymentLimitsPanel } from "@/components/concierge/orders-panel";
import { CheckoutButton, OpenPaymentSheet } from "@/components/concierge/payment-sheet";
import { TrackButton } from "@/components/concierge/track-dialog";
import { TrackedList } from "@/components/concierge/tracked-list";
import { WATCH_KIND_ICON } from "@/components/icons";
import { ButtonLink, Chip, IconTile, PageBody, PageHeader, Section } from "@/components/ui";
import { frequencyText } from "@/lib/concierge-copy";
import { money, plural } from "@/lib/format";
import type { CheckoutView, ConciergeSettingsView, OrderView, PriceAlertView, ProductPreviewView, TrackedItemView } from "@/types/cards";

export type ConciergeViewProps = {
  items: TrackedItemView[];
  alerts: PriceAlertView[];
  checkouts: CheckoutView[];
  orders: OrderView[];
  settings: ConciergeSettingsView;
  timeZone: string;
  /** Desde un aviso: /compras?alerta=… | ?producto=… | ?pedido=… */
  focus?: { itemId?: string | null; orderId?: string | null };
  /** Vista previa (/preview): sin API. */
  preview?: {
    catalog: ProductPreviewView[];
    checkout: CheckoutView;
    points: Record<string, { at: string; price: number }[]>;
    /** Abre el diálogo de "Seguir un precio" con esta vista previa. */
    track?: ProductPreviewView;
    /** Abre la hoja de pago con este estado. */
    sheet?: CheckoutView;
    now?: string;
  };
};

const FEATURES = [
  { icon: TrendingDown, title: "Vigila en segundo plano", body: "Revisa los precios solo y respeta lo que cada tienda permite." },
  { icon: BellRing, title: "Alertas que valen la pena", body: "Bajadas frente al precio normal de 30 días, no descuentos inflados." },
  { icon: ShieldCheck, title: "Tú autorizas cada compra", body: "Ves el total final y decides con Permitir o Denegar." },
];

function PendingCheckout({ checkout, demo, demoCheckout }: { checkout: CheckoutView; demo: boolean; demoCheckout?: CheckoutView }) {
  const Icon = WATCH_KIND_ICON[checkout.kind];
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-orbit bg-surface p-4 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <IconTile icon={Icon} tone="attention" size="sm" />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-ink">{checkout.title}</p>
          <p className="truncate text-xs text-muted">
            {checkout.merchant ?? "Tienda"} · total {money(checkout.total, checkout.currency, { cents: true })}
          </p>
        </div>
      </div>
      <CheckoutButton actionId={checkout.actionId} label="Revisar y decidir" demo={demo} demoCheckout={demoCheckout ?? checkout} />
    </div>
  );
}

function Welcome({ settings, demo, catalog }: { settings: ConciergeSettingsView; demo: boolean; catalog?: ProductPreviewView[] }) {
  return (
    <section className="overflow-hidden rounded-3xl border border-line bg-surface">
      <div className="px-6 pb-7 pt-9 text-center sm:px-10">
        <OmniMark size={52} className="mx-auto" />
        <h2 className="mt-5 text-2xl font-semibold tracking-tight text-balance text-ink">Compra en el mejor momento</h2>
        <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted">
          Pega el enlace de un producto, unos boletos o un vuelo. Omni revisa el precio solo, te avisa cuando baja de verdad y
          prepara la compra para que tú la permitas.
        </p>
        <div className="mx-auto mt-6 flex max-w-xs flex-col gap-3 sm:max-w-none sm:flex-row sm:justify-center">
          <TrackButton
            size="lg"
            className="w-full sm:w-auto"
            currency={settings.currency}
            checkEveryMinutes={settings.checkEveryMinutes}
            demo={demo}
            demoCatalog={catalog}
          />
        </div>
      </div>
      <ul className="grid gap-px border-t border-line bg-line sm:grid-cols-3">
        {FEATURES.map((feature) => (
          <li key={feature.title} className="flex items-start gap-3 bg-surface-2 px-5 py-4 sm:flex-col sm:gap-2.5">
            <IconTile icon={feature.icon} size="sm" />
            <div>
              <p className="text-sm font-semibold text-ink">{feature.title}</p>
              <p className="mt-0.5 text-xs leading-relaxed text-muted">{feature.body}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function ConciergeView({ items, alerts, checkouts, orders, settings, timeZone, focus, preview }: ConciergeViewProps) {
  const demo = Boolean(preview);
  const active = items.filter((i) => i.status === "ACTIVE").length;
  const empty = items.length === 0 && orders.length === 0 && alerts.length === 0;
  const trackButton = (
    <TrackButton
      currency={settings.currency}
      checkEveryMinutes={settings.checkEveryMinutes}
      demo={demo}
      demoCatalog={preview?.catalog}
      initial={preview?.track}
    />
  );

  return (
    <PageBody className="max-w-4xl">
      <PageHeader
        title="Compras"
        description="Omni vigila precios de productos, boletos y viajes, te avisa cuando bajan de verdad y compra solo cuando tú lo permites."
        action={
          <ButtonLink href={demo ? "/preview?screen=chat-compras" : "/chat?modulo=compras"} size="sm">
            <MessageCircle className="size-4" aria-hidden />
            Hablar con Omni
          </ButtonLink>
        }
      />

      {empty ? (
        <>
          <Welcome settings={settings} demo={demo} catalog={preview?.catalog} />
          {preview?.track ? trackButton : null}
        </>
      ) : (
        <>
          <div className="mb-6 flex flex-col gap-3 rounded-2xl border border-line bg-surface px-4 py-4 sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-ink">
                Vigilando {plural(active, "precio", "precios")} de {settings.maxItems}
              </p>
              <p className="text-xs leading-relaxed text-muted">
                Reviso {frequencyText(settings.checkEveryMinutes)} en segundo plano
                {settings.plan === "FREE" ? " (con Pro, cada hora)" : ""}. Te aviso solo cuando baja de verdad.
              </p>
            </div>
            {trackButton}
          </div>

          {checkouts.length > 0 ? (
            <Section title={`Por autorizar (${checkouts.length})`}>
              <div className="flex flex-col gap-3">
                {checkouts.map((checkout) => (
                  <PendingCheckout key={checkout.actionId} checkout={checkout} demo={demo} demoCheckout={preview?.checkout} />
                ))}
              </div>
            </Section>
          ) : null}

          {alerts.length > 0 ? (
            <Section
              title={
                <>
                  Ofertas detectadas <Chip tone="attention">{alerts.filter((a) => a.status === "NEW").length || alerts.length}</Chip>
                </>
              }
              className="mt-8"
            >
              <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-2">
                {alerts.map((alert) => (
                  <AlertCard key={alert.id} alert={alert} timeZone={timeZone} demo={demo} demoCheckout={preview?.checkout} now={preview?.now} />
                ))}
              </div>
            </Section>
          ) : null}

          <Section title="Siguiendo" className="mt-8">
            {items.length > 0 ? (
              <TrackedList
                items={items}
                timeZone={timeZone}
                demo={demo}
                demoPoints={preview?.points}
                demoCheckout={preview?.checkout}
                openId={focus?.itemId ?? null}
              />
            ) : (
              <p className="rounded-2xl border border-dashed border-line-strong px-4 py-4 text-sm text-muted">
                No sigues ningún precio ahora. Pega un enlace para empezar.
              </p>
            )}
          </Section>

          {orders.length > 0 ? (
            <Section
              title="Pedidos"
              className="mt-8"
              action={
                <Link href={demo ? "/preview?screen=devoluciones" : "/devoluciones"} className="flex items-center gap-1 text-sm font-semibold text-primary underline-offset-2 hover:underline">
                  Entregas y devoluciones
                  <ArrowRight className="size-3.5" aria-hidden />
                </Link>
              }
            >
              <OrdersList orders={orders} timeZone={timeZone} highlight={focus?.orderId ?? null} />
            </Section>
          ) : null}
        </>
      )}

      <Section title="Pago y límites" className="mt-10">
        <PaymentLimitsPanel settings={settings} demo={demo} />
      </Section>

      {preview?.sheet ? <OpenPaymentSheet checkout={preview.sheet} demo /> : null}
    </PageBody>
  );
}
