// Datos de ejemplo del panel de Inicio: salen de los mismos demos de Finanzas, Trámites y Compras y pasan por
// las reglas reales del panel (gasto del mes con el simulador bancario, lo urgente, el estado de los agentes).
import { PLANS, AGENT_FEATURE_ORDER, AGENT_FEATURES, type PlanId } from "@/modules/billing/plans";
import { buildAgents, buildAttention, countAttention, dateLabelFor, greetingFor, monthStart, monthToDate } from "@/modules/dashboard/rules";
import { simulateAccount } from "@/modules/finance/bank-simulator";
import { median } from "@/modules/concierge/rules/drops";
import { SANDBOX_PRODUCTS, sandboxHistory } from "@/modules/concierge/sandbox/stores";
import { dueText } from "@/modules/dashboard/rules";
import type { BillingOverview } from "@/types/billing";
import type { ActivityItem, DashboardData, FinanceGlance, ProceduresGlance, ShoppingGlance } from "@/types/dashboard";
import { demoConcierge } from "./demo-concierge";
import { demoData } from "./demo-data";
import { demoProcedures } from "./demo-procedures";
import { demoReturns } from "./demo-returns";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export type DemoDashboardVariant = "pro" | "free" | "new";

function billingFor(plan: PlanId, usage: { messages: number; watching: number; formReads: number; pageReads: number; goals: number }): BillingOverview {
  const limits = PLANS[plan];
  return {
    plan,
    planName: limits.name,
    priceLabel: limits.priceLabel,
    source: plan === "PRO" ? "STRIPE" : null,
    status: plan === "PRO" ? "ACTIVE" : null,
    renewsAt: plan === "PRO" ? "2026-10-18T15:00:00.000Z" : null,
    cancelAtPeriodEnd: false,
    notice: null,
    features: AGENT_FEATURE_ORDER.map((id) => ({
      id,
      title: AGENT_FEATURES[id].title,
      enabled: limits.features[id],
      detail: limits.features[id] ? AGENT_FEATURES[id].pro : AGENT_FEATURES[id].free,
    })),
    usage: {
      messages: { used: usage.messages, limit: limits.monthlyMessages },
      formReads: { used: usage.formReads, limit: limits.monthlyFormReads },
      pageReads: { used: usage.pageReads, limit: limits.monthlyPageReads },
      watching: { used: usage.watching, limit: limits.watchlistItems },
      goals: { used: usage.goals, limit: limits.activeGoals },
    },
    checkoutAvailable: true,
    binanceAvailable: true,
  };
}

export function demoDashboard(now: Date, timeZone: string, variant: DemoDashboardVariant = "pro"): DashboardData {
  const plan: PlanId = variant === "pro" ? "PRO" : "FREE";
  if (variant === "new") {
    return {
      now: now.toISOString(),
      timeZone,
      greeting: greetingFor(now, timeZone, "Laura Gómez"),
      dateLabel: dateLabelFor(now, timeZone),
      status: "Listo para ayudarte",
      attention: [],
      attentionTotal: 0,
      attentionCounts: countAttention([]),
      finance: { status: "empty" },
      procedures: { status: "empty" },
      shopping: { status: "empty" },
      agents: buildAgents({
        plan,
        finance: { accounts: 0, lastSyncAt: null },
        mail: { connected: false, lastSyncAt: null },
        prices: { watching: 0, paused: 0, lastCheckAt: null, nextCheckAt: null },
      }),
      savings: null,
      activity: [],
      unreadActivity: 0,
      billing: billingFor(plan, { messages: 0, watching: 0, formReads: 0, pageReads: 0, goals: 0 }),
    };
  }

  const demo = demoData(now);
  const procedures = demoProcedures(now, timeZone);
  const shopping = demoConcierge(now, timeZone);

  // Finanzas: los movimientos del banco de prueba (nómina, ahorros y tarjeta) desde el mes pasado.
  const from = new Date(monthStart(now, timeZone, -1).getTime() - DAY);
  const txs = (["checking", "savings", "credit_card"] as const).flatMap((profile, i) =>
    simulateAccount({ userSeed: "demo-laura", accountId: `demo-${i}`, profile, from, to: now, now }).map((t) => ({
      postedAt: t.postedAt,
      amount: t.amount,
      direction: t.direction,
      currency: "USD",
      merchantName: t.merchantName,
      description: t.description,
      category: t.category,
      subcategory: t.subcategory,
    })),
  );
  const unused = demo.subscriptions.items.filter((s) => s.status === "UNUSED_SUSPECTED");
  const finance: FinanceGlance = {
    currency: "USD",
    ...monthToDate(txs, now, timeZone),
    unusedSubscriptions: { count: unused.length, monthly: demo.subscriptions.unusedMonthlyTotal },
    budgets: {
      over: demo.budgets.filter((b) => b.state === "excedido").length,
      warning: demo.budgets.filter((b) => b.state === "alerta").length,
      total: demo.budgets.length,
    },
    accounts: 3,
    lastSyncAt: new Date(now.getTime() - 3 * HOUR).toISOString(),
  };

  // Trámites: los sugeridos por confirmar y los activos, con la próxima cita del calendario.
  const active = procedures.active;
  const event = active.map((v) => v.event).find((e) => e && new Date(e.startsAt).getTime() > now.getTime()) ?? null;
  const proceduresGlance: ProceduresGlance = {
    toConfirm: procedures.suggested.length,
    due: active.slice(0, 3).map((view) => ({
      id: view.taskId,
      title: view.title,
      when: dueText(view, now, timeZone),
      urgent: view.urgent || view.overdue,
      href: `/tramites?t=${view.taskId}`,
    })),
    nextEvent: event ? { title: event.title, when: dueText({ dueAt: null, dueHasTime: false, overdue: false, event }, now, timeZone) } : null,
    mailboxConnected: true,
    lastSyncAt: procedures.mailbox.lastSyncedAt,
  };

  // Compras: en Gratis caben 3 seguimientos activos (el demo Pro sigue 4).
  const activeItems = shopping.items.filter((i) => i.status === "ACTIVE").slice(0, plan === "PRO" ? undefined : PLANS.FREE.watchlistItems);
  const alert = shopping.alerts[0] ?? null;
  const nextChecks = activeItems.map((i) => i.nextCheckAt).filter((d): d is string => Boolean(d)).sort();
  const shoppingGlance: ShoppingGlance = {
    currency: "USD",
    watching: activeItems.length,
    limit: PLANS[plan].watchlistItems,
    newAlerts: shopping.alerts.filter((a) => a.status === "NEW").length,
    topAlert: alert
      ? { id: alert.id, title: alert.title, price: alert.price, dropPct: alert.dropPct, savings: alert.savings, href: `/compras?alerta=${alert.id}` }
      : null,
    pendingPurchases: 1,
    lastCheckAt: new Date(now.getTime() - 20 * 60_000).toISOString(),
    nextCheckAt: nextChecks[0] ?? null,
  };

  const attention = buildAttention({
    approvals: [demo.purchase, demo.cancelCine, demo.email],
    suggested: procedures.suggested,
    dueSoon: active,
    alerts: shopping.alerts,
    returns: demoReturns(now, timeZone).attention,
    billingNotice: null,
    now,
    timeZone,
  });

  // Ahorro: las zapatillas del pedido de ejemplo se compraron en oferta frente a su precio normal de 30 días.
  const andes = SANDBOX_PRODUCTS.find((p) => p.id === "andes-2");
  const orderAt = new Date(now.getTime() - 9 * DAY);
  const normal = (andes ? median(sandboxHistory(andes, orderAt, 30).map((h) => h.price)) : null) ?? 0;
  const purchases = Math.max(0, Math.round((normal - 90) * 100) / 100);
  const sameMonth = orderAt.getTime() >= monthStart(now, timeZone).getTime();

  const at = (minutesAgo: number) => new Date(now.getTime() - minutesAgo * 60_000).toISOString();
  const activity: ActivityItem[] = [
    { id: "n1", type: "PRICE_DROP", title: alert?.headline ?? "Bajó el precio de un producto que sigues", body: alert?.summary ?? null, href: "/compras", createdAt: at(40), read: false },
    { id: "n2", type: "REMINDER", title: "Mañana: permiso de la excursión", body: "Te dejé el formulario lleno; solo falta tu firma.", href: "/tramites", createdAt: at(170), read: false },
    { id: "n3", type: "ACTION_REQUIRED", title: "Omni quiere darte de baja de CineClub+", body: "Sin uso en 104 días. Dejas de pagar $8.99 al mes.", href: "/aprobaciones", createdAt: at(60 * 26), read: true },
    { id: "n4", type: "INSIGHT", title: "Tu análisis de gastos está listo", body: "Encontré $23.98 al mes en suscripciones que no usas.", href: "/finanzas", createdAt: at(60 * 50), read: true },
    { id: "n5", type: "SYSTEM", title: "Pedido confirmado: Zapatillas de trail Andes 2", body: "$96.50 con Visa de prueba •••• 4242 (simulado).", href: "/compras", createdAt: at(60 * 24 * 9), read: true },
  ];

  const pausedItems = shopping.items.filter((i) => i.status === "PAUSED").length;
  return {
    now: now.toISOString(),
    timeZone,
    greeting: greetingFor(now, timeZone, demo.user.name),
    dateLabel: dateLabelFor(now, timeZone),
    status: `Vigilando ${activeItems.length} precios y 1 trámite`,
    attention: attention.slice(0, 4),
    attentionTotal: attention.length,
    attentionCounts: countAttention(attention),
    finance: { status: "ok", data: finance },
    procedures: { status: "ok", data: proceduresGlance },
    shopping: { status: "ok", data: shoppingGlance },
    agents: buildAgents({
      plan,
      finance: { accounts: 3, lastSyncAt: new Date(now.getTime() - 3 * HOUR) },
      mail: { connected: true, lastSyncAt: new Date(procedures.mailbox.lastSyncedAt ?? now.toISOString()) },
      prices: {
        watching: activeItems.length,
        paused: pausedItems,
        lastCheckAt: new Date(now.getTime() - 20 * 60_000),
        nextCheckAt: nextChecks[0] ? new Date(nextChecks[0]) : null,
      },
    }),
    savings: (() => {
      // Lo que volvió con Devoluciones este mes (la freidora) cuenta como ahorro con Omni.
      const refunds = demoReturns(now, timeZone).overview.stats.recoveredThisMonth;
      const bought = purchases > 0 && sameMonth ? purchases : 0;
      return bought > 0 || refunds > 0 ? { currency: "USD", purchases: bought, monthly: 0, refunds } : null;
    })(),
    activity,
    unreadActivity: activity.filter((a) => !a.read).length,
    billing: billingFor(plan, {
      messages: plan === "PRO" ? 212 : 23,
      watching: activeItems.length,
      formReads: plan === "PRO" ? 3 : 1,
      pageReads: 0,
      goals: 2,
    }),
  };
}
