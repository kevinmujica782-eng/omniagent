import "server-only";
import type { Goal } from "@/generated/prisma/client";
import type { GoalCategory } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { Errors } from "@/lib/errors";
import type { GoalCard } from "@/types/cards";

const round2 = (n: number) => Math.round(n * 100) / 100;

export function toGoalCard(goal: Goal): GoalCard {
  return {
    kind: "goal",
    goalId: goal.id,
    title: goal.title,
    description: goal.description,
    category: goal.category,
    currency: goal.currency,
    targetAmount: goal.targetAmount === null ? null : Number(goal.targetAmount),
    currentAmount: Number(goal.currentAmount),
    monthlyContribution: goal.monthlyContribution === null ? null : Number(goal.monthlyContribution),
    targetDate: goal.targetDate ? goal.targetDate.toISOString().slice(0, 10) : null,
  };
}

/** Meses completos que faltan hasta la fecha objetivo (mínimo 1). */
export function monthsUntil(target: Date, now = new Date()): number {
  const months = (target.getUTCFullYear() - now.getUTCFullYear()) * 12 + (target.getUTCMonth() - now.getUTCMonth());
  return Math.max(1, months);
}

export function suggestMonthlyContribution(
  targetAmount: number | null,
  currentAmount: number,
  targetDate: Date | null,
  now = new Date(),
): number | null {
  if (targetAmount === null || targetDate === null) return null;
  const missing = Math.max(0, targetAmount - currentAmount);
  return round2(missing / monthsUntil(targetDate, now));
}

export async function listGoals(userId: string, scope: "active" | "all" = "active") {
  return prisma.goal.findMany({
    where: { userId, ...(scope === "active" ? { status: "ACTIVE" } : {}) },
    orderBy: [{ targetDate: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }],
  });
}

export async function createGoal(
  userId: string,
  input: {
    title: string;
    category: GoalCategory;
    description: string | null;
    targetAmount: number | null;
    currentAmount: number;
    targetDate: Date | null;
    currency: string;
    steps: string[];
    /** Si se indica, reemplaza el aporte mensual calculado. */
    monthlyContribution?: number | null;
  },
  maxActive: number,
  plan: "FREE" | "PRO" = "FREE",
) {
  const active = await prisma.goal.count({ where: { userId, status: "ACTIVE" } });
  if (active >= maxActive) {
    throw Errors.planLimit(
      plan === "FREE"
        ? `Tu plan permite ${maxActive} metas activas. Pausa una o pásate a Pro.`
        : `Llegaste a ${maxActive} metas activas. Pausa o termina alguna para crear otra.`,
      { plan, reason: "goals", limit: maxActive },
    );
  }
  return prisma.goal.create({
    data: {
      userId,
      title: input.title,
      category: input.category,
      description: input.description,
      targetAmount: input.targetAmount,
      currentAmount: input.currentAmount,
      monthlyContribution:
        input.monthlyContribution ?? suggestMonthlyContribution(input.targetAmount, input.currentAmount, input.targetDate),
      targetDate: input.targetDate,
      currency: input.currency,
      plan: input.steps.map((title) => ({ title, done: false })),
    },
  });
}

export async function addGoalProgress(userId: string, goalId: string, amount: number) {
  const goal = await prisma.goal.findFirst({ where: { id: goalId, userId } });
  if (!goal) throw Errors.notFound("La meta");

  const current = round2(Number(goal.currentAmount) + amount);
  const target = goal.targetAmount === null ? null : Number(goal.targetAmount);
  const achieved = target !== null && current >= target;
  return prisma.goal.update({
    where: { id: goal.id },
    data: {
      currentAmount: Math.max(0, current),
      status: achieved ? "ACHIEVED" : goal.status,
      monthlyContribution: achieved ? null : suggestMonthlyContribution(target, current, goal.targetDate),
    },
  });
}
