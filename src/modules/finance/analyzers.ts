// Análisis financiero puro (sin base de datos): fácil de probar con datos de ejemplo.
import { FEES_CATEGORY, excludedFromAntExpenses, isNeutralCategory } from "./categories";

export type Direction = "DEBIT" | "CREDIT";
export type Cadence = "WEEKLY" | "MONTHLY" | "QUARTERLY" | "YEARLY";

export interface TxLike {
  postedAt: Date;
  amount: number;
  direction: Direction;
  currency: string;
  merchantName: string | null;
  description: string;
  category: string | null;
  subcategory?: string | null;
}

export const DAY_MS = 86_400_000;

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Normaliza el comercio para agrupar variantes ("CAFE GRANO*1234" ≈ "Café Grano"). */
export function merchantKey(tx: Pick<TxLike, "merchantName" | "description">): string {
  return (tx.merchantName ?? tx.description)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9+ ]/g, " ")
    .replace(/\b\d{3,}\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Promedios mensuales del periodo y tendencia por categoría (últimos 30 días vs. el resto). */
export function summarize(txs: TxLike[], periodDays: number, now = new Date()) {
  const factor = 30 / Math.max(periodDays, 1);
  const recentFrom = now.getTime() - 30 * DAY_MS;
  const previousMonths = Math.max((periodDays - 30) / 30, 0);

  let income = 0;
  let spending = 0;
  const byCategory = new Map<string, { total: number; recent: number; previous: number }>();

  for (const tx of txs) {
    if (isNeutralCategory(tx.category)) continue;
    if (tx.direction === "CREDIT") {
      income += tx.amount;
      continue;
    }
    spending += tx.amount;
    const name = tx.category ?? "Otros";
    const entry = byCategory.get(name) ?? { total: 0, recent: 0, previous: 0 };
    entry.total += tx.amount;
    if (tx.postedAt.getTime() >= recentFrom) entry.recent += tx.amount;
    else entry.previous += tx.amount;
    byCategory.set(name, entry);
  }

  const monthlyIncome = round2(income * factor);
  const monthlySpending = round2(spending * factor);
  const monthlySaved = round2(monthlyIncome - monthlySpending);

  const topCategories = [...byCategory.entries()]
    .map(([name, entry]) => {
      const previousMonthly = previousMonths > 0 ? entry.previous / previousMonths : 0;
      const changePct =
        previousMonthly > 0 ? Math.round(((entry.recent - previousMonthly) / previousMonthly) * 100) : null;
      return { name, monthly: round2(entry.total * factor), lastMonth: round2(entry.recent), changePct };
    })
    .sort((a, b) => b.monthly - a.monthly);

  return {
    monthlyIncome,
    monthlySpending,
    monthlySaved,
    savingsRate: monthlyIncome > 0 ? Math.max(0, round2(monthlySaved / monthlyIncome)) : 0,
    topCategories,
  };
}

/** Tres (o n) ventanas de 30 días hacia atrás: la base del análisis "mes a mes". */
export function monthlyWindows(txs: TxLike[], now = new Date(), count = 3) {
  const end = now.getTime();
  const windows = Array.from({ length: count }, (_, i) => {
    const to = end - (count - 1 - i) * 30 * DAY_MS;
    return { from: new Date(to - 30 * DAY_MS), to: new Date(to), income: 0, spending: 0 };
  });
  for (const tx of txs) {
    if (isNeutralCategory(tx.category)) continue;
    const t = tx.postedAt.getTime();
    const window = windows.find((w) => t > w.from.getTime() && t <= w.to.getTime());
    if (!window) continue;
    if (tx.direction === "CREDIT") window.income += tx.amount;
    else window.spending += tx.amount;
  }
  return windows.map((w) => ({
    from: w.from,
    to: w.to,
    income: round2(w.income),
    spending: round2(w.spending),
    net: round2(w.income - w.spending),
  }));
}

/** Gastos hormiga: compras pequeñas y repetidas en el mismo comercio. */
export function detectAntExpenses(txs: TxLike[], opts: { periodDays: number; maxAmount: number; minCount?: number }) {
  const minCount = opts.minCount ?? 4;
  const groups = new Map<string, { merchant: string; count: number; total: number }>();

  for (const tx of txs) {
    if (tx.direction !== "DEBIT" || tx.amount > opts.maxAmount || excludedFromAntExpenses(tx.category)) continue;
    const key = merchantKey(tx);
    const group = groups.get(key) ?? { merchant: tx.merchantName ?? tx.description, count: 0, total: 0 };
    group.count += 1;
    group.total += tx.amount;
    groups.set(key, group);
  }

  const factor = 30 / Math.max(opts.periodDays, 1);
  const items = [...groups.values()]
    .filter((group) => group.count >= minCount)
    .map((group) => ({
      merchant: group.merchant,
      count: group.count,
      total: round2(group.total),
      averageTicket: round2(group.total / group.count),
      monthlyProjection: round2(group.total * factor),
    }))
    .sort((a, b) => b.monthlyProjection - a.monthlyProjection);

  return { items, monthlyProjection: round2(items.reduce((sum, item) => sum + item.monthlyProjection, 0)) };
}

/** Comisiones e intereses: dinero que se puede dejar de pagar sin cambiar hábitos. */
export function detectAvoidableFees(txs: TxLike[], periodDays: number) {
  const groups = new Map<string, { concept: string; count: number; total: number }>();
  for (const tx of txs) {
    if (tx.direction !== "DEBIT" || tx.category !== FEES_CATEGORY) continue;
    const key = merchantKey(tx);
    const group = groups.get(key) ?? { concept: tx.merchantName ?? tx.description, count: 0, total: 0 };
    group.count += 1;
    group.total += tx.amount;
    groups.set(key, group);
  }
  const factor = 30 / Math.max(periodDays, 1);
  return [...groups.values()]
    .map((g) => ({ concept: g.concept, count: g.count, totalPeriod: round2(g.total), monthly: round2(g.total * factor) }))
    .sort((a, b) => b.totalPeriod - a.totalPeriod);
}

/** Comercios donde más se gasta (sin transferencias). */
export function topMerchants(txs: TxLike[], periodDays: number, limit = 5) {
  const groups = new Map<string, { merchant: string; count: number; total: number }>();
  for (const tx of txs) {
    if (tx.direction !== "DEBIT" || isNeutralCategory(tx.category)) continue;
    const key = merchantKey(tx);
    const group = groups.get(key) ?? { merchant: tx.merchantName ?? tx.description, count: 0, total: 0 };
    group.count += 1;
    group.total += tx.amount;
    groups.set(key, group);
  }
  const factor = 30 / Math.max(periodDays, 1);
  return [...groups.values()]
    .map((g) => ({ merchant: g.merchant, purchases: g.count, monthly: round2(g.total * factor) }))
    .sort((a, b) => b.monthly - a.monthly)
    .slice(0, limit);
}

export function monthlyEquivalent(amount: number, cadence: Cadence): number {
  switch (cadence) {
    case "WEEKLY":
      return round2((amount * 52) / 12);
    case "MONTHLY":
      return amount;
    case "QUARTERLY":
      return round2(amount / 3);
    case "YEARLY":
      return round2(amount / 12);
  }
}

export interface RecurringCandidate {
  merchant: string;
  category: string | null;
  subcategory: string | null;
  currency: string;
  amount: number;
  cadence: Cadence;
  count: number;
  firstSeenAt: Date;
  lastChargedAt: Date;
  nextExpectedAt: Date;
}

const CADENCES: { cadence: Cadence; days: number; tolerance: number }[] = [
  { cadence: "WEEKLY", days: 7, tolerance: 2 },
  { cadence: "MONTHLY", days: 30.4, tolerance: 4 },
  { cadence: "QUARTERLY", days: 91, tolerance: 8 },
  { cadence: "YEARLY", days: 365, tolerance: 20 },
];

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Cargos recurrentes: mismo comercio, monto estable (±10 %) e intervalos regulares.
 * Detecta suscripciones, renta y servicios; la categoría permite separarlos.
 */
export function detectRecurring(txs: TxLike[]): RecurringCandidate[] {
  const groups = new Map<string, TxLike[]>();
  for (const tx of txs) {
    if (tx.direction !== "DEBIT" || isNeutralCategory(tx.category)) continue;
    const key = merchantKey(tx);
    const list = groups.get(key);
    if (list) list.push(tx);
    else groups.set(key, [tx]);
  }

  const result: RecurringCandidate[] = [];
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const sorted = [...list].sort((a, b) => a.postedAt.getTime() - b.postedAt.getTime());
    const amounts = sorted.map((tx) => tx.amount);
    const typical = median(amounts);
    if (!amounts.every((amount) => Math.abs(amount - typical) <= Math.max(1, typical * 0.1))) continue;

    const gaps: number[] = [];
    for (let i = 1; i < sorted.length; i++) {
      gaps.push((sorted[i].postedAt.getTime() - sorted[i - 1].postedAt.getTime()) / DAY_MS);
    }
    const average = gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length;
    const match = CADENCES.find(
      (c) => Math.abs(average - c.days) <= c.tolerance && gaps.every((gap) => Math.abs(gap - c.days) <= c.tolerance * 2),
    );
    if (!match) continue;

    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    result.push({
      merchant: last.merchantName ?? last.description,
      category: last.category,
      subcategory: last.subcategory ?? null,
      currency: last.currency,
      amount: round2(typical),
      cadence: match.cadence,
      count: sorted.length,
      firstSeenAt: first.postedAt,
      lastChargedAt: last.postedAt,
      nextExpectedAt: new Date(last.postedAt.getTime() + Math.round(match.days) * DAY_MS),
    });
  }

  return result.sort((a, b) => monthlyEquivalent(b.amount, b.cadence) - monthlyEquivalent(a.amount, a.cadence));
}
