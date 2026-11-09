import "server-only";
import type { FinancialAccount, Prisma, RecurringCharge } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { Errors } from "@/lib/errors";
import { money, shortDate } from "@/lib/format";
import { log } from "@/lib/log";
import { isUuid } from "@/lib/validation";
import type {
  AccountView,
  AntExpensesCard,
  FinanceSummaryCard,
  MonthlyTrendCard,
  SubscriptionItem,
  SubscriptionsCard,
  TransactionView,
} from "@/types/cards";
import {
  DAY_MS,
  antMaxTicketFor,
  detectAntExpenses,
  detectRecurring,
  inCurrency,
  monthlyEquivalent,
  monthlyWindows,
  primaryCurrency,
  summarize,
  type TxLike,
} from "./analyzers";
import { checkCancellation } from "./cancellation-rules";
import { SUBSCRIPTIONS_CATEGORY, isSubscriptionLike } from "./categories";

const UNUSED_AFTER_DAYS = 60;

export async function loadTransactions(userId: string, since: Date): Promise<TxLike[]> {
  const rows = await prisma.transaction.findMany({
    where: { userId, postedAt: { gte: since } },
    orderBy: { postedAt: "asc" },
    select: {
      postedAt: true,
      amount: true,
      direction: true,
      currency: true,
      merchantName: true,
      description: true,
      category: true,
      subcategory: true,
    },
  });
  return rows.map((row) => ({ ...row, amount: Number(row.amount) }));
}

/**
 * Detecta cargos recurrentes y los guarda. `signals` = días desde el último uso por comercio
 * (del conector, si lo ofrece). Lo que decide el usuario ("la uso" / "no la uso", cancelar) no se pisa.
 */
export async function refreshRecurringCharges(userId: string, signals: Record<string, number> = {}) {
  const txs = await loadTransactions(userId, new Date(Date.now() - 400 * DAY_MS));
  const candidates = detectRecurring(txs);
  const now = Date.now();

  for (const candidate of candidates) {
    const category =
      isSubscriptionLike(candidate.category) && candidate.cadence !== "WEEKLY" ? SUBSCRIPTIONS_CATEGORY : candidate.category;
    const daysSinceUse = signals[candidate.merchant];
    const lastUsedAt = daysSinceUse === undefined ? undefined : new Date(now - daysSinceUse * DAY_MS);
    const looksUnused = daysSinceUse !== undefined && daysSinceUse >= UNUSED_AFTER_DAYS;
    const key = { userId, merchantName: candidate.merchant, cadence: candidate.cadence };

    const existing = await prisma.recurringCharge.findUnique({ where: { userId_merchantName_cadence: key } });
    const userDecided =
      existing !== null &&
      (existing.usageSource === "user" || existing.status === "CANCELLATION_REQUESTED" || existing.status === "CANCELED");

    const charge = await prisma.recurringCharge.upsert({
      where: { userId_merchantName_cadence: key },
      create: {
        userId,
        merchantName: candidate.merchant,
        category,
        subcategory: candidate.subcategory,
        amount: candidate.amount,
        currency: candidate.currency,
        cadence: candidate.cadence,
        status: looksUnused ? "UNUSED_SUSPECTED" : "ACTIVE",
        firstSeenAt: candidate.firstSeenAt,
        lastChargedAt: candidate.lastChargedAt,
        nextExpectedAt: candidate.nextExpectedAt,
        lastUsedAt: lastUsedAt ?? null,
        usageSource: lastUsedAt ? "signal" : null,
      },
      update: {
        category,
        subcategory: candidate.subcategory,
        amount: candidate.amount,
        lastChargedAt: candidate.lastChargedAt,
        nextExpectedAt: candidate.nextExpectedAt,
        ...(!userDecided && lastUsedAt
          ? { lastUsedAt, usageSource: "signal", status: looksUnused ? "UNUSED_SUSPECTED" : "ACTIVE" }
          : {}),
      },
    });

    await prisma.transaction.updateMany({
      where: { userId, merchantName: candidate.merchant, direction: "DEBIT", recurringChargeId: null },
      data: { recurringChargeId: charge.id },
    });

    // Bajas pedidas con Omni: con los movimientos nuevos se ve si se volvió a cobrar o si ya quedó hecha.
    if (charge.status === "CANCELLATION_REQUESTED") {
      await followUpCancellation(userId, charge).catch((error: unknown) =>
        log.warn("finance.cancellation_followup_failed", { userId, error }),
      );
    }
  }

  // Cargos que ya no tienen movimientos (por ejemplo, tras desconectar una cuenta).
  await prisma.recurringCharge.deleteMany({ where: { userId, transactions: { none: {} } } });
  return candidates.length;
}

/** Hasta qué día llegan los movimientos de las cuentas donde se cobra ese cargo. */
async function dataThroughFor(userId: string, recurringChargeId: string): Promise<Date | null> {
  const accounts = await prisma.transaction.findMany({
    where: { userId, recurringChargeId },
    select: { accountId: true },
    distinct: ["accountId"],
  });
  if (accounts.length === 0) return null;
  const latest = await prisma.transaction.aggregate({
    where: { userId, accountId: { in: accounts.map((a) => a.accountId) } },
    _max: { postedAt: true },
  });
  return latest._max.postedAt ?? null;
}

/**
 * Cumple lo que promete la baja asistida («si vuelve a cobrarse, te aviso»): si el comercio cobró después de pedir la
 * baja, avisa y la deja otra vez para cancelar; si ya pasó la fecha del siguiente cobro y no apareció, la da por
 * hecha, cierra la tarea de confirmar y avisa cuánto se ahorra. Si faltan movimientos, espera.
 */
async function followUpCancellation(userId: string, charge: RecurringCharge, now = new Date()) {
  const action = await prisma.agentAction.findFirst({
    where: { userId, type: "CANCEL_SUBSCRIPTION", status: "EXECUTED", payload: { path: ["recurringChargeId"], equals: charge.id } },
    orderBy: { executedAt: "desc" },
    select: { executedAt: true, result: true },
  });
  if (!action?.executedAt) return;

  const outcome = checkCancellation({
    requestedAt: action.executedAt,
    cadence: charge.cadence,
    lastChargedAt: charge.lastChargedAt,
    dataThrough: await dataThroughFor(userId, charge.id),
  });
  if (outcome.status === "waiting") return;

  const amount = Number(charge.amount);
  if (outcome.status === "charged_again") {
    // La baja no se completó en el comercio: vuelve a la lista para cancelarla otra vez.
    const reopened = await prisma.recurringCharge.updateMany({
      where: { id: charge.id, status: "CANCELLATION_REQUESTED" },
      data: { status: "UNUSED_SUSPECTED" },
    });
    if (reopened.count === 0) return;
    await prisma.appNotification.create({
      data: {
        userId,
        type: "ACTION_REQUIRED",
        title: `${charge.merchantName} se volvió a cobrar`,
        body: `Te cobró ${money(amount, charge.currency, { cents: true })} el ${shortDate(outcome.chargedAt)}, después de que pediste la baja. Revisa que esté cancelada en ${charge.merchantName}; si quieres, Omni te prepara la baja otra vez.`,
        href: "/finanzas",
        data: { recurringChargeId: charge.id },
      },
    });
    return;
  }

  const confirmed = await prisma.recurringCharge.updateMany({
    where: { id: charge.id, status: "CANCELLATION_REQUESTED" },
    data: { status: "CANCELED" },
  });
  if (confirmed.count === 0) return;
  const taskId = (action.result as { taskId?: unknown } | null)?.taskId;
  if (typeof taskId === "string" && isUuid(taskId)) {
    await prisma.task.updateMany({
      where: { id: taskId, userId, status: { notIn: ["DONE", "CANCELED"] } },
      data: { status: "DONE", completedAt: now },
    });
  }
  await prisma.appNotification.create({
    data: {
      userId,
      type: "INSIGHT",
      title: `Confirmado: ${charge.merchantName} ya no te cobra`,
      body: `Pasó la fecha del siguiente cobro y no apareció en tus movimientos. Ahorras ${money(monthlyEquivalent(amount, charge.cadence), charge.currency, { cents: true })} al mes.`,
      href: "/finanzas",
      data: { recurringChargeId: charge.id },
    },
  });
}

export function accountView(row: FinancialAccount): AccountView {
  return {
    id: row.id,
    connectionId: row.connectionId,
    institutionName: row.institutionName,
    name: row.name,
    type: row.type,
    subtype: row.subtype,
    mask: row.mask,
    currency: row.currency,
    currentBalance: row.currentBalance === null ? null : Number(row.currentBalance),
    creditLimit: row.creditLimit === null ? null : Number(row.creditLimit),
    isSimulated: row.isSimulated,
  };
}

export async function listAccounts(userId: string): Promise<AccountView[]> {
  const rows = await prisma.financialAccount.findMany({ where: { userId }, orderBy: { createdAt: "asc" } });
  return rows.map(accountView);
}

export async function getFinanceOverview(userId: string, periodDays = 90): Promise<FinanceSummaryCard | null> {
  const accounts = await prisma.financialAccount.findMany({
    where: { userId },
    select: { name: true, mask: true, currency: true },
    orderBy: { createdAt: "asc" },
  });
  if (accounts.length === 0) return null;

  const now = new Date();
  const all = await loadTransactions(userId, new Date(now.getTime() - periodDays * DAY_MS));
  // Un solo resumen por moneda: las cuentas en otra moneda no se suman (ver primaryCurrency).
  const currency = primaryCurrency(
    accounts.map((account) => account.currency),
    all,
  );
  const txs = inCurrency(all, currency);
  const included = inCurrency(accounts, currency);
  const summary = summarize(txs, periodDays, now);

  return {
    kind: "finance_summary",
    sources: (included.length > 0 ? included : accounts).map((account) =>
      account.mask ? `${account.name} ••${account.mask}` : account.name,
    ),
    periodDays,
    transactionCount: txs.length,
    currency,
    monthlyIncome: summary.monthlyIncome,
    monthlySpending: summary.monthlySpending,
    monthlySaved: summary.monthlySaved,
    savingsRate: summary.savingsRate,
    topCategories: summary.topCategories.slice(0, 6).map(({ name, monthly, changePct }) => ({ name, monthly, changePct })),
  };
}

/** Ingresos y gastos de los últimos 3 periodos de 30 días. */
export async function getMonthlyTrend(userId: string, timeZone?: string): Promise<MonthlyTrendCard | null> {
  const accounts = await prisma.financialAccount.findMany({
    where: { userId },
    select: { currency: true },
    orderBy: { createdAt: "asc" },
  });
  if (accounts.length === 0) return null;
  const now = new Date();
  const all = await loadTransactions(userId, new Date(now.getTime() - 91 * DAY_MS));
  const currency = primaryCurrency(
    accounts.map((account) => account.currency),
    all,
  );
  const windows = monthlyWindows(inCurrency(all, currency), now, 3);
  return {
    kind: "monthly_trend",
    currency,
    months: windows.map((w) => ({
      label: `${shortDate(new Date(w.from.getTime() + DAY_MS), timeZone)} al ${shortDate(w.to, timeZone)}`,
      income: w.income,
      spending: w.spending,
      net: w.net,
    })),
  };
}

/**
 * Gastos hormiga de la moneda principal. Sin `maxAmount`, el tope de una compra pequeña sale de la moneda
 * (15 dólares o su equivalente; en bolívares, el 2 % del gasto mensual): ver antMaxTicketFor.
 */
export async function getAntExpenses(userId: string, periodDays = 30, maxAmount?: number): Promise<AntExpensesCard | null> {
  const accounts = await prisma.financialAccount.findMany({
    where: { userId },
    select: { currency: true },
    orderBy: { createdAt: "asc" },
  });
  if (accounts.length === 0) return null;
  const now = new Date();
  const all = await loadTransactions(userId, new Date(now.getTime() - periodDays * DAY_MS));
  const currency = primaryCurrency(
    accounts.map((account) => account.currency),
    all,
  );
  const txs = inCurrency(all, currency);
  const limit = maxAmount ?? antMaxTicketFor(currency, summarize(txs, periodDays, now).monthlySpending);
  const result = detectAntExpenses(txs, { periodDays, maxAmount: limit });
  return {
    kind: "ant_expenses",
    currency,
    periodDays,
    maxAmount: limit,
    monthlyProjection: result.monthlyProjection,
    items: result.items.slice(0, 6),
  };
}

/**
 * Suscripciones y cargos recurrentes en una sola moneda: la pedida (`currency`) o, si no, la que más se repite. Los
 * montos de monedas distintas no se suman.
 */
export async function getSubscriptions(
  userId: string,
  onlySubscriptions = true,
  currency?: string,
): Promise<SubscriptionsCard | null> {
  const found = await prisma.recurringCharge.findMany({
    where: {
      userId,
      status: { not: "CANCELED" },
      ...(onlySubscriptions ? { category: SUBSCRIPTIONS_CATEGORY } : {}),
    },
    orderBy: { amount: "desc" },
  });
  if (found.length === 0) return null;
  const rows = inCurrency(found, currency ?? primaryCurrency([found[0].currency], found));
  if (rows.length === 0) return null;

  const now = Date.now();
  const items: SubscriptionItem[] = rows.map((row) => ({
    id: row.id,
    merchant: row.merchantName,
    amount: Number(row.amount),
    cadence: row.cadence,
    status: row.status,
    subcategory: row.subcategory,
    lastUsedDaysAgo: row.lastUsedAt ? Math.max(0, Math.floor((now - row.lastUsedAt.getTime()) / DAY_MS)) : null,
    usageSource: row.usageSource === "user" || row.usageSource === "signal" ? row.usageSource : null,
    nextExpectedAt: row.nextExpectedAt?.toISOString() ?? null,
  }));
  const monthly = (list: SubscriptionItem[]) =>
    Math.round(list.reduce((sum, item) => sum + monthlyEquivalent(item.amount, item.cadence), 0) * 100) / 100;

  return {
    kind: "subscriptions",
    currency: rows[0].currency,
    monthlyTotal: monthly(items),
    unusedMonthlyTotal: monthly(items.filter((item) => item.status === "UNUSED_SUSPECTED")),
    items,
  };
}

/** El usuario confirma si usa o no una suscripción (la señal más confiable de "inactiva"). */
export async function setSubscriptionUsage(userId: string, recurringChargeId: string, inUse: boolean) {
  if (!isUuid(recurringChargeId)) throw Errors.notFound("La suscripción");
  const charge = await prisma.recurringCharge.findFirst({ where: { id: recurringChargeId, userId } });
  if (!charge) throw Errors.notFound("La suscripción");
  const keepStatus = charge.status === "CANCELLATION_REQUESTED" || charge.status === "CANCELED";
  return prisma.recurringCharge.update({
    where: { id: charge.id },
    data: inUse
      ? { usageSource: "user", lastUsedAt: new Date(), ...(keepStatus ? {} : { status: "ACTIVE" }) }
      : { usageSource: "user", ...(keepStatus ? {} : { status: "UNUSED_SUSPECTED" }) },
  });
}

export interface TransactionFilters {
  q?: string;
  category?: string;
  accountId?: string;
  from?: Date;
  to?: Date;
  direction?: "DEBIT" | "CREDIT";
  minAmount?: number;
  maxAmount?: number;
  limit?: number;
  offset?: number;
}

function transactionWhere(userId: string, f: TransactionFilters): Prisma.TransactionWhereInput {
  return {
    userId,
    ...(f.q
      ? {
          OR: [
            { merchantName: { contains: f.q, mode: "insensitive" } },
            { description: { contains: f.q, mode: "insensitive" } },
          ],
        }
      : {}),
    ...(f.category ? { category: f.category } : {}),
    ...(f.accountId && isUuid(f.accountId) ? { accountId: f.accountId } : {}),
    ...(f.from || f.to ? { postedAt: { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lte: f.to } : {}) } } : {}),
    ...(f.direction ? { direction: f.direction } : {}),
    ...(f.minAmount !== undefined || f.maxAmount !== undefined
      ? {
          amount: {
            ...(f.minAmount !== undefined ? { gte: f.minAmount } : {}),
            ...(f.maxAmount !== undefined ? { lte: f.maxAmount } : {}),
          },
        }
      : {}),
  };
}

type TxRow = {
  id: string;
  postedAt: Date;
  amount: { toString(): string };
  direction: "DEBIT" | "CREDIT";
  currency: string;
  merchantName: string | null;
  description: string;
  category: string | null;
  pending: boolean;
  account: { name: string; mask: string | null } | null;
};

function toTransactionView(row: TxRow): TransactionView {
  return {
    id: row.id,
    postedAt: row.postedAt.toISOString(),
    amount: Number(row.amount),
    direction: row.direction,
    currency: row.currency,
    merchantName: row.merchantName,
    description: row.description,
    category: row.category,
    pending: row.pending,
    accountLabel: row.account ? `${row.account.name}${row.account.mask ? ` ••${row.account.mask}` : ""}` : null,
  };
}

const TX_SELECT = {
  id: true,
  postedAt: true,
  amount: true,
  direction: true,
  currency: true,
  merchantName: true,
  description: true,
  category: true,
  pending: true,
  account: { select: { name: true, mask: true } },
} as const;

/** Búsqueda paginada de movimientos con totales (para la UI y para el chat). */
export async function searchTransactions(userId: string, filters: TransactionFilters) {
  const limit = Math.min(Math.max(filters.limit ?? 30, 1), 100);
  const offset = Math.max(filters.offset ?? 0, 0);
  const where = transactionWhere(userId, filters);

  const [rows, sums] = await Promise.all([
    prisma.transaction.findMany({
      where,
      orderBy: [{ postedAt: "desc" }, { id: "desc" }],
      skip: offset,
      take: limit + 1,
      select: TX_SELECT,
    }),
    prisma.transaction.groupBy({ by: ["direction"], where, _sum: { amount: true }, _count: { _all: true } }),
  ]);

  const totals = { spent: 0, income: 0, count: 0 };
  for (const group of sums as { direction: string; _sum: { amount: unknown }; _count: { _all: number } }[]) {
    const value = Number(group._sum.amount ?? 0);
    if (group.direction === "DEBIT") totals.spent = value;
    else totals.income = value;
    totals.count += group._count._all;
  }

  return {
    items: (rows as unknown as TxRow[]).slice(0, limit).map(toTransactionView),
    nextOffset: rows.length > limit ? offset + limit : null,
    totalSpent: Math.round(totals.spent * 100) / 100,
    totalIncome: Math.round(totals.income * 100) / 100,
    count: totals.count,
  };
}

export async function recentTransactions(userId: string, take = 8): Promise<TransactionView[]> {
  const rows = await prisma.transaction.findMany({
    where: { userId },
    orderBy: [{ postedAt: "desc" }, { id: "desc" }],
    take,
    select: TX_SELECT,
  });
  return (rows as unknown as TxRow[]).map(toTransactionView);
}

export async function listCategories(userId: string): Promise<string[]> {
  const rows = await prisma.transaction.findMany({
    where: { userId, category: { not: null } },
    distinct: ["category"],
    select: { category: true },
    orderBy: { category: "asc" },
  });
  return rows.map((row) => row.category).filter((c): c is string => Boolean(c));
}
