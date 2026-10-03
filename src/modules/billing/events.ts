import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import type { BillingProvider } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";

// Idempotencia de webhooks: cada evento se procesa una sola vez aunque el proveedor lo reintente.

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "P2002";
}

/** true si este proceso debe procesar el evento; false si ya se procesó. */
export async function claimEvent(
  provider: BillingProvider,
  eventId: string,
  type: string,
  payload: unknown,
): Promise<boolean> {
  const existing = await prisma.billingEvent.findUnique({
    where: { provider_eventId: { provider, eventId } },
    select: { processedAt: true },
  });
  if (existing?.processedAt) return false;
  if (existing) return true; // quedó a medias en un intento anterior: se reprocesa

  try {
    await prisma.billingEvent.create({
      data: { provider, eventId, type, payload: payload as Prisma.InputJsonValue },
    });
    return true;
  } catch (error) {
    if (isUniqueViolation(error)) return false; // otro proceso lo tomó al mismo tiempo
    throw error;
  }
}

export async function markEventProcessed(provider: BillingProvider, eventId: string, userId: string | null) {
  await prisma.billingEvent.update({
    where: { provider_eventId: { provider, eventId } },
    data: { processedAt: new Date(), userId },
  });
}
