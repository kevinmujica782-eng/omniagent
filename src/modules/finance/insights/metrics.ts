// Snapshot financiero de los últimos 3 meses: lo que se envía a Claude. Puro y serializable (sin fechas Date).
import { shortDate } from "@/lib/format";
import {
  DAY_MS,
  detectAntExpenses,
  detectAvoidableFees,
  monthlyEquivalent,
  monthlyWindows,
  summarize,
  topMerchants,
  type Cadence,
  type TxLike,
} from "../analyzers";
import { SUBSCRIPTIONS_CATEGORY, SUBSCRIPTION_KIND_LABEL } from "../categories";

export const ANALYSIS_DAYS = 90;
export const ANT_MAX_TICKET = 15;

export type SubscriptionUsage = "en_uso" | "sin_uso" | "sin_datos" | "baja_solicitada";

export interface SnapshotAccountInput {
  name: string;
  institution: string;
  type: string;
  balance: number | null;
  creditLimit: number | null;
  simulated: boolean;
}

export interface SnapshotRecurringInput {
  id: string;
  merchant: string;
  amount: number;
  cadence: Cadence;
  category: string | null;
  subcategory: string | null;
  status: string;
  lastUsedAt: Date | null;
  usageSource: string | null;
}

export interface FinancialSnapshot {
  currency: string;
  period: { from: string; to: string; days: number };
  accounts: {
    name: string;
    institution: string;
    type: string;
    balance: number | null;
    creditLimit: number | null;
    creditUsePct: number | null;
    simulated: boolean;
  }[];
  months: { label: string; income: number; spending: number; net: number }[];
  averages: { income: number; spending: number; net: number; savingsRatePct: number };
  categories: { name: string; monthlyAverage: number; lastMonth: number; changePct: number | null }[];
  antExpenses: {
    maxTicket: number;
    monthlyTotal: number;
    merchants: { merchant: string; purchasesPerMonth: number; averageTicket: number; monthly: number }[];
  };
  subscriptions: {
    id: string;
    merchant: string;
    amount: number;
    cadence: Cadence;
    monthly: number;
    kind: string | null;
    usage: SubscriptionUsage;
    lastUsedDaysAgo: number | null;
    usageConfirmedByUser: boolean;
  }[];
  fixedCharges: { merchant: string; category: string | null; monthly: number }[];
  overlaps: { kind: string; label: string; merchants: string[]; monthly: number }[];
  avoidableFees: { concept: string; count: number; totalPeriod: number; monthly: number }[];
  topMerchants: { merchant: string; purchases: number; monthly: number }[];
  budgets: { category: string; limit: number; spentThisMonth: number }[];
  dataQuality: { transactions: number; daysCovered: number; hasCreditCard: boolean };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function usageOf(charge: SnapshotRecurringInput, now: Date): { usage: SubscriptionUsage; daysAgo: number | null } {
  const daysAgo = charge.lastUsedAt ? Math.max(0, Math.floor((now.getTime() - charge.lastUsedAt.getTime()) / DAY_MS)) : null;
  if (charge.status === "CANCELLATION_REQUESTED") return { usage: "baja_solicitada", daysAgo };
  if (charge.status === "UNUSED_SUSPECTED") return { usage: "sin_uso", daysAgo };
  if (daysAgo !== null) return { usage: daysAgo >= 60 ? "sin_uso" : "en_uso", daysAgo };
  return { usage: "sin_datos", daysAgo };
}

export function buildSnapshot(input: {
  txs: TxLike[];
  accounts: SnapshotAccountInput[];
  recurring: SnapshotRecurringInput[];
  budgets: { category: string; limit: number; spentThisMonth: number }[];
  currency: string;
  now: Date;
  timeZone?: string;
}): FinancialSnapshot {
  const { now, txs } = input;
  const from = new Date(now.getTime() - ANALYSIS_DAYS * DAY_MS);
  const inPeriod = txs.filter((tx) => tx.postedAt.getTime() > from.getTime() && tx.postedAt.getTime() <= now.getTime());
  const summary = summarize(inPeriod, ANALYSIS_DAYS, now);
  const windows = monthlyWindows(inPeriod, now, 3);
  const recent = inPeriod.filter((tx) => tx.postedAt.getTime() >= now.getTime() - 30 * DAY_MS);
  const ant = detectAntExpenses(recent, { periodDays: 30, maxAmount: ANT_MAX_TICKET });

  const subscriptions = input.recurring
    .filter((charge) => charge.category === SUBSCRIPTIONS_CATEGORY && charge.status !== "CANCELED")
    .map((charge) => {
      const { usage, daysAgo } = usageOf(charge, now);
      return {
        id: charge.id,
        merchant: charge.merchant,
        amount: charge.amount,
        cadence: charge.cadence,
        monthly: monthlyEquivalent(charge.amount, charge.cadence),
        kind: charge.subcategory,
        usage,
        lastUsedDaysAgo: daysAgo,
        usageConfirmedByUser: charge.usageSource === "user",
      };
    })
    .sort((a, b) => b.monthly - a.monthly);

  const byKind = new Map<string, typeof subscriptions>();
  for (const sub of subscriptions) {
    if (!sub.kind || sub.usage === "baja_solicitada") continue;
    byKind.set(sub.kind, [...(byKind.get(sub.kind) ?? []), sub]);
  }
  const overlaps = [...byKind.entries()]
    .filter(([, list]) => list.length >= 2)
    .map(([kind, list]) => ({
      kind,
      label: SUBSCRIPTION_KIND_LABEL[kind] ?? kind,
      merchants: list.map((s) => s.merchant),
      monthly: round2(list.reduce((sum, s) => sum + s.monthly, 0)),
    }));

  const earliest = txs.reduce((min, tx) => Math.min(min, tx.postedAt.getTime()), now.getTime());

  return {
    currency: input.currency,
    period: { from: from.toISOString().slice(0, 10), to: now.toISOString().slice(0, 10), days: ANALYSIS_DAYS },
    accounts: input.accounts.map((account) => ({
      ...account,
      creditUsePct:
        account.type === "CREDIT_CARD" && account.creditLimit && account.balance !== null
          ? Math.round((account.balance / account.creditLimit) * 100)
          : null,
    })),
    months: windows.map((w) => ({
      label: `${shortDate(new Date(w.from.getTime() + DAY_MS), input.timeZone)} al ${shortDate(w.to, input.timeZone)}`,
      income: w.income,
      spending: w.spending,
      net: w.net,
    })),
    averages: {
      income: summary.monthlyIncome,
      spending: summary.monthlySpending,
      net: summary.monthlySaved,
      savingsRatePct: summary.monthlyIncome > 0 ? Math.round((summary.monthlySaved / summary.monthlyIncome) * 100) : 0,
    },
    categories: summary.topCategories.slice(0, 10).map((c) => ({
      name: c.name,
      monthlyAverage: c.monthly,
      lastMonth: c.lastMonth,
      changePct: c.changePct,
    })),
    antExpenses: {
      maxTicket: ANT_MAX_TICKET,
      monthlyTotal: ant.monthlyProjection,
      merchants: ant.items.slice(0, 5).map((item) => ({
        merchant: item.merchant,
        purchasesPerMonth: item.count,
        averageTicket: item.averageTicket,
        monthly: item.monthlyProjection,
      })),
    },
    subscriptions,
    fixedCharges: input.recurring
      .filter((charge) => charge.category !== SUBSCRIPTIONS_CATEGORY && charge.status !== "CANCELED")
      .map((charge) => ({
        merchant: charge.merchant,
        category: charge.category,
        monthly: monthlyEquivalent(charge.amount, charge.cadence),
      }))
      .sort((a, b) => b.monthly - a.monthly),
    overlaps,
    avoidableFees: detectAvoidableFees(inPeriod, ANALYSIS_DAYS),
    topMerchants: topMerchants(inPeriod, ANALYSIS_DAYS, 5),
    budgets: input.budgets,
    dataQuality: {
      transactions: inPeriod.length,
      daysCovered: Math.min(ANALYSIS_DAYS, Math.round((now.getTime() - earliest) / DAY_MS)),
      hasCreditCard: input.accounts.some((account) => account.type === "CREDIT_CARD"),
    },
  };
}
