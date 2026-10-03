"use client";

import {
  Bell,
  BellRing,
  CalendarDays,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  CreditCard,
  FileText,
  Landmark,
  Mail,
  PiggyBank,
  RefreshCw,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Tag,
  TrendingDown,
  Undo2,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { SpendPace } from "@/components/dashboard/spend-pace";
import { ThemeCycleButton } from "@/components/theme-toggle";
import { IconTile } from "@/components/ui";
import { UpgradeButton } from "@/components/upgrade-sheet";
import { apiFetch } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { meterTone, previousMonthLabel, timeAgo, versusText, whenAhead } from "@/lib/dashboard-copy";
import { money, shortDate } from "@/lib/format";
import type { AgentFeatureId } from "@/modules/billing/plans";
import type {
  ActivityItem,
  AgentId,
  AgentStatusView,
  AttentionItem,
  AttentionKind,
  DashboardData,
  FinanceGlance,
  ProceduresGlance,
  SavingsGlance,
  SectionState,
  ShoppingGlance,
} from "@/types/dashboard";

// Panel de Inicio: lo que necesita tu permiso, el pulso de Finanzas, Trámites y Compras, qué hacen solos tus
// agentes y tu plan. Pensado primero para el teléfono (una columna) y en rejilla desde pantallas grandes.

type Ctx = { now: Date; timeZone: string; preview: boolean };

function hrefFor(path: string, preview: boolean): string {
  if (!preview) return path;
  const screen = path.replace(/^\//, "").split(/[#?]/)[0] || "inicio";
  return `/preview?screen=${screen}`;
}

const CARD = "rounded-3xl border border-line bg-surface shadow-card";

const ATTENTION_ICON: Record<AttentionKind, LucideIcon> = {
  purchase: ShoppingBag,
  approval: ShieldCheck,
  return: Undo2,
  procedure: FileText,
  alert: TrendingDown,
  billing: CreditCard,
};

const AGENT_ICON: Record<AgentId, LucideIcon> = { finance: Landmark, mail: Mail, prices: Tag };
const AGENT_FEATURE: Record<AgentId, AgentFeatureId> = { finance: "monthly_report", mail: "mail_autopilot", prices: "hourly_prices" };

const ACTIVITY_ICON: Record<ActivityItem["type"], LucideIcon> = {
  PRICE_DROP: TrendingDown,
  ACTION_REQUIRED: ShieldCheck,
  INSIGHT: Sparkles,
  REMINDER: BellRing,
  SYSTEM: Bell,
};

function amountText(amount: AttentionItem["amount"]): string | null {
  if (!amount) return null;
  const value = money(amount.value, amount.currency, { cents: !Number.isInteger(amount.value) });
  if (!amount.period) return value;
  if (amount.period === "al mes") return `${value}/mes`;
  if (amount.period === "al año") return `${value}/año`;
  return `${value} ${amount.period}`;
}

function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-2.5 flex items-center justify-between gap-3 px-1">
      <h2 className="text-sm font-semibold text-ink">{children}</h2>
      {action}
    </div>
  );
}

// ─── Encabezado ──────────────────────────────────────────────────────────

function Header({ data }: { data: DashboardData }) {
  return (
    <header className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <p className="text-sm text-muted">{data.dateLabel}</p>
        <h1 className="mt-0.5 text-[28px] font-semibold leading-tight tracking-tight text-ink">{data.greeting}</h1>
      </div>
      <ThemeCycleButton className="mt-1" />
    </header>
  );
}

// ─── Lo que espera tu visto bueno ────────────────────────────────────────

function Orbit() {
  // El anillo y el punto ámbar de la marca, como fondo discreto de la tarjeta principal.
  return (
    <svg aria-hidden viewBox="0 0 120 120" className="pointer-events-none absolute -right-8 -top-10 size-44 opacity-[0.16]">
      <circle cx="60" cy="60" r="44" fill="none" stroke="currentColor" strokeWidth="9" />
      <circle cx="96" cy="22" r="7" fill="var(--orbit)" />
    </svg>
  );
}

/** "3 aprobaciones · 4 trámites · 1 oferta": cada uno lleva a su lista. */
function AttentionFooter({ counts, ctx }: { counts: DashboardData["attentionCounts"]; ctx: Ctx }) {
  const approvals = counts.purchase + counts.approval;
  const links = [
    approvals > 0 ? { href: "/aprobaciones", label: `${approvals} ${approvals === 1 ? "aprobación" : "aprobaciones"}` } : null,
    counts.return > 0 ? { href: "/devoluciones", label: `${counts.return} ${counts.return === 1 ? "devolución" : "devoluciones"}` } : null,
    counts.procedure > 0 ? { href: "/tramites", label: `${counts.procedure} ${counts.procedure === 1 ? "trámite" : "trámites"}` } : null,
    counts.alert > 0 ? { href: "/compras", label: `${counts.alert} ${counts.alert === 1 ? "oferta" : "ofertas"}` } : null,
  ].filter((l): l is { href: string; label: string } => l !== null);
  return (
    <div className="mt-3 flex items-start gap-1.5 text-sm text-hero-muted">
      <span>Ver:</span>
      {/* Cada enlace lleva su "·" delante y la fila se corre lo que mide el punto: el del primero de cada renglón queda
          fuera del recorte, así ningún renglón empieza con un punto suelto. El p-1/-m-1 deja ver el anillo de foco. */}
      <div className="-m-1 min-w-0 overflow-hidden p-1">
        <p className="-ml-4 flex flex-wrap gap-y-1">
          {links.map((link) => (
            <span key={link.href} className="flex items-center">
              <span aria-hidden className="w-4 shrink-0 text-center">
                ·
              </span>
              <Link href={hrefFor(link.href, ctx.preview)} className="font-semibold text-on-hero underline-offset-2 hover:underline">
                {link.label}
              </Link>
            </span>
          ))}
        </p>
      </div>
    </div>
  );
}

function AttentionHero({ data, ctx }: { data: DashboardData; ctx: Ctx }) {
  const items = data.attention;
  const total = data.attentionTotal;
  return (
    <section
      aria-labelledby="attention-title"
      className="relative overflow-hidden rounded-3xl p-5 text-on-hero shadow-float"
      style={{ background: "linear-gradient(140deg, var(--hero) 0%, var(--hero-2) 100%)" }}
    >
      <Orbit />
      {total === 0 ? (
        <div className="relative">
          <p className="flex items-center gap-2 text-sm text-hero-muted">
            <CircleCheck className="size-4" aria-hidden />
            Todo al día
          </p>
          <p id="attention-title" className="mt-1 text-2xl font-semibold tracking-tight">
            Nada espera tu permiso
          </p>
          <p className="mt-2 max-w-md text-sm leading-relaxed text-hero-muted">
            {data.status}. Si algo necesita tu visto bueno, aparecerá aquí.
          </p>
        </div>
      ) : (
        <div className="relative">
          <p className="text-sm text-hero-muted">Necesita tu visto bueno</p>
          <p id="attention-title" className="mt-1 text-2xl font-semibold tracking-tight">
            {total === 1 ? "1 pendiente" : `${total} pendientes`}
          </p>
          <ul className="mt-4 flex flex-col gap-1.5">
            {items.map((item) => {
              const Icon = ATTENTION_ICON[item.kind];
              const amount = amountText(item.amount);
              return (
                <li key={item.id}>
                  <Link
                    href={hrefFor(item.href, ctx.preview)}
                    className="flex items-center gap-3 rounded-2xl bg-hero-row px-3 py-2.5 transition-colors hover:bg-hero-row-hover"
                  >
                    <span
                      className={cn(
                        "grid size-9 shrink-0 place-items-center rounded-xl",
                        item.kind === "billing" ? "bg-danger-soft text-danger" : "bg-hero-row-hover text-on-hero",
                      )}
                    >
                      <Icon className="size-[18px]" aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{item.title}</span>
                      <span className="block truncate text-xs text-hero-muted">{item.detail}</span>
                    </span>
                    {amount ? <span className="shrink-0 text-sm font-semibold">{amount}</span> : null}
                    <ChevronRight className="size-4 shrink-0 text-hero-muted" aria-hidden />
                  </Link>
                </li>
              );
            })}
          </ul>
          {total > items.length ? <AttentionFooter counts={data.attentionCounts} ctx={ctx} /> : null}
        </div>
      )}
    </section>
  );
}

// ─── Resumen de cada módulo ──────────────────────────────────────────────

function ModuleCard({
  href,
  icon: Icon,
  title,
  ctx,
  children,
}: {
  href: string;
  icon: LucideIcon;
  title: string;
  ctx: Ctx;
  children: ReactNode;
}) {
  return (
    <article className={cn(CARD, "flex min-w-0 flex-col p-4")}>
      <Link href={hrefFor(href, ctx.preview)} className="-m-1 flex items-center gap-2 rounded-xl p-1 text-sm font-semibold text-ink hover:text-primary">
        <Icon className="size-4 text-primary" aria-hidden />
        {title}
        <ChevronRight className="ml-auto size-4 text-muted" aria-hidden />
      </Link>
      <div className="mt-3 flex flex-1 flex-col">{children}</div>
    </article>
  );
}

function SectionProblem({ message, preview }: { message: string; preview: boolean }) {
  const router = useRouter();
  return (
    <div className="flex flex-1 flex-col items-start justify-center gap-3 py-2">
      <p className="flex items-start gap-2 text-sm text-muted">
        <CircleAlert className="mt-0.5 size-4 shrink-0 text-attention" aria-hidden />
        {message}
      </p>
      <button
        type="button"
        onClick={() => (preview ? undefined : router.refresh())}
        className="inline-flex items-center gap-1.5 rounded-full border border-line-strong px-3 py-1.5 text-sm font-semibold text-ink hover:bg-surface-2"
      >
        <RefreshCw className="size-3.5" aria-hidden />
        Reintentar
      </button>
    </div>
  );
}

function SetupPrompt({ text, cta, href, ctx }: { text: string; cta: string; href: string; ctx: Ctx }) {
  return (
    <div className="flex flex-1 flex-col justify-between gap-3">
      <p className="text-sm leading-relaxed text-muted">{text}</p>
      <Link href={hrefFor(href, ctx.preview)} className="self-start text-sm font-semibold text-primary underline-offset-2 hover:underline">
        {cta}
      </Link>
    </div>
  );
}

function FinanceCard({ state, ctx }: { state: SectionState<FinanceGlance>; ctx: Ctx }) {
  return (
    <ModuleCard href="/finanzas" icon={Wallet} title="Finanzas" ctx={ctx}>
      {state.status === "error" ? (
        <SectionProblem message={state.message} preview={ctx.preview} />
      ) : state.status === "empty" ? (
        <SetupPrompt
          text="Conecta tu banco o tarjeta y Omni te dirá en qué se va tu dinero y qué puedes recortar."
          cta="Conectar una cuenta"
          href="/finanzas"
          ctx={ctx}
        />
      ) : (
        <FinanceBody data={state.data} />
      )}
    </ModuleCard>
  );
}

function FinanceBody({ data }: { data: FinanceGlance }) {
  const versus = versusText(data.changePct, previousMonthLabel(data.monthLabel));
  const lower = (data.changePct ?? 0) < 0;
  return (
    <>
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[28px] font-semibold leading-none tracking-tight text-ink">{money(data.spentThisMonth, data.currency)}</p>
          <p className="mt-1.5 text-xs text-muted">gastado en {data.monthLabel}</p>
        </div>
        {versus ? (
          <span
            className={cn(
              "shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold",
              lower ? "bg-primary-soft text-primary" : "bg-attention-soft text-attention",
            )}
          >
            {versus}
          </span>
        ) : null}
      </div>
      {data.daily.length > 1 ? (
        <div className="mt-5">
          <SpendPace
            daily={data.daily}
            previousDaily={data.previousDaily}
            daysInMonth={data.daysInMonth}
            currency={data.currency}
            monthLabel={data.monthLabel}
            previousLabel={previousMonthLabel(data.monthLabel)}
          />
        </div>
      ) : null}
      <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-xl bg-surface-2 px-2.5 py-2">
          <dt className="text-muted">Sin uso</dt>
          <dd className="mt-0.5 font-semibold text-ink">
            {data.unusedSubscriptions.count > 0 ? `${money(data.unusedSubscriptions.monthly, data.currency, { cents: true })}/mes` : "Ninguna"}
          </dd>
        </div>
        <div className="rounded-xl bg-surface-2 px-2.5 py-2">
          <dt className="text-muted">Presupuestos</dt>
          <dd className={cn("mt-0.5 font-semibold", data.budgets.over > 0 ? "text-danger" : data.budgets.warning > 0 ? "text-attention" : "text-ink")}>
            {data.budgets.total === 0
              ? "Sin definir"
              : data.budgets.over > 0
                ? `${data.budgets.over} excedido${data.budgets.over === 1 ? "" : "s"}`
                : data.budgets.warning > 0
                  ? `${data.budgets.warning} cerca del tope`
                  : "En orden"}
          </dd>
        </div>
      </dl>
    </>
  );
}

function ProceduresCard({ state, ctx }: { state: SectionState<ProceduresGlance>; ctx: Ctx }) {
  return (
    <ModuleCard href="/tramites" icon={FileText} title="Trámites" ctx={ctx}>
      {state.status === "error" ? (
        <SectionProblem message={state.message} preview={ctx.preview} />
      ) : state.status === "empty" ? (
        <SetupPrompt
          text="Conecta tu correo y Omni encontrará permisos, citas, facturas y fechas límite por ti."
          cta="Conectar el correo"
          href="/tramites"
          ctx={ctx}
        />
      ) : (
        <ProceduresBody data={state.data} ctx={ctx} />
      )}
    </ModuleCard>
  );
}

function ProceduresBody({ data, ctx }: { data: ProceduresGlance; ctx: Ctx }) {
  const headline = data.toConfirm > 0 ? data.toConfirm : data.due.length;
  const label = data.toConfirm > 0 ? (data.toConfirm === 1 ? "por confirmar" : "por confirmar") : data.due.length === 1 ? "en curso" : "en curso";
  return (
    <>
      <p className="text-[28px] font-semibold leading-none tracking-tight text-ink">{headline}</p>
      <p className="mt-1.5 text-xs text-muted">{label}</p>
      {data.due.length > 0 ? (
        <ul className="mt-3 flex flex-col gap-1.5">
          {data.due.slice(0, 2).map((task) => (
            <li key={task.id}>
              <Link href={hrefFor(task.href, ctx.preview)} className="flex items-start gap-2.5 rounded-xl bg-surface-2 px-3 py-2 hover:bg-primary-soft">
                <span aria-hidden className={cn("mt-1.5 size-2 shrink-0 rounded-full", task.urgent ? "bg-orbit" : "bg-primary")} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-ink">{task.title}</span>
                  <span className={cn("block truncate text-xs", task.urgent ? "font-semibold text-attention" : "text-muted")}>{task.when}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
      {data.nextEvent ? (
        <p className="mt-auto flex items-center gap-1.5 pt-3 text-xs text-muted">
          <CalendarDays className="size-3.5 shrink-0" aria-hidden />
          <span className="truncate">
            Próximo: {data.nextEvent.title} · {data.nextEvent.when}
          </span>
        </p>
      ) : null}
    </>
  );
}

function ShoppingCard({ state, ctx }: { state: SectionState<ShoppingGlance>; ctx: Ctx }) {
  return (
    <ModuleCard href="/compras" icon={ShoppingBag} title="Compras" ctx={ctx}>
      {state.status === "error" ? (
        <SectionProblem message={state.message} preview={ctx.preview} />
      ) : state.status === "empty" ? (
        <SetupPrompt
          text="Pega el enlace de un producto, unos boletos o un vuelo y Omni te avisa cuando baje de verdad."
          cta="Seguir un precio"
          href="/compras"
          ctx={ctx}
        />
      ) : (
        <ShoppingBody data={state.data} ctx={ctx} />
      )}
    </ModuleCard>
  );
}

function ShoppingBody({ data, ctx }: { data: ShoppingGlance; ctx: Ctx }) {
  const top = data.topAlert;
  return (
    <>
      {top ? (
        <Link href={hrefFor(top.href, ctx.preview)} className="-m-1 rounded-2xl p-1 hover:bg-surface-2">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-attention">
            <TrendingDown className="size-3.5" aria-hidden />
            {top.dropPct ? `Bajó ${top.dropPct}%` : "Oferta"}
          </p>
          <p className="mt-1 line-clamp-2 text-sm font-semibold leading-snug text-ink">{top.title}</p>
          <p className="mt-2 flex items-baseline gap-2">
            <span className="text-[28px] font-semibold leading-none tracking-tight text-ink">{money(top.price, data.currency)}</span>
            {top.savings ? <span className="text-xs font-semibold text-primary">ahorras {money(top.savings, data.currency)}</span> : null}
          </p>
        </Link>
      ) : (
        <>
          <p className="text-[28px] font-semibold leading-none tracking-tight text-ink">{data.watching}</p>
          <p className="mt-1.5 text-xs text-muted">{data.watching === 1 ? "precio vigilado" : "precios vigilados"}</p>
        </>
      )}
      <p className="mt-auto flex flex-wrap gap-x-2 gap-y-0.5 pt-3 text-xs text-muted">
        <span>
          {data.watching} de {data.limit} vigilados
        </span>
        {data.pendingPurchases > 0 ? (
          <span className="font-semibold text-attention">
            · {data.pendingPurchases} {data.pendingPurchases === 1 ? "compra" : "compras"} por autorizar
          </span>
        ) : data.nextCheckAt ? (
          <span>· próxima revisión {whenAhead(data.nextCheckAt, ctx.now, ctx.timeZone)}</span>
        ) : null}
      </p>
    </>
  );
}

// ─── Ahorro con Omni ─────────────────────────────────────────────────────

function SavingsStrip({ savings, monthLabel }: { savings: SavingsGlance; monthLabel: string }) {
  const parts: ReactNode[] = [];
  if (savings.purchases > 0) {
    parts.push(
      <span key="p">
        <span className="font-semibold text-ink">{money(savings.purchases, savings.currency, { cents: true })}</span> en compras por debajo de lo normal
      </span>,
    );
  }
  if (savings.refunds > 0) {
    parts.push(
      <span key="r">
        <span className="font-semibold text-ink">{money(savings.refunds, savings.currency, { cents: true })}</span> recuperados con devoluciones
      </span>,
    );
  }
  if (savings.monthly > 0) {
    parts.push(
      <span key="m">
        <span className="font-semibold text-ink">{money(savings.monthly, savings.currency, { cents: true })} al mes</span> en suscripciones que diste de baja
      </span>,
    );
  }
  return (
    <section className={cn(CARD, "flex items-start gap-3 p-4")} aria-label="Ahorro con Omni">
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-attention-soft text-attention">
        <PiggyBank className="size-5" aria-hidden />
      </span>
      <div className="min-w-0 text-sm leading-relaxed text-muted">
        <p className="font-semibold text-ink">Ahorro con Omni en {monthLabel}</p>
        <p className="mt-0.5 flex flex-col gap-0.5 sm:flex-row sm:flex-wrap sm:gap-x-2">
          {parts.map((part, i) => (
            <span key={i}>
              {i > 0 ? <span className="hidden sm:inline">· </span> : null}
              {part}
            </span>
          ))}
        </p>
      </div>
    </section>
  );
}

// ─── Tus agentes ─────────────────────────────────────────────────────────

function StatePill({ state }: { state: AgentStatusView["state"] }) {
  const map = {
    active: { label: "En marcha", className: "bg-primary-soft text-primary", dot: "bg-primary" },
    setup: { label: "Por configurar", className: "bg-surface-2 text-muted", dot: "bg-line-strong" },
    paused: { label: "En pausa", className: "bg-attention-soft text-attention", dot: "bg-attention" },
  }[state];
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold", map.className)}>
      <span aria-hidden className={cn("size-1.5 rounded-full", map.dot, state === "active" && "animate-pulse motion-reduce:animate-none")} />
      {map.label}
    </span>
  );
}

function AgentsPanel({ agents, ctx }: { agents: AgentStatusView[]; ctx: Ctx }) {
  return (
    <section aria-labelledby="agents-title">
      <SectionTitle>
        <span id="agents-title">Tus agentes</span>
      </SectionTitle>
      <ul className={cn(CARD, "divide-y divide-line overflow-hidden")}>
        {agents.map((agent) => {
          const Icon = AGENT_ICON[agent.id];
          const times = [
            agent.lastRunAt ? `Última: ${timeAgo(agent.lastRunAt, ctx.now, ctx.timeZone)}` : null,
            agent.nextRunAt ? `próxima ${whenAhead(agent.nextRunAt, ctx.now, ctx.timeZone)}` : null,
          ].filter(Boolean);
          return (
            <li key={agent.id} className="flex items-start gap-3 px-4 py-3.5">
              <IconTile icon={Icon} size="sm" tone={agent.state === "active" ? "primary" : "neutral"} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <Link href={hrefFor(agent.href, ctx.preview)} className="text-sm font-semibold text-ink hover:text-primary">
                    {agent.name}
                  </Link>
                  <StatePill state={agent.state} />
                </div>
                <p className="mt-0.5 text-sm text-ink">{agent.cadence}</p>
                <p className="text-xs text-muted">{times.length ? times.join(" · ") : agent.detail}</p>
                {agent.proHint ? (
                  <UpgradeButton feature={AGENT_FEATURE[agent.id]} variant="link" className="mt-1 inline-flex items-center gap-1 text-xs">
                    <Sparkles className="size-3.5" aria-hidden />
                    {agent.proHint}
                  </UpgradeButton>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ─── Actividad ───────────────────────────────────────────────────────────

function ActivityPanel({ items, unread, ctx }: { items: ActivityItem[]; unread: number; ctx: Ctx }) {
  const [read, setRead] = useState(unread === 0);
  async function markAll() {
    setRead(true);
    if (!ctx.preview) await apiFetch("/api/v1/notifications/read", { method: "POST", body: {} }).catch(() => setRead(false));
  }
  return (
    <section aria-labelledby="activity-title">
      <SectionTitle
        action={
          unread > 0 && !read ? (
            <button type="button" onClick={markAll} className="text-xs font-semibold text-primary hover:underline">
              Marcar como leído
            </button>
          ) : null
        }
      >
        <span id="activity-title">Actividad</span>
        {unread > 0 && !read ? (
          <span className="ml-2 rounded-full bg-orbit px-1.5 text-[11px] font-bold text-[#2a1d05]">{unread}</span>
        ) : null}
      </SectionTitle>
      {items.length === 0 ? (
        <p className={cn(CARD, "px-4 py-6 text-center text-sm text-muted")}>
          Aquí verás lo que tus agentes hacen por ti: ofertas, recordatorios y pedidos.
        </p>
      ) : (
        <ul className={cn(CARD, "divide-y divide-line overflow-hidden")}>
          {items.map((item) => {
            const Icon = ACTIVITY_ICON[item.type];
            const unreadItem = !item.read && !read;
            const body = (
              <>
                <span
                  className={cn(
                    "mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg",
                    item.type === "PRICE_DROP" ? "bg-attention-soft text-attention" : "bg-surface-2 text-muted",
                  )}
                >
                  <Icon className="size-4" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className={cn("block truncate text-sm", unreadItem ? "font-semibold text-ink" : "text-ink")}>{item.title}</span>
                  {item.body ? <span className="block truncate text-xs text-muted">{item.body}</span> : null}
                </span>
                <span className="shrink-0 text-[11px] text-muted">{timeAgo(item.createdAt, ctx.now, ctx.timeZone)}</span>
                {unreadItem ? <span aria-label="Sin leer" className="mt-1.5 size-2 shrink-0 rounded-full bg-orbit" /> : null}
              </>
            );
            return (
              <li key={item.id}>
                {item.href ? (
                  <Link href={hrefFor(item.href, ctx.preview)} className="flex items-start gap-3 px-4 py-3 hover:bg-surface-2">
                    {body}
                  </Link>
                ) : (
                  <div className="flex items-start gap-3 px-4 py-3">{body}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

// ─── Plan ────────────────────────────────────────────────────────────────

function Meter({ label, used, limit }: { label: string; used: number; limit: number }) {
  const tone = meterTone(used, limit);
  const pct = limit > 0 ? Math.max(0, Math.min(100, Math.round((used / limit) * 100))) : 0;
  const track = { primary: "bg-primary-soft", attention: "bg-attention-soft", danger: "bg-danger-soft" }[tone];
  const fill = { primary: "bg-primary", attention: "bg-attention", danger: "bg-danger" }[tone];
  return (
    <div>
      <div className="mb-1 flex justify-between gap-3 text-xs">
        <span className="text-muted">{label}</span>
        <span className="tabular-nums text-ink">
          {used.toLocaleString("es-US")} de {limit.toLocaleString("es-US")}
        </span>
      </div>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={limit}
        aria-valuenow={used}
        className={cn("h-1.5 w-full overflow-hidden rounded-full", track)}
      >
        <div className={cn("h-full rounded-full", fill)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function PlanPanel({ data, ctx }: { data: DashboardData; ctx: Ctx }) {
  const billing = data.billing;
  const pro = billing.plan === "PRO";
  return (
    <section aria-labelledby="plan-title" className={cn(CARD, "flex flex-col p-4")}>
      <div className="flex items-center justify-between gap-3">
        <p id="plan-title" className="flex items-center gap-2 text-sm font-semibold text-ink">
          {pro ? <Sparkles className="size-4 text-orbit" aria-hidden /> : null}
          Plan {billing.planName}
        </p>
        <Link href={hrefFor("/cuenta", ctx.preview)} className="text-xs font-semibold text-primary hover:underline">
          {pro ? "Administrar" : "Ver planes"}
        </Link>
      </div>
      {billing.notice === "past_due" ? (
        <p className="mt-3 rounded-xl bg-danger-soft px-3 py-2 text-xs font-medium text-danger">
          No pudimos cobrar la renovación. Actualiza tu tarjeta en Cuenta para no perder Pro.
        </p>
      ) : billing.notice === "canceling" && billing.renewsAt ? (
        <p className="mt-3 rounded-xl bg-attention-soft px-3 py-2 text-xs font-medium text-attention">
          Pro termina el {shortDate(billing.renewsAt)}. Puedes reactivarlo cuando quieras.
        </p>
      ) : pro && billing.renewsAt ? (
        <p className="mt-1 text-xs text-muted">Se renueva el {shortDate(billing.renewsAt)}.</p>
      ) : null}
      <div className="mt-3 flex flex-col gap-2.5">
        <Meter label="Mensajes con Omni este mes" used={billing.usage.messages.used} limit={billing.usage.messages.limit} />
        <Meter label="Precios vigilados" used={billing.usage.watching.used} limit={billing.usage.watching.limit} />
        <Meter label="Formularios con IA este mes" used={billing.usage.formReads.used} limit={billing.usage.formReads.limit} />
      </div>
      {!pro ? (
        <div className="mt-4 rounded-2xl bg-primary-soft p-3">
          <p className="text-sm font-semibold text-ink">Tus agentes, en piloto automático</p>
          <p className="mt-0.5 text-xs leading-relaxed text-muted">Correo cada 3 horas, precios cada hora e informe mensual de tus gastos.</p>
          <UpgradeButton className="mt-3 w-full">
            <Sparkles className="size-4" aria-hidden />
            Pasarme a Pro · {billing.priceLabel}
          </UpgradeButton>
        </div>
      ) : null}
    </section>
  );
}

// ─── Primeros pasos (cuenta nueva) ───────────────────────────────────────

function GettingStarted({ ctx }: { ctx: Ctx }) {
  const steps = [
    { icon: Landmark, title: "Conecta tu banco", body: "Gastos hormiga, suscripciones sin uso y ahorro.", href: "/finanzas" },
    { icon: Mail, title: "Conecta tu correo", body: "Permisos, citas y fechas límite, agendados.", href: "/tramites" },
    { icon: Tag, title: "Sigue un precio", body: "Te aviso cuando baje de verdad.", href: "/compras" },
  ];
  return (
    <section aria-labelledby="start-title">
      <SectionTitle>
        <span id="start-title">Primeros pasos</span>
      </SectionTitle>
      <ol className="grid gap-3 sm:grid-cols-3">
        {steps.map((step, i) => (
          <li key={step.href}>
            <Link href={hrefFor(step.href, ctx.preview)} className={cn(CARD, "flex h-full items-start gap-3 p-4 hover:border-line-strong")}>
              <IconTile icon={step.icon} size="sm" />
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-ink">
                  {i + 1}. {step.title}
                </span>
                <span className="mt-0.5 block text-xs leading-relaxed text-muted">{step.body}</span>
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}

// ─── Vista ───────────────────────────────────────────────────────────────

export function DashboardView({ data, preview = false }: { data: DashboardData; preview?: boolean }) {
  const ctx: Ctx = { now: new Date(data.now), timeZone: data.timeZone, preview };
  const newAccount = data.agents.every((a) => a.state === "setup");
  const monthLabel = data.finance.status === "ok" ? data.finance.data.monthLabel : "este mes";
  return (
    <div className="mx-auto w-full max-w-5xl px-4 pb-10 pt-5 sm:px-6 lg:pt-8">
      <Header data={data} />
      <div className="mt-5 grid grid-cols-1 gap-6 lg:grid-cols-12 lg:gap-5">
        <div className="min-w-0 order-1 lg:col-span-8 lg:row-span-2">
          <AttentionHero data={data} ctx={ctx} />
        </div>
        <div className="min-w-0 order-6 lg:order-2 lg:col-span-4">
          <PlanPanel data={data} ctx={ctx} />
        </div>
        <div className="min-w-0 order-2 lg:order-4 lg:col-span-12">
          {newAccount ? (
            <GettingStarted ctx={ctx} />
          ) : (
            <section aria-labelledby="summary-title">
              <SectionTitle>
                <span id="summary-title">Resumen</span>
              </SectionTitle>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <FinanceCard state={data.finance} ctx={ctx} />
                <ProceduresCard state={data.procedures} ctx={ctx} />
                <ShoppingCard state={data.shopping} ctx={ctx} />
              </div>
            </section>
          )}
        </div>
        {data.savings ? (
          <div className="min-w-0 order-3 lg:order-3 lg:col-span-4">
            <SavingsStrip savings={data.savings} monthLabel={monthLabel} />
          </div>
        ) : null}
        <div className="min-w-0 order-4 lg:order-5 lg:col-span-6">
          <AgentsPanel agents={data.agents} ctx={ctx} />
        </div>
        <div className="min-w-0 order-5 lg:order-6 lg:col-span-6">
          <ActivityPanel items={data.activity} unread={data.unreadActivity} ctx={ctx} />
        </div>
      </div>
    </div>
  );
}
