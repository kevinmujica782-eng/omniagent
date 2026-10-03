import type { Metadata } from "next";
import { GoalsView } from "@/components/views/goals-view";
import { requireUser } from "@/lib/auth";
import { countTracking } from "@/modules/concierge/concierge.service";
import { listGoals, toGoalCard } from "@/modules/goals/goals.service";

export const metadata: Metadata = { title: "Metas" };

export default async function GoalsPage() {
  const user = await requireUser();
  const [goals, watching] = await Promise.all([listGoals(user.userId), countTracking(user.userId)]);
  return <GoalsView goals={goals.map(toGoalCard)} watching={watching} />;
}
