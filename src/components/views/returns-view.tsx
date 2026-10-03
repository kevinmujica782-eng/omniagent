import { CircleAlert, HandCoins, Inbox, MessageCircle, Send, Truck } from "lucide-react";
import Link from "next/link";
import { OmniMark } from "@/components/omni-mark";
import { CaseCard } from "@/components/returns/case-card";
import { AddOrderButton, ExampleOrdersButton } from "@/components/returns/order-form";
import { OrderRow } from "@/components/returns/order-row";
import { ButtonLink, Chip, IconTile, PageBody, PageHeader, Panel, Section } from "@/components/ui";
import { money, plural } from "@/lib/format";
import type { ReturnCaseView, ReturnsOverviewView, TrackedOrderView } from "@/types/cards";

export type ReturnsViewProps = {
  data: ReturnsOverviewView;
  timeZone: string;
  currency: string;
  /** Desde un aviso: /devoluciones?pedido=… | ?caso=… */
  focus?: { orderId?: string | null; caseId?: string | null };
  /** Vista previa (/preview): sin API. */
  preview?: {
    /** Abre la hoja "¿Qué pasó con tu pedido?" de este pedido. */
    problemOrderId?: string;
  };
};

const FEATURES = [
  { icon: Truck, title: "Sigue tus entregas", body: "Tus compras con Omni y los avisos de envío de tu correo, contra la fecha prometida." },
  { icon: Send, title: "Reclama por ti", body: "Si algo se atrasa o llega mal, redacta el reclamo. Tú lo apruebas antes de que salga." },
  { icon: HandCoins, title: "Hasta que llegue tu dinero", body: "Insiste si la tienda no responde y confirma el reembolso en tus cuentas." },
];

function MailboxHint({ demo }: { demo: boolean }) {
  return (
    <p className="mb-6 flex items-start gap-2 rounded-2xl bg-surface-2 px-4 py-3 text-sm leading-relaxed text-muted">
      <Inbox className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
      <span>
        Conecta tu correo en{" "}
        <Link href={demo ? "/preview?screen=conectar-correo" : "/tramites"} className="font-semibold text-primary underline-offset-2 hover:underline">
          Trámites
        </Link>{" "}
        para que Omni encuentre los pedidos en los correos de tus tiendas y envíe los reclamos por ti.
      </span>
    </p>
  );
}

function Welcome({ timeZone, currency, demo }: { timeZone: string; currency: string; demo: boolean }) {
  return (
    <section className="overflow-hidden rounded-3xl border border-line bg-surface">
      <div className="px-6 pb-7 pt-9 text-center sm:px-10">
        <OmniMark size={52} className="mx-auto" />
        <h2 className="mt-5 text-2xl font-semibold tracking-tight text-balance text-ink">Que tus pedidos lleguen bien</h2>
        <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted">
          Omni sigue tus pedidos hasta que llegan. Si uno se atrasa o llega mal, prepara el reclamo, insiste si la tienda no
          responde y confirma cuando vuelve tu dinero.
        </p>
        <div className="mx-auto mt-6 flex max-w-xs flex-col gap-3 sm:max-w-none sm:flex-row sm:justify-center">
          <AddOrderButton timeZone={timeZone} currency={currency} demo={demo} variant="primary" size="lg" className="w-full sm:w-auto" />
          <ExampleOrdersButton demo={demo} />
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

const time = (iso: string | null) => (iso ? new Date(iso).getTime() : Number.POSITIVE_INFINITY);

export function ReturnsView({ data, timeZone, currency, focus, preview }: ReturnsViewProps) {
  const demo = Boolean(preview);
  const { orders, cases, stats, mailbox } = data;
  const visible = orders.filter((o) => !o.dismissed && o.delivery !== "canceled");
  const needsYou = cases.filter((c) => c.status === "DRAFT" || c.status === "ANSWERED" || c.status === "REJECTED" || (c.status === "SENT" && c.escalated));
  const waiting = cases.filter((c) => c.status === "SENT" && !c.escalated);
  // Un pedido tarde pide atención si nunca tuvo reclamo; si ya tuvo uno (cerrado), sigue en "En camino" con su retraso.
  const needsClaim = (o: TrackedOrderView) => o.delivery === "late" && !o.openCase && o.closedCases === 0;
  const late = visible.filter(needsClaim);
  const onTheWay = visible
    .filter((o) => (o.status === "ORDERED" || o.status === "SHIPPED") && !o.openCase && !needsClaim(o))
    .sort((a, b) => time(a.expectedBy) - time(b.expectedBy));
  // Lo que ya se devolvió y se reembolsó vive en "Resueltos", no en "Entregados".
  const delivered = visible
    .filter((o) => o.delivery === "delivered" && !o.openCase && o.lastOutcome !== "REFUND" && o.lastOutcome !== "STORE_CREDIT")
    .sort((a, b) => time(b.deliveredAt) - time(a.deliveredAt))
    .slice(0, 12);
  const done = cases.filter((c) => c.status === "RESOLVED" || c.status === "CLOSED").slice(0, 6);
  const hidden = orders.filter((o) => o.dismissed || o.delivery === "canceled");
  const sandbox = orders.some((o) => o.sandbox);
  const attention = needsYou.length + late.length;

  const row = (order: TrackedOrderView) => (
    <OrderRow
      key={order.id}
      order={order}
      timeZone={timeZone}
      currency={currency}
      mailboxConnected={mailbox.connected}
      demo={demo}
      highlight={focus?.orderId === order.id}
      openProblem={preview?.problemOrderId === order.id}
    />
  );
  const caseCard = (returnCase: ReturnCaseView) => (
    <CaseCard
      key={returnCase.id}
      returnCase={returnCase}
      timeZone={timeZone}
      demo={demo}
      highlight={focus?.caseId === returnCase.id}
      mailboxConnected={mailbox.connected}
    />
  );

  return (
    <PageBody className="max-w-4xl">
      <PageHeader
        title="Pedidos y devoluciones"
        description="Omni sigue tus pedidos hasta que llegan, te avisa si se atrasan y prepara el reclamo cuando algo sale mal. Nada se envía sin tu aprobación."
        action={
          <ButtonLink href={demo ? "/preview?screen=chat-devoluciones" : "/chat?modulo=devoluciones"} size="sm">
            <MessageCircle className="size-4" aria-hidden />
            Hablar con Omni
          </ButtonLink>
        }
      />

      {!mailbox.connected ? <MailboxHint demo={demo} /> : null}

      {orders.length === 0 ? (
        <Welcome timeZone={timeZone} currency={currency} demo={demo} />
      ) : (
        <>
          <div className="mb-6 flex flex-col gap-3 rounded-2xl border border-line bg-surface px-4 py-4 sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-ink">
                {stats.onTheWay > 0 ? `Siguiendo ${plural(stats.onTheWay, "pedido en camino", "pedidos en camino")}` : "Ningún pedido en camino"}
                {stats.late > 0 ? ` · ${stats.late} con retraso` : ""}
              </p>
              <p className="text-xs leading-relaxed text-muted">
                Reviso tus pedidos en segundo plano{mailbox.connected ? " y los correos de tus tiendas" : ""}. Si uno va 2 días tarde, preparo el reclamo; tú decides si
                se envía.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {stats.recoveredThisMonth > 0 ? (
                <Chip tone="good">
                  <HandCoins className="size-3" aria-hidden />
                  {money(stats.recoveredThisMonth, stats.currency, { cents: true })} recuperados este mes
                </Chip>
              ) : null}
              <AddOrderButton timeZone={timeZone} currency={currency} demo={demo} />
            </div>
          </div>

          {attention > 0 ? (
            <Section
              title={
                <>
                  <CircleAlert className="size-4 text-attention" aria-hidden />
                  Necesitan tu atención <Chip tone="attention">{attention}</Chip>
                </>
              }
            >
              <div className="flex flex-col gap-3">
                {needsYou.map(caseCard)}
                {late.length > 0 ? <Panel>{late.map(row)}</Panel> : null}
              </div>
            </Section>
          ) : null}

          {waiting.length > 0 ? (
            <Section title={`Reclamos en curso (${waiting.length})`} className="mt-8">
              <div className="flex flex-col gap-3">{waiting.map(caseCard)}</div>
            </Section>
          ) : null}

          <Section title="En camino" className="mt-8">
            {onTheWay.length > 0 ? (
              <Panel>{onTheWay.map(row)}</Panel>
            ) : (
              <p className="rounded-2xl border border-dashed border-line-strong px-4 py-4 text-sm text-muted">
                No hay pedidos en camino. Los que hagas en Compras o lleguen a tu correo aparecerán aquí.
              </p>
            )}
          </Section>

          {delivered.length > 0 ? (
            <Section title="Entregados" className="mt-8">
              <Panel>{delivered.map(row)}</Panel>
            </Section>
          ) : null}

          {done.length > 0 ? (
            <Section title="Resueltos" className="mt-8">
              <div className="flex flex-col gap-3">{done.map(caseCard)}</div>
            </Section>
          ) : null}

          {hidden.length > 0 ? (
            <details className="mt-8 rounded-2xl border border-line bg-surface">
              <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-ink">
                Cancelados y sin seguimiento ({hidden.length})
              </summary>
              <div className="divide-y divide-line border-t border-line">{hidden.map(row)}</div>
            </details>
          ) : null}
        </>
      )}

      <p className="mt-10 text-xs leading-relaxed text-muted">
        Omni nunca envía un reclamo solo: los correos salen desde tu bandeja cuando los apruebas, y en las tiendas que atienden por su
        página te deja el mensaje listo. Si la tienda no responde en 2 días hábiles, prepara un seguimiento; después del segundo, te
        dice cómo escalarlo.
        {sandbox ? " Los pedidos de ejemplo usan tiendas de prueba (.test): nada sale a internet y puedes simular su respuesta." : ""}
      </p>
    </PageBody>
  );
}
