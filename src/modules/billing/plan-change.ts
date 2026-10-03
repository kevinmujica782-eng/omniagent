import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { readItemMeta } from "@/modules/concierge/item-meta";
import { PLANS, type PlanId } from "./plans";

// Cuando cambia el plan (webhook de Stripe o de RevenueCat), los agentes se ajustan en el momento:
// - a Pro: los precios pasan a revisarse cada hora (la próxima revisión se adelanta) y vuelve lo pausado por el plan;
// - a Gratis: revisión diaria y solo los N seguimientos más recientes siguen activos; el resto se pausa
//   (marcado como "pausado por el plan") y se avisa al usuario. Nada se borra.

const WATCHED_SOURCES = ["sandbox", "web"];

export type PlanChangeResult = { from: PlanId; to: PlanId; retimed: number; paused: number; resumed: number };

export async function applyPlanChange(userId: string, from: PlanId, to: PlanId, now = new Date()): Promise<PlanChangeResult> {
  const result: PlanChangeResult = { from, to, retimed: 0, paused: 0, resumed: 0 };
  if (from === to) return result;
  const limits = PLANS[to];
  const soon = new Date(now.getTime() + 5 * 60_000);

  const retimed = await prisma.watchlistItem.updateMany({
    where: { userId, status: { in: ["ACTIVE", "PAUSED"] } },
    data: { checkEveryMinutes: limits.priceCheckMinutes },
  });
  result.retimed = retimed.count;

  if (to === "PRO") {
    await prisma.watchlistItem.updateMany({
      where: { userId, status: "ACTIVE", source: { in: WATCHED_SOURCES }, nextCheckAt: { gt: soon } },
      data: { nextCheckAt: soon },
    });
    const paused = await prisma.watchlistItem.findMany({ where: { userId, status: "PAUSED" }, orderBy: { createdAt: "desc" } });
    const active = await prisma.watchlistItem.count({ where: { userId, status: "ACTIVE" } });
    let room = Math.max(0, limits.watchlistItems - active);
    for (const item of paused) {
      const meta = readItemMeta(item.metadata);
      if (!meta.pausedByPlan || room === 0) continue;
      await prisma.watchlistItem.update({
        where: { id: item.id },
        data: {
          status: "ACTIVE",
          nextCheckAt: item.source === "manual" ? null : soon,
          metadata: { ...meta, pausedByPlan: false } as unknown as Prisma.InputJsonValue,
        },
      });
      result.resumed++;
      room--;
    }
  } else {
    const active = await prisma.watchlistItem.findMany({ where: { userId, status: "ACTIVE" }, orderBy: { createdAt: "desc" } });
    for (const item of active.slice(limits.watchlistItems)) {
      const meta = readItemMeta(item.metadata);
      await prisma.watchlistItem.update({
        where: { id: item.id },
        data: { status: "PAUSED", nextCheckAt: null, metadata: { ...meta, pausedByPlan: true } as unknown as Prisma.InputJsonValue },
      });
      result.paused++;
    }
    if (result.paused > 0) {
      await prisma.appNotification.create({
        data: {
          userId,
          type: "SYSTEM",
          title: "Tu plan cambió a Gratis",
          body: `Sigo vigilando ${limits.watchlistItems} precios una vez al día y pausé ${result.paused}. En Compras puedes elegir cuáles seguir; si vuelves a Pro, los reanudo.`,
          href: "/compras",
        },
      });
    }
  }

  await audit({ userId, actor: "system", action: "billing.plan_change", metadata: result });
  return result;
}
