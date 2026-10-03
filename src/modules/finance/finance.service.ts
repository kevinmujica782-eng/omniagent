import "server-only";
import type { FinancialAccount, Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { Errors } from "@/lib/errors";
import { shortDate } from "@/lib/format";
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
  detectAntExpenses,
  detectRecurring,
  monthlyEquivalent,
  monthlyWindows,
  summarize,
  type TxLike,
} from "./analyzers";
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
  }

  // Cargos que ya no tienen movimientos (por ejemplo, tras desconectar una cuenta).
  await prisma.recurringCharge.deleteMany({ where: { userId, transactions: { none: {} } } });
  return candidates.length;
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
  });
  if (accounts.length === 0) return null;

  const now = new Date();
  const txs = await loadTransactions(userId, new Date(now.getTime() - periodDays * DAY_MS));
  const summary = summarize(txs, periodDays, now);

  return {
    kind: "finance_summary",
    sources: accounts.map((account) => (account.mask ? `${account.name} ••${account.mask}` : account.name)),
    periodDays,
    transactionCount: txs.length,
    currency: accounts[0].currency,
    monthlyIncome: summary.monthlyIncome,
    monthlySpending: summary.monthlySpending,
    monthlySaved: summary.monthlySaved,
    savingsRate: summary.savingsRate,
    topCategories: summary.topCategories.slice(0, 6).map(({ name, monthly, changePct }) => ({ name, monthly, changePct })),
  };
}

/** Ingresos y gastos de los últimos 3 periodos de 30 días. */
export async function getMonthlyTrend(userId: string, timeZone?: string): Promise<MonthlyTrendCard | null> {
  const account = await prisma.financialAccount.findFirst({ where: { userId }, select: { currency: true } });
  if (!account) return null;
  const now = new Date();
  const txs = await loadTransactions(userId, new Date(now.getTime() - 91 * DAY_MS));
  const windows = monthlyWindows(txs, now, 3);
  return {
    kind: "monthly_trend",
    currency: account.currency,
    months: windows.map((w) => ({
      label: `${shortDate(new Date(w.from.getTime() + DAY_MS), timeZone)} al ${shortDate(w.to, timeZone)}`,
      income: w.income,
      spending: w.spending,
      net: w.net,
    })),
  };
}

export async function getAntExpenses(userId: string, periodDays = 30, maxAmount = 15): Promise<AntExpensesCard | null> {
  const account = await prisma.financialAccount.findFirst({ where: { userId }, select: { currency: true } });
  if (!account) return null;
  const txs = await loadTransactions(userId, new Date(Date.now() - periodDays * DAY_MS));
  const result = detectAntExpenses(txs, { periodDays, maxAmount });
  return {
    kind: "ant_expenses",
    currency: account.currency,
    periodDays,
    maxAmount,
    monthlyProjection: result.monthlyProjection,
    items: result.items.slice(0, 6),
  };
}

export async function getSubscriptions(userId: string, onlySubscriptions = true): Promise<SubscriptionsCard | null> {
  const rows = await prisma.recurringCharge.findMany({
    where: {
      userId,
      status: { not: "CANCELED" },
      ...(onlySubscriptions ? { category: SUBSCRIPTIONS_CATEGORY } : {}),
    },
    orderBy: { amount: "desc" },
  });
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
