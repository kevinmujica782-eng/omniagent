import "server-only";
import { prisma } from "@/lib/db";
import { Errors } from "@/lib/errors";
import { isUuid } from "@/lib/validation";
import type { BudgetView } from "@/types/cards";

function monthStartUtc(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

function toView(
  budget: { id: string; category: string; currency: string; monthlyLimit: { toString(): string }; alertAtPct: number },
  spent: number,
): BudgetView {
  const limit = Number(budget.monthlyLimit);
  const pct = limit > 0 ? Math.round((spent / limit) * 100) : 0;
  return {
    id: budget.id,
    category: budget.category,
    currency: budget.currency,
    monthlyLimit: limit,
    spent: Math.round(spent * 100) / 100,
    pct,
    state: pct >= 100 ? "excedido" : pct >= budget.alertAtPct ? "alerta" : "ok",
  };
}

async function spentThisMonth(userId: string, categories: string[]): Promise<Map<string, number>> {
  if (categories.length === 0) return new Map();
  const groups = await prisma.transaction.groupBy({
    by: ["category"],
    where: { userId, direction: "DEBIT", postedAt: { gte: monthStartUtc() }, category: { in: categories } },
    _sum: { amount: true },
  });
  return new Map(
    (groups as { category: string | null; _sum: { amount: unknown } }[]).map((g) => [g.category ?? "", Number(g._sum.amount ?? 0)]),
  );
}

export async function listBudgets(userId: string): Promise<BudgetView[]> {
  const budgets = await prisma.categoryBudget.findMany({ where: { userId }, orderBy: { category: "asc" } });
  const spent = await spentThisMonth(userId, budgets.map((b) => b.category));
  return budgets.map((budget) => toView(budget, spent.get(budget.category) ?? 0));
}

export async function upsertBudget(
  userId: string,
  input: { category: string; monthlyLimit: number; source?: "user" | "agent" | "recommendation" },
): Promise<BudgetView> {
  const category = input.category.trim();
  if (!category) throw Errors.badRequest("Indica la categoría del presupuesto.");
  if (!(input.monthlyLimit > 0)) throw Errors.badRequest("El presupuesto debe ser mayor que cero.");
  const account = await prisma.financialAccount.findFirst({ where: { userId }, select: { currency: true } });
  const monthlyLimit = Math.round(input.monthlyLimit * 100) / 100;
  const budget = await prisma.categoryBudget.upsert({
    where: { userId_category: { userId, category } },
    create: { userId, category, monthlyLimit, currency: account?.currency ?? "USD", source: input.source ?? "user" },
    update: { monthlyLimit, source: input.source ?? "user" },
  });
  const spent = await spentThisMonth(userId, [category]);
  return toView(budget, spent.get(category) ?? 0);
}

export async function deleteBudget(userId: string, budgetId: string) {
  if (!isUuid(budgetId)) throw Errors.notFound("El presupuesto");
  const deleted = await prisma.categoryBudget.deleteMany({ where: { id: budgetId, userId } });
  if (deleted.count === 0) throw Errors.notFound("El presupuesto");
  return { deleted: true };
}
