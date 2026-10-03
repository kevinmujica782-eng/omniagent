import "server-only";
import { z } from "zod";
import { Errors } from "@/lib/errors";
import { isUuid } from "@/lib/validation";
import { defineTool } from "@/modules/agent/registry";
import { getEntitlements } from "@/modules/billing/entitlements";
import { addGoalProgress, createGoal, listGoals, toGoalCard } from "./goals.service";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const goalsTools = [
  defineTool({
    name: "goals_create",
    module: "GOALS",
    description:
      "Crea una meta personal (ahorro, viaje, salud...) con monto y fecha objetivo opcionales y hasta 6 pasos concretos. Calcula cuánto apartar al mes si hay monto y fecha.",
    input: z.object({
      title: z.string().min(3).max(120),
      category: z.enum(["SAVINGS", "HEALTH", "FAMILY", "HOME", "TRAVEL", "CAREER", "OTHER"]).default("SAVINGS"),
      description: z.string().max(280).optional(),
      target_amount: z.number().positive().optional(),
      current_amount: z.number().min(0).default(0),
      target_date: z.string().regex(DATE_RE).optional().describe("Fecha objetivo AAAA-MM-DD"),
      steps: z.array(z.string().min(2).max(120)).max(6).default([]),
    }),
    async run(input, ctx) {
      const entitlements = await getEntitlements(ctx.userId);
      const targetDate = input.target_date ? new Date(`${input.target_date}T00:00:00Z`) : null;
      if (targetDate && targetDate.getTime() <= ctx.now.getTime()) {
        throw Errors.badRequest("La fecha objetivo debe ser futura.");
      }
      const goal = await createGoal(
        ctx.userId,
        {
          title: input.title,
          category: input.category,
          description: input.description ?? null,
          targetAmount: input.target_amount ?? null,
          currentAmount: input.current_amount,
          targetDate,
          currency: ctx.currency,
          steps: input.steps,
        },
        entitlements.limits.activeGoals,
        entitlements.plan,
      );
      const card = toGoalCard(goal);
      return { data: { created: true, goal: card }, cards: [card] };
    },
  }),

  defineTool({
    name: "goals_list",
    module: "GOALS",
    description: "Lista las metas activas con su avance, monto objetivo y aporte mensual sugerido.",
    input: z.object({}),
    async run(_input, ctx) {
      const goals = await listGoals(ctx.userId);
      return { data: goals.map(toGoalCard) };
    },
  }),

  defineTool({
    name: "goals_add_progress",
    module: "GOALS",
    description:
      "Registra un avance en una meta (por ejemplo, dinero apartado). Usa un monto negativo solo si el usuario pide corregir.",
    input: z.object({
      goal_id: z.string().describe("id obtenido de goals_list"),
      amount: z.number().describe("Monto a sumar al avance actual"),
    }),
    async run({ goal_id, amount }, ctx) {
      if (!isUuid(goal_id)) throw Errors.badRequest("Ese id de meta no es válido.");
      const goal = await addGoalProgress(ctx.userId, goal_id, amount);
      const card = toGoalCard(goal);
      return { data: { updated: true, status: goal.status, goal: card }, cards: [card] };
    },
  }),
];
