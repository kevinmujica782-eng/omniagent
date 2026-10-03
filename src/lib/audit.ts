import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "./db";

/** Bitácora de acciones sensibles. Nunca rompe el flujo principal si falla. */
export async function audit(entry: {
  userId?: string | null;
  actor: "user" | "agent" | "system" | "webhook";
  action: string;
  entity?: string;
  entityId?: string;
  metadata?: Prisma.InputJsonValue;
}): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        userId: entry.userId ?? null,
        actor: entry.actor,
        action: entry.action,
        entity: entry.entity ?? null,
        entityId: entry.entityId ?? null,
        metadata: entry.metadata ?? {},
      },
    });
  } catch (error) {
    console.error("[audit] no se pudo registrar", error);
  }
}
