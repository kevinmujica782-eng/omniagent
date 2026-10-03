import { CircleAlert, Clock, Mail, PackageCheck, PackageX, Truck, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { MetaLine } from "@/components/returns/meta-line";
import { Chip, IconTile, type ChipTone } from "@/components/ui";
import { money } from "@/lib/format";
import { CASE_STATUS_LABEL, OUTCOME_LABEL, REASON_LABEL, caseStatusLine, deliveryLine } from "@/lib/returns-copy";
import type { DeliveryKindId, ReturnCaseCard, ReturnCaseStatusId, TrackedOrdersCard } from "@/types/cards";

// Tarjetas de pedidos y devoluciones en el chat. El detalle y las acciones viven en /devoluciones; la aprobación del
// correo llega en su propia boleta, justo debajo.

const shell = "w-full max-w-md rounded-2xl border border-line bg-surface p-4";

const DELIVERY_ICON: Record<DeliveryKindId, LucideIcon> = {
  on_the_way: Truck,
  due_today: Clock,
  late: CircleAlert,
  delivered: PackageCheck,
  canceled: PackageX,
};

const STATUS_TONE: Record<ReturnCaseStatusId, ChipTone> = {
  DRAFT: "attention",
  SENT: "neutral",
  ANSWERED: "attention",
  RESOLVED: "good",
  REJECTED: "danger",
  CLOSED: "neutral",
};

function MoreLink({ demo, href }: { demo: boolean; href: string }) {
  return (
    <Link href={demo ? "/preview?screen=devoluciones" : href} className="text-sm font-semibold text-primary underline-offset-2 hover:underline">
      Ver en Devoluciones
    </Link>
  );
}

export function TrackedOrdersCardView({ card, timeZone, demo = false }: { card: TrackedOrdersCard; timeZone: string; demo?: boolean }) {
  return (
    <section className={shell}>
      <h3 className="text-sm font-semibold text-ink">{card.title}</h3>
      <ul className="mt-2 divide-y divide-line">
        {card.items.map((order) => {
          const Icon = DELIVERY_ICON[order.delivery];
          const late = order.delivery === "late";
          return (
            <li key={order.id} className="flex items-start gap-3 py-2.5">
              <IconTile icon={Icon} size="sm" tone={late ? "attention" : order.delivery === "delivered" ? "primary" : "neutral"} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium leading-snug text-ink">{order.title}</p>
                <MetaLine parts={[order.merchant, order.orderNumber && !order.title.includes(order.orderNumber) ? `#${order.orderNumber}` : null]} />
                <p className={late ? "mt-0.5 text-xs font-semibold text-attention" : "mt-0.5 text-xs text-muted"}>{deliveryLine(order, timeZone)}</p>
                {order.openCase ? (
                  <p className="mt-1">
                    <Chip tone={STATUS_TONE[order.openCase.status]}>Reclamo: {CASE_STATUS_LABEL[order.openCase.status].toLowerCase()}</Chip>
                  </p>
                ) : null}
              </div>
              {order.total !== null ? <p className="shrink-0 text-sm font-semibold tabular-nums text-ink">{money(order.total, order.currency, { cents: true })}</p> : null}
            </li>
          );
        })}
      </ul>
      <div className="mt-2">
        <MoreLink demo={demo} href="/devoluciones" />
      </div>
    </section>
  );
}

export function ReturnCaseCardView({ card, timeZone, demo = false }: { card: ReturnCaseCard; timeZone: string; demo?: boolean }) {
  const c = card.returnCase;
  const preview = c.body.split("\n\n").slice(1, 3).join(" ");
  return (
    <section className={shell}>
      <div className="flex items-start gap-3">
        <IconTile icon={Mail} tone={c.status === "RESOLVED" ? "primary" : "attention"} size="sm" />
        <div className="min-w-0 flex-1">
          <MetaLine parts={[`Reclamo a ${c.merchant}`, c.orderNumber ? `#${c.orderNumber}` : null]} />
          <p className="mt-0.5 text-[15px] font-semibold leading-snug text-ink">
            {REASON_LABEL[c.reason]} · {c.orderTitle}
          </p>
          <div className="mt-1.5">
            <Chip tone={STATUS_TONE[c.status]}>{CASE_STATUS_LABEL[c.status]}</Chip>
          </div>
        </div>
      </div>
      <p className="mt-3 text-sm leading-relaxed text-ink">{caseStatusLine(c, timeZone)}</p>
      {/* Con la boleta de aprobación justo debajo, el mensaje ya se ve ahí. */}
      {c.status === "DRAFT" && c.approval?.status !== "PENDING" ? (
        <div className="mt-3 rounded-xl bg-surface-2 px-3 py-2.5">
          <p className="text-xs text-muted">
            {c.sendTo ? `Para: ${c.sendTo} · ` : ""}Pides: {OUTCOME_LABEL[c.desired].toLowerCase()}
          </p>
          <p className="mt-0.5 text-sm font-semibold text-ink">{c.subject}</p>
          <p className="mt-1 line-clamp-3 text-sm leading-relaxed text-muted">{preview}</p>
        </div>
      ) : null}
      {c.escalation.length > 0 ? (
        <ul className="mt-3 flex list-disc flex-col gap-1 pl-5 text-sm leading-relaxed text-ink">
          {c.escalation.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ul>
      ) : null}
      <div className="mt-3">
        <MoreLink demo={demo} href={`/devoluciones?caso=${c.id}`} />
      </div>
    </section>
  );
}
