import "server-only";
import { prisma } from "@/lib/db";
import { agentStatusLine } from "@/lib/format";
import { log } from "@/lib/log";
import { listActions } from "@/modules/actions/actions.service";
import { billingOverview } from "@/modules/billing/overview";
import { listAlertViews } from "@/modules/concierge/alerts.service";
import { monthlyEquivalent, type Cadence } from "@/modules/finance/analyzers";
import { listBudgets } from "@/modules/finance/budgets.service";
import { getSubscriptions, loadTransactions } from "@/modules/finance/finance.service";
import { MAIL_PROVIDERS } from "@/modules/procedures/mail/mailbox";
import { listProcedures } from "@/modules/procedures/plan";
import { clockTime, relativeDay } from "@/modules/procedures/time/es-dates";
import { safeTimeZone } from "@/modules/procedures/time/tz";
import { returnsGlance } from "@/modules/returns/returns.service";
import type {
  ActivityItem,
  DashboardData,
  FinanceGlance,
  ProceduresGlance,
  SavingsGlance,
  SectionState,
  ShoppingGlance,
} from "@/types/dashboard";
import { buildAgents, buildAttention, countAttention, dateLabelFor, dueText, greetingFor, monthStart, monthToDate } from "./rules";

const BANK_PROVIDERS = ["BANK_DEMO", "BANK_AGGREGATOR"] as const;
const ATTENTION_VISIBLE = 4;

/** Carga una sección sin tumbar el panel: si falla, esa tarjeta muestra el error y "Reintentar". */
async function section<T>(name: string, userId: string, load: () => Promise<SectionState<T>>, message: string): Promise<SectionState<T>> {
  try {
    return await load();
  } catch (error) {
    log.error("dashboard.section_failed", { section: name, userId, error });
    return { status: "error", message };
  }
}

async function financeSection(userId: string, now: Date, timeZone: string, currency: string): Promise<SectionState<FinanceGlance>> {
  const [accounts, lastSync] = await Promise.all([
    prisma.financialAccount.count({ where: { userId } }),
    prisma.integrationConnection.findFirst({
      where: { userId, provider: { in: [...BANK_PROVIDERS] }, status: "ACTIVE" },
      orderBy: { lastSyncedAt: "desc" },
      select: { lastSyncedAt: true },
    }),
  ]);
  if (accounts === 0) return { status: "empty" };
  // Desde un día antes del mes pasado: alcanza para la comparación y para saber si hay historial previo.
  const since = new Date(monthStart(now, timeZone, -1).getTime() - 86_400_000);
  const [txs, subscriptions, budgets] = await Promise.all([
    loadTransactions(userId, since),
    getSubscriptions(userId, true),
    listBudgets(userId),
  ]);
  const unused = subscriptions?.items.filter((s) => s.status === "UNUSED_SUSPECTED") ?? [];
  return {
    status: "ok",
    data: {
      currency: subscriptions?.currency ?? currency,
      ...monthToDate(txs, now, timeZone),
      unusedSubscriptions: { count: unused.length, monthly: subscriptions?.unusedMonthlyTotal ?? 0 },
      budgets: {
        over: budgets.filter((b) => b.state === "excedido").length,
        warning: budgets.filter((b) => b.state === "alerta").length,
        total: budgets.length,
      },
      accounts,
      lastSyncAt: lastSync?.lastSyncedAt?.toISOString() ?? null,
    },
  };
}

async function proceduresSection(userId: string, now: Date, timeZone: string) {
  const [mailbox, suggested, active, nextEvent] = await Promise.all([
    prisma.integrationConnection.findFirst({
      where: { userId, provider: { in: [...MAIL_PROVIDERS] }, status: "ACTIVE" },
      select: { lastSyncedAt: true },
    }),
    listProcedures(userId, "suggested", 20),
    listProcedures(userId, "active", 20),
    prisma.calendarEvent.findFirst({
      where: { userId, status: "confirmed", kind: { in: ["EVENT", "FOCUS"] }, startsAt: { gte: now } },
      orderBy: { startsAt: "asc" },
      select: { title: true, startsAt: true, allDay: true },
    }),
  ]);
  const state: SectionState<ProceduresGlance> =
    !mailbox && suggested.length === 0 && active.length === 0
      ? { status: "empty" }
      : {
          status: "ok",
          data: {
            toConfirm: suggested.length,
            due: active.slice(0, 3).map((view) => ({
              id: view.taskId,
              title: view.title,
              when: dueText(view, now, timeZone),
              urgent: view.urgent || view.overdue,
              href: `/tramites?t=${view.taskId}`,
            })),
            nextEvent: nextEvent
              ? {
                  title: nextEvent.title,
                  when: `${relativeDay(nextEvent.startsAt, now, timeZone)}${nextEvent.allDay ? "" : ` a las ${clockTime(nextEvent.startsAt, timeZone)}`}`,
                }
              : null,
            mailboxConnected: Boolean(mailbox),
            lastSyncAt: mailbox?.lastSyncedAt?.toISOString() ?? null,
          },
        };
  return { state, suggested, active, mailbox };
}

async function shoppingSection(userId: string, now: Date, currency: string, limit: number) {
  const [watching, paused, alerts, pendingPurchases, lastCheck, nextCheck, orders] = await Promise.all([
    prisma.watchlistItem.count({ where: { userId, status: "ACTIVE" } }),
    prisma.watchlistItem.count({ where: { userId, status: "PAUSED" } }),
    listAlertViews(userId, now, 6),
    prisma.agentAction.count({
      where: { userId, type: "PURCHASE", status: "PENDING", OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
    }),
    prisma.watchlistItem.findFirst({ where: { userId, lastCheckedAt: { not: null } }, orderBy: { lastCheckedAt: "desc" }, select: { lastCheckedAt: true } }),
    prisma.watchlistItem.findFirst({ where: { userId, status: "ACTIVE", nextCheckAt: { not: null } }, orderBy: { nextCheckAt: "asc" }, select: { nextCheckAt: true } }),
    prisma.purchaseOrder.count({ where: { userId } }),
  ]);
  const open = alerts.filter((a) => a.status === "NEW" || a.status === "SEEN");
  const top = open[0] ?? null;
  const state: SectionState<ShoppingGlance> =
    watching === 0 && paused === 0 && alerts.length === 0 && orders === 0
      ? { status: "empty" }
      : {
          status: "ok",
          data: {
            currency: top?.currency ?? currency,
            watching,
            limit,
            newAlerts: alerts.filter((a) => a.status === "NEW").length,
            topAlert: top
              ? { id: top.id, title: top.title, price: top.price, dropPct: top.dropPct, savings: top.savings, href: `/compras?alerta=${top.id}` }
              : null,
            pendingPurchases,
            lastCheckAt: lastCheck?.lastCheckedAt?.toISOString() ?? null,
            nextCheckAt: nextCheck?.nextCheckAt?.toISOString() ?? null,
          },
        };
  return { state, alerts, watching, paused, lastCheckAt: lastCheck?.lastCheckedAt ?? null, nextCheckAt: nextCheck?.nextCheckAt ?? null };
}

/** "Ahorro con Omni" del mes: compras por debajo de lo normal y suscripciones dadas de baja. */
async function savingsOf(userId: string, now: Date, timeZone: string, currency: string): Promise<SavingsGlance | null> {
  const since = monthStart(now, timeZone);
  const [orders, canceled] = await Promise.all([
    prisma.purchaseOrder.findMany({ where: { userId, status: "PLACED", createdAt: { gte: since } }, select: { details: true, currency: true } }),
    prisma.recurringCharge.findMany({
      where: { userId, status: { in: ["CANCELLATION_REQUESTED", "CANCELED"] }, updatedAt: { gte: since } },
      select: { amount: true, cadence: true, currency: true },
    }),
  ]);
  const purchases = orders
    .filter((o) => o.currency === currency)
    .reduce((sum, o) => sum + Number((o.details as { savings?: unknown } | null)?.savings ?? 0), 0);
  const monthly = canceled
    .filter((c) => c.currency === currency)
    .reduce((sum, c) => sum + monthlyEquivalent(Number(c.amount), c.cadence as Cadence), 0);
  if (purchases <= 0 && monthly <= 0) return null;
  return { currency, purchases: Math.round(purchases * 100) / 100, monthly: Math.round(monthly * 100) / 100, refunds: 0 };
}

async function activityOf(userId: string): Promise<{ items: ActivityItem[]; unread: number }> {
  const [rows, unread] = await Promise.all([
    prisma.appNotification.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 6 }),
    prisma.appNotification.count({ where: { userId, readAt: null } }),
  ]);
  return {
    unread,
    items: rows.map((n) => ({
      id: n.id,
      type: n.type,
      title: n.title,
      body: n.body,
      href: n.href,
      createdAt: n.createdAt.toISOString(),
      read: n.readAt !== null,
    })),
  };
}

/**
 * Todo el panel en una llamada. Las secciones se cargan en paralelo y cada una por separado:
 * si Finanzas falla, Trámites y Compras siguen apareciendo (y Finanzas ofrece reintentar).
 */
export async function getDashboard(userId: string, now = new Date()): Promise<DashboardData> {
  const profile = await prisma.profile.findUnique({ where: { id: userId }, select: { fullName: true, timezone: true, currency: true } });
  const timeZone = safeTimeZone(profile?.timezone);
  const currency = profile?.currency ?? "USD";
  const billing = await billingOverview(userId, now);

  const [finance, procedures, shopping, approvals, activity, baseSavings, returns] = await Promise.all([
    section("finance", userId, () => financeSection(userId, now, timeZone, currency), "No pude cargar tus finanzas."),
    proceduresSection(userId, now, timeZone).catch((error) => {
      log.error("dashboard.section_failed", { section: "procedures", userId, error });
      return null;
    }),
    shoppingSection(userId, now, currency, billing.usage.watching.limit).catch((error) => {
      log.error("dashboard.section_failed", { section: "shopping", userId, error });
      return null;
    }),
    listActions(userId, "pending", 12).catch(() => []),
    activityOf(userId).catch(() => ({ items: [], unread: 0 })),
    savingsOf(userId, now, timeZone, currency).catch(() => null),
    returnsGlance(userId, now).catch((error) => {
      log.error("dashboard.section_failed", { section: "returns", userId, error });
      return null;
    }),
  ]);
  // Lo recuperado con Devoluciones cuenta en el ahorro del mes.
  const refunds = returns?.recoveredThisMonth ?? 0;
  const savings: SavingsGlance | null = baseSavings
    ? { ...baseSavings, refunds }
    : refunds > 0
      ? { currency, purchases: 0, monthly: 0, refunds }
      : null;

  const attention = buildAttention({
    approvals,
    suggested: procedures?.suggested ?? [],
    dueSoon: procedures?.active ?? [],
    alerts: shopping?.alerts ?? [],
    returns: returns?.attention ?? [],
    billingNotice: billing.notice,
    now,
    timeZone,
  });

  const lastBankSync = finance.status === "ok" && finance.data.lastSyncAt ? new Date(finance.data.lastSyncAt) : null;
  const agents = buildAgents({
    plan: billing.plan,
    finance: { accounts: finance.status === "ok" ? finance.data.accounts : 0, lastSyncAt: lastBankSync },
    mail: { connected: Boolean(procedures?.mailbox), lastSyncAt: procedures?.mailbox?.lastSyncedAt ?? null },
    prices: {
      watching: shopping?.watching ?? 0,
      paused: shopping?.paused ?? 0,
      lastCheckAt: shopping?.lastCheckAt ?? null,
      nextCheckAt: shopping?.nextCheckAt ?? null,
    },
  });

  const openTasks = procedures ? procedures.active.length : 0;
  return {
    now: now.toISOString(),
    timeZone,
    greeting: greetingFor(now, timeZone, profile?.fullName ?? null),
    dateLabel: dateLabelFor(now, timeZone),
    status: agentStatusLine(shopping?.watching ?? 0, openTasks),
    attention: attention.slice(0, ATTENTION_VISIBLE),
    attentionTotal: attention.length,
    attentionCounts: countAttention(attention),
    finance,
    procedures: procedures?.state ?? { status: "error", message: "No pude cargar tus trámites." },
    shopping: shopping?.state ?? { status: "error", message: "No pude cargar tus compras." },
    agents,
    savings,
    activity: activity.items,
    unreadActivity: activity.unread,
    billing,
  };
}
