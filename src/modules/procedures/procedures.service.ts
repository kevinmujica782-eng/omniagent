import "server-only";
import type { Task } from "@/generated/prisma/client";
import type { TaskPriority, TaskType } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import type { TaskCard } from "@/types/cards";

export const OPEN_TASK_STATUSES = ["PENDING", "IN_PROGRESS", "WAITING_USER"] as const;

export function toTaskCard(task: Task): TaskCard {
  return {
    kind: "task",
    taskId: task.id,
    title: task.title,
    type: task.type,
    notes: task.notes,
    dueAt: task.dueAt?.toISOString() ?? null,
    remindAt: task.remindAt?.toISOString() ?? null,
  };
}

export async function listTasks(userId: string, scope: "open" | "done" = "open", take = 20) {
  return prisma.task.findMany({
    where: { userId, status: scope === "open" ? { in: [...OPEN_TASK_STATUSES] } : "DONE" },
    orderBy: [{ dueAt: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }],
    take,
  });
}

export async function countOpenTasks(userId: string): Promise<number> {
  return prisma.task.count({ where: { userId, status: { in: [...OPEN_TASK_STATUSES] } } });
}

export async function createTask(
  userId: string,
  input: {
    title: string;
    type: TaskType;
    priority: TaskPriority;
    notes: string | null;
    dueAt: Date | null;
    remindAt: Date | null;
    source?: "user" | "agent" | "email";
  },
) {
  return prisma.task.create({
    data: {
      userId,
      title: input.title,
      type: input.type,
      priority: input.priority,
      notes: input.notes,
      dueAt: input.dueAt,
      remindAt: input.remindAt,
      source: input.source ?? "agent",
    },
  });
}
