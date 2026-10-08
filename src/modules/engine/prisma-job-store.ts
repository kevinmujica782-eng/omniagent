import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import type { JobPatch, JobRow, JobStore, NewJob } from "./job-store";

// Almacén del motor en Postgres. Cada escritura del ejecutor lleva su turno en el WHERE (locked_by = worker): si otro
// ejecutor tomó el trabajo porque el turno venció, la escritura no hace nada y el ejecutor viejo se detiene.

const json = (value: unknown) => value as Prisma.InputJsonValue;

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2002";
}

function toData(patch: JobPatch): Prisma.EngineJobUpdateManyMutationInput {
  return {
    ...(patch.status !== undefined ? { status: patch.status } : {}),
    ...(patch.steps !== undefined ? { steps: json(patch.steps) } : {}),
    ...(patch.currentStep !== undefined ? { currentStep: patch.currentStep } : {}),
    ...(patch.result !== undefined ? { result: json(patch.result) } : {}),
    ...(patch.errorMessage !== undefined ? { errorMessage: patch.errorMessage } : {}),
    ...(patch.waitingFor !== undefined ? { waitingFor: patch.waitingFor } : {}),
    ...(patch.runAfter !== undefined ? { runAfter: patch.runAfter } : {}),
    ...(patch.lockedUntil !== undefined ? { lockedUntil: patch.lockedUntil } : {}),
    ...(patch.activeKey !== undefined ? { activeKey: null } : {}),
    ...(patch.finishedAt !== undefined ? { finishedAt: patch.finishedAt } : {}),
  };
}

export const prismaJobStore: JobStore = {
  async create(job: NewJob): Promise<JobRow | null> {
    try {
      return await prisma.engineJob.create({
        data: {
          userId: job.userId,
          playbook: job.playbook,
          module: job.module,
          title: job.title,
          input: json(job.input),
          steps: json(job.steps),
          source: job.source,
          conversationId: job.conversationId,
          activeKey: job.activeKey,
        },
      });
    } catch (error) {
      if (isUniqueViolation(error)) return null;
      throw error;
    }
  },

  findActive(userId, activeKey) {
    return prisma.engineJob.findFirst({ where: { userId, activeKey, status: { in: ["QUEUED", "RUNNING", "WAITING"] } } });
  },

  countRunning(userId) {
    return prisma.engineJob.count({ where: { userId, status: { in: ["QUEUED", "RUNNING"] } } });
  },

  find(id) {
    return prisma.engineJob.findUnique({ where: { id } });
  },

  findForUser(userId, id) {
    return prisma.engineJob.findFirst({ where: { id, userId } });
  },

  listForUser(userId, { activeOnly, take }) {
    return prisma.engineJob.findMany({
      where: { userId, ...(activeOnly ? { status: { in: ["QUEUED", "RUNNING", "WAITING"] } } : {}) },
      orderBy: { createdAt: "desc" },
      take,
    });
  },

  async claim(id, worker, now, leaseMs) {
    const claimed = await prisma.engineJob.updateMany({
      where: {
        id,
        OR: [
          { status: { in: ["QUEUED", "WAITING"] }, runAfter: { lte: now } },
          { status: "RUNNING", lockedUntil: { lt: now } },
        ],
      },
      data: { status: "RUNNING", lockedBy: worker, lockedUntil: new Date(now.getTime() + leaseMs) },
    });
    if (claimed.count === 0) return null;
    await prisma.engineJob.updateMany({ where: { id, lockedBy: worker, startedAt: null }, data: { startedAt: now } });
    const row = await prisma.engineJob.findUnique({ where: { id } });
    return row?.lockedBy === worker ? row : null;
  },

  async update(id, worker, patch) {
    const result = await prisma.engineJob.updateMany({ where: { id, lockedBy: worker }, data: toData(patch) });
    return result.count === 1;
  },

  async release(id, worker, patch) {
    const result = await prisma.engineJob.updateMany({
      where: { id, lockedBy: worker },
      data: { ...toData(patch), lockedBy: null, lockedUntil: null },
    });
    return result.count === 1;
  },

  async cancelIdle(userId, id, now, steps) {
    const result = await prisma.engineJob.updateMany({
      where: {
        id,
        userId,
        status: { in: ["QUEUED", "WAITING"] },
        OR: [{ lockedBy: null }, { lockedUntil: { lt: now } }],
      },
      data: {
        status: "CANCELED",
        steps: json(steps),
        activeKey: null,
        waitingFor: [],
        cancelRequestedAt: now,
        finishedAt: now,
        lockedBy: null,
        lockedUntil: null,
      },
    });
    return result.count === 1;
  },

  async requestCancel(userId, id, now) {
    const result = await prisma.engineJob.updateMany({
      where: { id, userId, status: "RUNNING", cancelRequestedAt: null },
      data: { cancelRequestedAt: now },
    });
    return result.count === 1;
  },

  async due(now, limit) {
    const rows = await prisma.engineJob.findMany({
      where: {
        OR: [
          { status: { in: ["QUEUED", "WAITING"] }, runAfter: { lte: now } },
          { status: "RUNNING", lockedUntil: { lt: now } },
        ],
      },
      orderBy: { runAfter: "asc" },
      take: limit,
      select: { id: true },
    });
    return rows.map((row) => row.id);
  },

  async wake(actionId, now) {
    const rows = await prisma.engineJob.findMany({
      where: { status: "WAITING", waitingFor: { has: actionId } },
      select: { id: true },
    });
    if (rows.length === 0) return [];
    const ids = rows.map((row) => row.id);
    await prisma.engineJob.updateMany({ where: { id: { in: ids }, status: "WAITING" }, data: { runAfter: now } });
    return ids;
  },
};
