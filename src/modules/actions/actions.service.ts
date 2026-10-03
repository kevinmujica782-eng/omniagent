import "server-only";
import type { AgentAction, Prisma } from "@/generated/prisma/client";
import type { ActionType, AgentModule } from "@/generated/prisma/enums";
import { actionIntro } from "@/lib/actions-copy";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { AppError, Errors } from "@/lib/errors";
import { CADENCE_PHRASE } from "@/lib/format";
import { isUuid } from "@/lib/validation";
import type { ApprovalCard } from "@/types/cards";
import { executeAction } from "./executors";

// Patrón Proponer → Aprobar → Ejecutar.
// El agente nunca ejecuta efectos externos: crea una AgentAction PENDING y el usuario decide.

const DEFAULT_TTL_HOURS = 72;

export interface ProposeActionInput {
  userId: string;
  conversationId?: string | null;
  module: AgentModule;
  type: ActionType;
  title: string;
  summary?: string | null;
  merchant?: string | null;
  amount?: number | null;
  currency?: string | null;
  lines?: { label: string; value: string }[];
  payload: Record<string, unknown>;
  ttlHours?: number;
  /** Avisar con una notificación (no hace falta si el usuario mismo la acaba de pedir). */
  notify?: boolean;
  /** Reloj del llamador (pruebas y tareas programadas). */
  now?: Date;
}

type StoredPayload = {
  merchant?: string | null;
  cadence?: string | null;
  lines?: { label: string; value: string }[];
};

export async function proposeAction(input: ProposeActionInput): Promise<ApprovalCard> {
  const action = await prisma.agentAction.create({
    data: {
      userId: input.userId,
      conversationId: input.conversationId ?? null,
      module: input.module,
      type: input.type,
      title: input.title,
      summary: input.summary ?? null,
      amount: input.amount ?? null,
      currency: input.currency ?? null,
      payload: {
        ...input.payload,
        merchant: input.merchant ?? null,
        lines: input.lines ?? [],
      } as Prisma.InputJsonValue,
      expiresAt: new Date((input.now ?? new Date()).getTime() + (input.ttlHours ?? DEFAULT_TTL_HOURS) * 3_600_000),
      ...(input.now ? { createdAt: input.now } : {}),
    },
  });

  if (input.notify !== false) {
    await prisma.appNotification.create({
      data: {
        userId: input.userId,
        type: "ACTION_REQUIRED",
        title: "Omni necesita tu aprobación",
        body: `${actionIntro(input.type, input.merchant ?? null)}: ${input.title}`,
        href: "/aprobaciones",
        data: { actionId: action.id },
      },
    });
  }
  await audit({
    userId: input.userId,
    actor: "agent",
    action: "action.proposed",
    entity: "agent_action",
    entityId: action.id,
    metadata: { type: input.type },
  });

  return toApprovalCard(action);
}

export function toApprovalCard(action: AgentAction): ApprovalCard {
  const payload = (action.payload ?? {}) as unknown as StoredPayload;
  const result = (action.result ?? null) as unknown as { message?: string } | null;
  return {
    kind: "approval",
    actionId: action.id,
    type: action.type,
    status: action.status,
    title: action.title,
    summary: action.summary,
    merchant: payload.merchant ?? null,
    amount: action.amount === null ? null : Number(action.amount),
    amountPeriod: payload.cadence ? CADENCE_PHRASE[payload.cadence] ?? null : null,
    currency: action.currency,
    lines: Array.isArray(payload.lines) ? payload.lines : [],
    resultMessage: action.errorMessage ?? result?.message ?? null,
    createdAt: action.createdAt.toISOString(),
  };
}

async function expireStale(userId: string) {
  await prisma.agentAction.updateMany({
    where: { userId, status: "PENDING", expiresAt: { lt: new Date() } },
    data: { status: "EXPIRED" },
  });
}

export async function countPendingActions(userId: string): Promise<number> {
  return prisma.agentAction.count({
    where: { userId, status: "PENDING", OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
  });
}

export async function listActions(userId: string, filter: "pending" | "history", take = 20): Promise<ApprovalCard[]> {
  await expireStale(userId);
  const rows = await prisma.agentAction.findMany({
    where: { userId, status: filter === "pending" ? "PENDING" : { not: "PENDING" } },
    orderBy: { createdAt: "desc" },
    take,
  });
  return rows.map(toApprovalCard);
}

export async function getActionCard(userId: string, actionId: string): Promise<ApprovalCard> {
  if (!isUuid(actionId)) throw Errors.notFound("La acción");
  const action = await prisma.agentAction.findFirst({ where: { id: actionId, userId } });
  if (!action) throw Errors.notFound("La acción");
  return toApprovalCard(action);
}

export async function decideAction(
  userId: string,
  actionId: string,
  decision: "approve" | "reject",
): Promise<ApprovalCard> {
  if (!isUuid(actionId)) throw Errors.notFound("La acción");
  const action = await prisma.agentAction.findFirst({ where: { id: actionId, userId } });
  if (!action) throw Errors.notFound("La acción");
  if (action.status !== "PENDING") throw Errors.conflict("Esta acción ya fue decidida.");
  // Las compras solo se autorizan en la hoja de pago (Permitir/Denegar), que vuelve a confirmar el precio.
  if (decision === "approve" && action.type === "PURCHASE") {
    throw Errors.conflict("Las compras se autorizan en la hoja de pago: ábrela y pulsa Permitir o Denegar.");
  }

  if (action.expiresAt && action.expiresAt < new Date()) {
    await prisma.agentAction.update({ where: { id: actionId }, data: { status: "EXPIRED" } });
    throw Errors.conflict("Esta propuesta venció. Pídele a Omni que la prepare de nuevo.");
  }

  // Reclamo atómico: si el usuario pulsa dos veces (o desde dos dispositivos), solo una decisión gana.
  const claimed = await prisma.agentAction.updateMany({
    where: { id: actionId, userId, status: "PENDING" },
    data: { status: decision === "approve" ? "APPROVED" : "REJECTED", decidedAt: new Date() },
  });
  if (claimed.count === 0) throw Errors.conflict("Esta acción ya fue decidida.");

  await audit({
    userId,
    actor: "user",
    action: decision === "approve" ? "action.approved" : "action.rejected",
    entity: "agent_action",
    entityId: actionId,
    metadata: { type: action.type },
  });

  if (decision === "reject") {
    return toApprovalCard({ ...action, status: "REJECTED", decidedAt: new Date() });
  }

  try {
    const result = await executeAction(action);
    const updated = await prisma.agentAction.update({
      where: { id: actionId },
      data: { status: "EXECUTED", executedAt: new Date(), result: result as unknown as Prisma.InputJsonValue },
    });
    await audit({ userId, actor: "system", action: "action.executed", entity: "agent_action", entityId: actionId });
    return toApprovalCard(updated);
  } catch (error) {
    if (!(error instanceof AppError)) console.error("[actions] fallo al ejecutar", error);
    const message = error instanceof AppError ? error.message : "No se pudo completar la acción.";
    const updated = await prisma.agentAction.update({
      where: { id: actionId },
      data: { status: "FAILED", errorMessage: message },
    });
    return toApprovalCard(updated);
  }
}
