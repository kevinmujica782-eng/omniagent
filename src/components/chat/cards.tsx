import { CalendarDays, Clock, FileText, Tag, Target } from "lucide-react";
import type { ReactNode } from "react";
import { ApprovalSlip } from "@/components/approval-slip";
import {
  CheckoutCardView,
  OffersCardView,
  OrdersCardView,
  PriceAlertCardView,
  PriceHistoryCardView,
  TrackedItemCardView,
} from "@/components/concierge/chat-cards";
import { InsightsCardView } from "@/components/finance/insights-card";
import { TransactionRow } from "@/components/finance/transaction-row";
import { GOAL_ICON, TASK_ICON } from "@/components/icons";
import { AgendaCardView, FormCardView, InboxDigestView, ProceduresListView } from "@/components/procedures/chat-cards";
import { ReturnCaseCardView, TrackedOrdersCardView } from "@/components/returns/chat-cards";
import { Chip, IconTile, Progress, type ChipTone } from "@/components/ui";
import { UpgradeCardView } from "@/components/upgrade-card";
import { cn } from "@/lib/cn";
import { capitalize } from "@/lib/finance-copy";
import {
  CADENCE_LABEL,
  dateTime,
  days,
  listJoin,
  money,
  monthYear,
  percent,
  plural,
  shortDate,
  signedPercent,
} from "@/lib/format";
import { SUBSCRIPTION_KIND_LABEL } from "@/modules/finance/categories";
import type {
  AgentCard,
  AntExpensesCard,
  BudgetView,
  BudgetsCard,
  FinanceSummaryCard,
  GoalCard,
  MonthlyTrendCard,
  SubscriptionItem,
  SubscriptionsCard,
  TaskCard,
  TrackingCard,
  TransactionsCard,
} from "@/types/cards";

// Tarjetas que acompañan las respuestas de Omni. También se reutilizan en Finanzas, Metas y la landing.

/** En el chat las tarjetas tienen un ancho máximo; en las páginas ocupan su columna. */
const CHAT_WIDTH = "max-w-md";

export function AgentCardView({ card, timeZone, demo }: { card: AgentCard; timeZone?: string; demo?: boolean }) {
  switch (card.kind) {
    case "insights":
      return <InsightsCardView card={card} demo={demo} inChat className="max-w-xl" />;
    case "finance_summary":
      return <FinanceSummaryView card={card} className={CHAT_WIDTH} />;
    case "monthly_trend":
      return <MonthlyTrendView card={card} className={CHAT_WIDTH} />;
    case "transactions":
      return <TransactionsCardView card={card} timeZone={timeZone} className={CHAT_WIDTH} />;
    case "budgets":
      return <BudgetsView card={card} className={CHAT_WIDTH} />;
    case "subscriptions":
      return <SubscriptionsView card={card} className={CHAT_WIDTH} />;
    case "ant_expenses":
      return <AntExpensesView card={card} className={CHAT_WIDTH} />;
    case "approval":
      return <ApprovalSlip card={card} demo={demo} />;
    case "tracking":
      return <TrackingView card={card} className={CHAT_WIDTH} />;
    case "task":
      return <TaskView card={card} timeZone={timeZone} className={CHAT_WIDTH} />;
    case "goal":
      return <GoalView card={card} className={CHAT_WIDTH} />;
    case "inbox_digest":
      return <InboxDigestView card={card} timeZone={timeZone ?? "UTC"} demo={demo} />;
    case "procedures":
      return <ProceduresListView card={card} timeZone={timeZone ?? "UTC"} demo={demo} />;
    case "form":
      return <FormCardView card={card} timeZone={timeZone ?? "UTC"} demo={demo} />;
    case "agenda":
      return <AgendaCardView card={card} timeZone={timeZone ?? "UTC"} demo={demo} />;
    case "tracked_item":
      return <TrackedItemCardView card={card} timeZone={timeZone ?? "UTC"} demo={demo} />;
    case "price_alert":
      return <PriceAlertCardView card={card} timeZone={timeZone ?? "UTC"} demo={demo} />;
    case "offers":
      return <OffersCardView card={card} demo={demo} />;
    case "price_history":
      return <PriceHistoryCardView card={card} timeZone={timeZone ?? "UTC"} />;
    case "checkout":
      return <CheckoutCardView card={card} demo={demo} />;
    case "orders":
      return <OrdersCardView card={card} timeZone={timeZone ?? "UTC"} />;
    case "tracked_orders":
      return <TrackedOrdersCardView card={card} timeZone={timeZone ?? "UTC"} demo={demo} />;
    case "return_case":
      return <ReturnCaseCardView card={card} timeZone={timeZone ?? "UTC"} demo={demo} />;
    case "upgrade":
      return <UpgradeCardView card={card} />;
    default:
      return null;
  }
}

export function CardShell({
  title,
  aside,
  children,
  className,
}: {
  title?: string;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("w-full rounded-2xl border border-line bg-surface p-4", className)}>
      {title ? (
        <header className="mb-3 flex items-baseline justify-between gap-3">
          <h3 className="text-sm font-semibold text-ink">{title}</h3>
          {aside}
        </header>
      ) : null}
      {children}
    </section>
  );
}

export function Stat({
  label,
  value,
  note,
  tone = "ink",
}: {
  label: string;
  value: string;
  note?: string;
  tone?: "ink" | "primary" | "danger";
}) {
  const colors = { ink: "text-ink", primary: "text-primary", danger: "text-danger" };
  return (
    <div className="px-3 first:pl-0 last:pr-0">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className={cn("mt-0.5 text-lg font-semibold tracking-tight tabular-nums", colors[tone])}>{value}</dd>
      {note ? <dd className="text-[11px] leading-tight text-muted">{note}</dd> : null}
    </div>
  );
}

function ChangeChip({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="w-14" aria-hidden />;
  const tone: ChipTone = pct >= 10 ? "attention" : pct <= -5 ? "good" : "neutral";
  return (
    <span className="flex w-14 justify-end">
      <Chip tone={tone}>{signedPercent(pct)}</Chip>
    </span>
  );
}

export function FinanceSummaryView({ card, className }: { card: FinanceSummaryCard; className?: string }) {
  const { currency } = card;
  const spentShare = card.monthlyIncome > 0 ? Math.min(1, card.monthlySpending / card.monthlyIncome) : 1;
  const overspent = card.monthlySaved < 0;

  return (
    <CardShell
      className={className}
      title="Tu mes promedio"
      aside={<span className="text-xs text-muted">últimos {card.periodDays} días</span>}
    >
      <dl className="grid grid-cols-3 divide-x divide-line">
        <Stat label="Entra" value={money(card.monthlyIncome, currency)} />
        <Stat label="Sale" value={money(card.monthlySpending, currency)} />
        <Stat
          label="Te queda"
          value={money(card.monthlySaved, currency)}
          note={overspent ? "gastas de más" : `${percent(card.savingsRate)} del ingreso`}
          tone={overspent ? "danger" : "primary"}
        />
      </dl>

      <div className="mt-4 flex h-2.5 overflow-hidden rounded-full bg-primary-soft" aria-hidden>
        <div className="h-full bg-line-strong" style={{ width: `${spentShare * 100}%` }} />
        <div className="h-full bg-primary" style={{ width: `${(1 - spentShare) * 100}%` }} />
      </div>

      <ul className="mt-3 divide-y divide-line">
        {card.topCategories.slice(0, 5).map((category) => (
          <li key={category.name} className="flex items-center justify-between gap-3 py-2 text-sm">
            <span className="min-w-0 truncate text-ink">{category.name}</span>
            <span className="flex shrink-0 items-center gap-2">
              <span className="tabular-nums text-ink">{money(category.monthly, currency)}</span>
              <ChangeChip pct={category.changePct} />
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-muted">
        Leí {card.transactionCount} movimientos de {listJoin(card.sources)}.
      </p>
    </CardShell>
  );
}

/** "Video · Sin uso hace 104 días" */
export function usageLabel(item: SubscriptionItem): string {
  const kind = item.subcategory ? capitalize(SUBSCRIPTION_KIND_LABEL[item.subcategory] ?? item.subcategory) : null;
  let usage: string;
  if (item.status === "CANCELLATION_REQUESTED") usage = "Baja solicitada";
  else if (item.status === "UNUSED_SUSPECTED" && item.usageSource === "user") usage = "Dijiste que no la usas";
  else if (item.lastUsedDaysAgo === null) usage = "Sin datos de uso";
  else if (item.status === "UNUSED_SUSPECTED") usage = `Sin uso hace ${days(item.lastUsedDaysAgo)}`;
  else if (item.usageSource === "user" && item.lastUsedDaysAgo <= 1) usage = "Confirmaste que la usas";
  else usage = item.lastUsedDaysAgo <= 1 ? "La usaste hace poco" : `La usaste hace ${days(item.lastUsedDaysAgo)}`;
  return kind ? `${kind} · ${usage}` : usage;
}

export function SubscriptionsView({ card, className }: { card: SubscriptionsCard; className?: string }) {
  const unused = card.items.filter((item) => item.status === "UNUSED_SUSPECTED");
  return (
    <CardShell
      className={className}
      title="Suscripciones"
      aside={
        <span className="text-sm font-semibold tabular-nums text-ink">
          {money(card.monthlyTotal, card.currency, { cents: true })}
          <span className="font-normal text-muted"> al mes</span>
        </span>
      }
    >
      {unused.length > 0 ? (
        <p className="mb-1 rounded-xl bg-attention-soft px-3 py-2 text-sm text-attention">
          {unused.length} sin uso: {money(card.unusedMonthlyTotal, card.currency, { cents: true })} al mes que puedes recuperar.
        </p>
      ) : null}
      <ul className="divide-y divide-line">
        {card.items.map((item) => (
          <li key={item.id} className="flex items-center justify-between gap-3 py-2.5">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-ink">{item.merchant}</p>
              <p className={cn("text-xs", item.status === "UNUSED_SUSPECTED" ? "text-attention" : "text-muted")}>
                {usageLabel(item)}
              </p>
            </div>
            <p className="shrink-0 text-sm tabular-nums text-ink">
              {money(item.amount, card.currency, { cents: true })}
              <span className="text-xs text-muted">/{CADENCE_LABEL[item.cadence]}</span>
            </p>
          </li>
        ))}
      </ul>
    </CardShell>
  );
}

export function AntExpensesView({ card, className }: { card: AntExpensesCard; className?: string }) {
  return (
    <CardShell
      className={className}
      title="Gastos hormiga"
      aside={<span className="text-xs text-muted">compras de hasta {money(card.maxAmount, card.currency)}</span>}
    >
      <p className="text-2xl font-semibold tracking-tight tabular-nums text-attention">
        {money(card.monthlyProjection, card.currency)}
        <span className="ml-1 text-sm font-normal text-muted">al mes</span>
      </p>
      <ul className="mt-2 divide-y divide-line">
        {card.items.map((item) => (
          <li key={item.merchant} className="flex items-center justify-between gap-3 py-2 text-sm">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-ink">{item.merchant}</span>
              {item.averageTicket ? (
                <span className="block text-xs text-muted">
                  {money(item.averageTicket, card.currency, { cents: true })} en promedio
                </span>
              ) : null}
            </span>
            <span className="shrink-0 text-muted">{plural(item.count, "compra", "compras")}</span>
            <span className="w-16 shrink-0 text-right tabular-nums text-ink">{money(item.total, card.currency)}</span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-muted">En los últimos {card.periodDays} días.</p>
    </CardShell>
  );
}

/** Ingresos contra gastos en los últimos 3 periodos de 30 días (barras). */
export function MonthlyTrendView({ card, className }: { card: MonthlyTrendCard; className?: string }) {
  const max = Math.max(1, ...card.months.flatMap((m) => [m.income, m.spending]));
  const height = (value: number) => `${Math.max(2, Math.round((value / max) * 100))}%`;
  return (
    <CardShell
      className={className}
      title="Mes a mes"
      aside={
        <span className="flex items-center gap-3 text-xs text-muted" aria-hidden>
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-primary" />
            Entra
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-line-strong" />
            Sale
          </span>
        </span>
      }
    >
      <div
        className="grid gap-2"
        style={{ gridTemplateColumns: `repeat(${Math.max(1, card.months.length)}, minmax(0, 1fr))` }}
        aria-hidden
      >
        {card.months.map((month) => (
          <div key={month.label} className="flex flex-col items-center">
            <div className="flex h-28 items-end gap-1.5">
              <div className="w-5 rounded-t-md bg-primary" style={{ height: height(month.income) }} />
              <div className="w-5 rounded-t-md bg-line-strong" style={{ height: height(month.spending) }} />
            </div>
            <p className={cn("mt-2 text-sm font-semibold tabular-nums", month.net >= 0 ? "text-primary" : "text-danger")}>
              {month.net >= 0 ? "+" : "−"}
              {money(Math.abs(month.net), card.currency)}
            </p>
            <p className="text-center text-[11px] leading-tight text-muted">{month.label}</p>
          </div>
        ))}
      </div>
      <table className="sr-only">
        <caption>Ingresos y gastos por periodo</caption>
        <thead>
          <tr>
            <th scope="col">Periodo</th>
            <th scope="col">Entra</th>
            <th scope="col">Sale</th>
            <th scope="col">Te quedó</th>
          </tr>
        </thead>
        <tbody>
          {card.months.map((month) => (
            <tr key={month.label}>
              <th scope="row">{month.label}</th>
              <td>{money(month.income, card.currency)}</td>
              <td>{money(month.spending, card.currency)}</td>
              <td>{money(month.net, card.currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </CardShell>
  );
}

const BUDGET_TONE = { ok: "primary", alerta: "attention", excedido: "danger" } as const;

/** Fila de presupuesto con barra de avance; `action` va junto al monto (p. ej. quitar). */
export function BudgetRow({ budget, action }: { budget: BudgetView; action?: ReactNode }) {
  const left = budget.monthlyLimit - budget.spent;
  return (
    <div className="py-2.5">
      <div className="mb-1.5 flex items-center justify-between gap-3 text-sm">
        <span className="min-w-0 truncate font-medium text-ink">{budget.category}</span>
        <span className="flex shrink-0 items-center gap-1.5">
          <span className="tabular-nums text-muted">
            <span className="font-semibold text-ink">{money(budget.spent, budget.currency)}</span> de{" "}
            {money(budget.monthlyLimit, budget.currency)}
          </span>
          {action}
        </span>
      </div>
      <Progress
        value={budget.spent}
        max={budget.monthlyLimit}
        tone={BUDGET_TONE[budget.state]}
        label={`${budget.category}: ${budget.pct}% del presupuesto`}
      />
      <p
        className={cn(
          "mt-1 text-xs",
          budget.state === "excedido" ? "text-danger" : budget.state === "alerta" ? "text-attention" : "text-muted",
        )}
      >
        {budget.state === "excedido"
          ? `Te pasaste por ${money(-left, budget.currency)} este mes`
          : `Te quedan ${money(left, budget.currency)} este mes`}
      </p>
    </div>
  );
}

export function BudgetsView({ card, className }: { card: BudgetsCard; className?: string }) {
  return (
    <CardShell className={className} title="Presupuestos del mes">
      <div className="divide-y divide-line">
        {card.items.map((budget) => (
          <BudgetRow key={budget.id} budget={budget} />
        ))}
      </div>
    </CardShell>
  );
}

/** Resultado de una búsqueda de movimientos en el chat ("¿cuánto gasté en delivery?"). */
export function TransactionsCardView({
  card,
  timeZone,
  className,
}: {
  card: TransactionsCard;
  timeZone?: string;
  className?: string;
}) {
  return (
    <CardShell
      className={className}
      title={card.title}
      aside={<span className="shrink-0 text-xs text-muted">{plural(card.count, "movimiento", "movimientos")}</span>}
    >
      {card.totalSpent > 0 && card.totalIncome > 0 ? (
        <dl className="grid grid-cols-2 divide-x divide-line">
          <Stat label="Salió" value={money(card.totalSpent, card.currency)} />
          <Stat label="Entró" value={money(card.totalIncome, card.currency)} tone="primary" />
        </dl>
      ) : (
        <dl>
          <Stat
            label={card.totalIncome > 0 ? "Entró en total" : "Gastaste en total"}
            value={money(card.totalIncome > 0 ? card.totalIncome : card.totalSpent, card.currency, { cents: true })}
            tone={card.totalIncome > 0 ? "primary" : "ink"}
            note={
              card.count > 0
                ? `${money((card.totalIncome > 0 ? card.totalIncome : card.totalSpent) / card.count, card.currency, { cents: true })} en promedio por movimiento`
                : undefined
            }
          />
        </dl>
      )}
      {card.items.length > 0 ? (
        <div className="-mx-4 -mb-4 mt-3 divide-y divide-line border-t border-line">
          {card.items.map((tx) => (
            <TransactionRow key={tx.id} tx={tx} timeZone={timeZone} />
          ))}
        </div>
      ) : (
        <p className="mt-3 text-sm text-muted">No encontré movimientos con esos filtros.</p>
      )}
    </CardShell>
  );
}

export function TrackingView({ card, className }: { card: TrackingCard; className?: string }) {
  const belowCurrent = card.lowestPrice !== null && card.currentPrice !== null && card.lowestPrice < card.currentPrice;
  return (
    <CardShell className={className}>
      <div className="flex items-start gap-3">
        <IconTile icon={Tag} tone="attention" />
        <div className="min-w-0 flex-1">
          <p className="text-xs text-muted">Siguiendo{card.merchant ? ` en ${card.merchant}` : ""}</p>
          <p className="mt-0.5 text-[15px] font-semibold leading-snug text-ink">{card.title}</p>
        </div>
        {card.currentPrice !== null ? (
          <p className="shrink-0 text-lg font-semibold tracking-tight tabular-nums text-ink">
            {money(card.currentPrice, card.currency)}
          </p>
        ) : null}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {card.targetPrice !== null ? <Chip tone="good">Objetivo {money(card.targetPrice, card.currency)}</Chip> : null}
        <Chip>Aviso si baja {card.dropAlertPct}%</Chip>
        {belowCurrent ? <Chip>Mínimo visto {money(card.lowestPrice, card.currency)}</Chip> : null}
      </div>
    </CardShell>
  );
}

export function TaskView({ card, timeZone, className }: { card: TaskCard; timeZone?: string; className?: string }) {
  const Icon = TASK_ICON[card.type] ?? FileText;
  return (
    <CardShell className={className}>
      <div className="flex items-start gap-3">
        <IconTile icon={Icon} />
        <div className="min-w-0 flex-1">
          <p className="text-xs text-muted">Trámite anotado</p>
          <p className="mt-0.5 text-[15px] font-semibold leading-snug text-ink">{card.title}</p>
          {card.notes ? <p className="mt-1 line-clamp-2 text-sm leading-relaxed text-muted">{card.notes}</p> : null}
        </div>
      </div>
      {card.dueAt || card.remindAt ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {card.dueAt ? (
            <Chip tone="attention">
              <CalendarDays className="size-3.5" aria-hidden />
              Vence el {shortDate(card.dueAt, timeZone)}
            </Chip>
          ) : null}
          {card.remindAt ? (
            <Chip>
              <Clock className="size-3.5" aria-hidden />
              Aviso {dateTime(card.remindAt, timeZone)}
            </Chip>
          ) : null}
        </div>
      ) : null}
    </CardShell>
  );
}

export function GoalView({ card, className }: { card: GoalCard; className?: string }) {
  const Icon = GOAL_ICON[card.category] ?? Target;
  const target = card.targetAmount;
  const pct = target ? Math.min(100, Math.round((card.currentAmount / target) * 100)) : null;
  return (
    <CardShell className={className}>
      <div className="flex items-start gap-3">
        <IconTile icon={Icon} />
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-semibold leading-snug text-ink">{card.title}</p>
          {card.description ? <p className="mt-0.5 text-sm text-muted">{card.description}</p> : null}
        </div>
      </div>
      {target ? (
        <div className="mt-3">
          <div className="mb-1.5 flex items-baseline justify-between text-sm">
            <span className="tabular-nums">
              <span className="font-semibold text-ink">{money(card.currentAmount, card.currency)}</span>
              <span className="text-muted"> de {money(target, card.currency)}</span>
            </span>
            <span className="text-xs text-muted tabular-nums">{pct}%</span>
          </div>
          <Progress value={card.currentAmount} max={target} label={`Avance de ${card.title}`} />
        </div>
      ) : null}
      {card.monthlyContribution ? (
        <p className="mt-3 text-sm text-muted">
          Aparta <span className="font-semibold text-ink tabular-nums">{money(card.monthlyContribution, card.currency)}</span> al
          mes{card.targetDate ? ` para llegar en ${monthYear(card.targetDate)}` : ""}.
        </p>
      ) : null}
    </CardShell>
  );
}
