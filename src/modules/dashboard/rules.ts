// Reglas puras del panel de Inicio (sin base de datos): saludo, gasto del mes, lo urgente y el estado de los
// agentes. Las usan el servidor, la vista previa y las pruebas unitarias.
import { cadenceText, PLANS, type PlanId } from "@/modules/billing/plans";
import type { TxLike } from "@/modules/finance/analyzers";
import { isNeutralCategory } from "@/modules/finance/categories";
import { clockTime, longDate, relativeDay } from "@/modules/procedures/time/es-dates";
import { localParts, zonedToUtc } from "@/modules/procedures/time/tz";
import type { ApprovalCard, ProcedureView } from "@/types/cards";
import type { AgentStatusView, AttentionItem, FinanceGlance } from "@/types/dashboard";

const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const round2 = (n: number) => Math.round(n * 100) / 100;

export function greetingFor(now: Date, timeZone: string, name: string | null): string {
  const { hour } = localParts(now, timeZone);
  const base = hour >= 5 && hour < 12 ? "Buenos días" : hour >= 12 && hour < 19 ? "Buenas tardes" : "Buenas noches";
  const first = name?.trim().split(/\s+/)[0];
  return first ? `${base}, ${first}` : base;
}

/** "Domingo 27 de septiembre" */
export function dateLabelFor(now: Date, timeZone: string): string {
  const text = longDate(now, timeZone);
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Primer instante del mes local de `now` desplazado `offset` meses (0 = este mes, -1 = el pasado). */
export function monthStart(now: Date, timeZone: string, offset = 0): Date {
  const p = localParts(now, timeZone);
  const base = new Date(Date.UTC(p.year, p.month - 1 + offset, 1));
  return zonedToUtc({ year: base.getUTCFullYear(), month: base.getUTCMonth() + 1, day: 1 }, timeZone);
}

/**
 * Gasto del mes hasta hoy, comparado con el mes pasado hasta el mismo día (no contra el mes completo,
 * que siempre parecería mayor). Transferencias y pagos de tarjeta no cuentan.
 */
export function monthToDate(
  txs: TxLike[],
  now: Date,
  timeZone: string,
): Pick<
  FinanceGlance,
  "monthLabel" | "spentThisMonth" | "spentSamePointLastMonth" | "changePct" | "daily" | "previousDaily" | "daysInMonth" | "topCategory"
> {
  const today = localParts(now, timeZone);
  const thisStart = monthStart(now, timeZone).getTime();
  const lastStart = monthStart(now, timeZone, -1).getTime();
  // Mismo día y hora del mes pasado (si el mes pasado fue más corto, hasta su último día).
  const lastMonthDays = new Date(Date.UTC(today.year, today.month - 1, 0)).getUTCDate();
  const lastParts = new Date(Date.UTC(today.year, today.month - 2, 1));
  const samePoint = zonedToUtc(
    {
      year: lastParts.getUTCFullYear(),
      month: lastParts.getUTCMonth() + 1,
      day: Math.min(today.day, lastMonthDays),
      hour: today.hour,
      minute: today.minute,
    },
    timeZone,
  ).getTime();

  const daysInMonth = new Date(Date.UTC(today.year, today.month, 0)).getUTCDate();
  const daily = Array.from({ length: today.day }, (_, i) => ({ day: i + 1, amount: 0 }));
  const previousDaily = Array.from({ length: lastMonthDays }, (_, i) => ({ day: i + 1, amount: 0 }));
  const categories = new Map<string, number>();
  let spent = 0;
  let previous = 0;
  let hasPrevious = false;
  for (const tx of txs) {
    const at = tx.postedAt.getTime();
    if (at < lastStart) hasPrevious = true;
    if (tx.direction !== "DEBIT" || isNeutralCategory(tx.category)) continue;
    if (at >= thisStart && at <= now.getTime()) {
      spent += tx.amount;
      const day = localParts(tx.postedAt, timeZone).day;
      if (daily[day - 1]) daily[day - 1].amount += tx.amount;
      const name = tx.category ?? "Otros";
      categories.set(name, (categories.get(name) ?? 0) + tx.amount);
    } else if (at >= lastStart && at < thisStart) {
      if (at < samePoint) previous += tx.amount;
      const day = localParts(tx.postedAt, timeZone).day;
      if (previousDaily[day - 1]) previousDaily[day - 1].amount += tx.amount;
    }
  }
  // Sin movimientos anteriores al mes pasado, la comparación no es justa (la cuenta se conectó hace poco).
  const comparable = hasPrevious || previous > 0;
  const top = [...categories.entries()].sort((a, b) => b[1] - a[1])[0];
  return {
    monthLabel: MONTHS[today.month - 1],
    spentThisMonth: round2(spent),
    spentSamePointLastMonth: comparable ? round2(previous) : null,
    changePct: comparable && previous > 0 ? Math.round(((spent - previous) / previous) * 100) : null,
    daily: daily.map((d) => ({ day: d.day, amount: round2(d.amount) })),
    previousDaily: comparable ? previousDaily.map((d) => ({ day: d.day, amount: round2(d.amount) })) : [],
    daysInMonth,
    topCategory: top ? { name: top[0], amount: round2(top[1]) } : null,
  };
}

/** "vence hoy 7:00 p. m.", "vence mañana", "venció el lunes 28 de septiembre" */
export function dueText(view: Pick<ProcedureView, "dueAt" | "dueHasTime" | "overdue" | "event">, now: Date, timeZone: string): string {
  if (view.event) {
    const at = new Date(view.event.startsAt);
    return `${relativeDay(at, now, timeZone)}${view.event.allDay ? "" : ` a las ${clockTime(at, timeZone)}`}`;
  }
  if (!view.dueAt) return "sin fecha";
  const at = new Date(view.dueAt);
  const day = relativeDay(at, now, timeZone);
  if (view.overdue) return `venció ${day}`;
  return `vence ${day}${view.dueHasTime ? ` a las ${clockTime(at, timeZone)}` : ""}`;
}

type AttentionInput = {
  approvals: ApprovalCard[];
  suggested: ProcedureView[];
  dueSoon: ProcedureView[];
  alerts: { id: string; title: string; headline: string; price: number; currency: string; status: string }[];
  /** Pedidos retrasados y reclamos que esperan un paso tuyo (Devoluciones). */
  returns?: { id: string; title: string; detail: string; href: string; amount: number | null; currency: string }[];
  billingNotice: "past_due" | "canceling" | null;
  now: Date;
  timeZone: string;
};

export function countAttention(items: AttentionItem[]): Record<AttentionItem["kind"], number> {
  const counts = { purchase: 0, approval: 0, return: 0, procedure: 0, alert: 0, billing: 0 };
  for (const item of items) counts[item.kind]++;
  return counts;
}

/** Lo que necesita al usuario, en orden: pagos con problema, compras por autorizar, aprobaciones, devoluciones, trámites y ofertas. */
export function buildAttention(input: AttentionInput): AttentionItem[] {
  const items: AttentionItem[] = [];
  if (input.billingNotice === "past_due") {
    items.push({
      id: "billing",
      kind: "billing",
      title: "Actualiza tu tarjeta",
      detail: "No pudimos cobrar la renovación de Pro. Lo mantienes mientras se reintenta.",
      href: "/cuenta",
      amount: null,
    });
  }
  for (const card of input.approvals.filter((a) => a.type === "PURCHASE")) {
    items.push({
      id: `approval-${card.actionId}`,
      kind: "purchase",
      title: card.title,
      detail: "Permite o deniega la compra",
      href: "/aprobaciones",
      amount: card.amount !== null ? { value: card.amount, currency: card.currency ?? "USD", period: null } : null,
    });
  }
  for (const card of input.approvals.filter((a) => a.type !== "PURCHASE")) {
    items.push({
      id: `approval-${card.actionId}`,
      kind: "approval",
      title: card.title,
      detail: card.summary ?? "Espera tu visto bueno",
      href: "/aprobaciones",
      amount: card.amount !== null ? { value: card.amount, currency: card.currency ?? "USD", period: card.amountPeriod } : null,
    });
  }
  for (const item of input.returns ?? []) {
    items.push({
      id: `return-${item.id}`,
      kind: "return",
      title: item.title,
      detail: item.detail,
      href: item.href,
      amount: item.amount !== null ? { value: item.amount, currency: item.currency, period: null } : null,
    });
  }
  const seen = new Set<string>();
  for (const view of [...input.dueSoon, ...input.suggested]) {
    if (seen.has(view.taskId)) continue;
    seen.add(view.taskId);
    const suggested = view.status === "SUGGESTED";
    if (!suggested && !view.urgent && !view.overdue) continue;
    items.push({
      id: `task-${view.taskId}`,
      kind: "procedure",
      title: view.title,
      detail: suggested ? `Confirma las fechas · ${dueText(view, input.now, input.timeZone)}` : dueText(view, input.now, input.timeZone),
      href: `/tramites?t=${view.taskId}`,
      amount: view.amount !== null ? { value: view.amount, currency: view.currency, period: null } : null,
    });
  }
  for (const alert of input.alerts.filter((a) => a.status === "NEW")) {
    items.push({
      id: `alert-${alert.id}`,
      kind: "alert",
      title: alert.headline,
      detail: "Oferta nueva",
      href: `/compras?alerta=${alert.id}`,
      amount: { value: alert.price, currency: alert.currency, period: null },
    });
  }
  return items;
}

type AgentsInput = {
  plan: PlanId;
  finance: { accounts: number; lastSyncAt: Date | null };
  mail: { connected: boolean; lastSyncAt: Date | null };
  prices: { watching: number; paused: number; lastCheckAt: Date | null; nextCheckAt: Date | null };
};

/** Los tres agentes autónomos con lo que hacen solos según el plan (y qué cambiaría con Pro). */
export function buildAgents(input: AgentsInput): AgentStatusView[] {
  const limits = PLANS[input.plan];
  const pro = PLANS.PRO;
  const free = input.plan === "FREE";
  const iso = (d: Date | null) => d?.toISOString() ?? null;

  const finance: AgentStatusView =
    input.finance.accounts === 0
      ? {
          id: "finance",
          name: "Finanzas",
          state: "setup",
          cadence: "Conecta una cuenta para empezar",
          detail: "Analiza gastos, suscripciones y ahorro",
          lastRunAt: null,
          nextRunAt: null,
          proHint: null,
          href: "/finanzas",
        }
      : {
          id: "finance",
          name: "Finanzas",
          state: "active",
          cadence: limits.features.monthly_report ? "Sincroniza cada día e informe mensual" : "Sincroniza tus cuentas cada día",
          detail: `${input.finance.accounts} ${input.finance.accounts === 1 ? "cuenta conectada" : "cuentas conectadas"}`,
          lastRunAt: iso(input.finance.lastSyncAt),
          nextRunAt: null,
          proHint: free ? "Con Pro: informe mensual automático" : null,
          href: "/finanzas",
        };

  const mail: AgentStatusView = input.mail.connected
    ? {
        id: "mail",
        name: "Correo",
        state: "active",
        cadence: `Revisa tu correo ${cadenceText(limits.mailCheckHours * 60)}`,
        detail: "Detecta trámites, citas y fechas límite",
        lastRunAt: iso(input.mail.lastSyncAt),
        nextRunAt: null,
        proHint: free ? `Con Pro: ${cadenceText(pro.mailCheckHours * 60)}` : null,
        href: "/tramites",
      }
    : {
        id: "mail",
        name: "Correo",
        state: "setup",
        cadence: "Conecta tu correo para detectar trámites",
        detail: "Permisos, citas, facturas y reembolsos",
        lastRunAt: null,
        nextRunAt: null,
        proHint: null,
        href: "/tramites",
      };

  const prices: AgentStatusView =
    input.prices.watching > 0
      ? {
          id: "prices",
          name: "Precios",
          state: "active",
          cadence: `Revisa ${input.prices.watching} ${input.prices.watching === 1 ? "precio" : "precios"} ${cadenceText(limits.priceCheckMinutes)}`,
          detail: `${input.prices.watching} de ${limits.watchlistItems} seguimientos`,
          lastRunAt: iso(input.prices.lastCheckAt),
          nextRunAt: iso(input.prices.nextCheckAt),
          proHint: free ? `Con Pro: ${cadenceText(pro.priceCheckMinutes)} y hasta ${pro.watchlistItems}` : null,
          href: "/compras",
        }
      : {
          id: "prices",
          name: "Precios",
          state: input.prices.paused > 0 ? "paused" : "setup",
          cadence: input.prices.paused > 0 ? "Seguimientos en pausa" : "Sigue un producto y te aviso cuando baje",
          detail: "Productos, boletos, vuelos y hoteles",
          lastRunAt: iso(input.prices.lastCheckAt),
          nextRunAt: null,
          proHint: null,
          href: "/compras",
        };

  return [finance, mail, prices];
}
