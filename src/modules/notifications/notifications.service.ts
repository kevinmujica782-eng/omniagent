import "server-only";
import { prisma } from "@/lib/db";
import { isUuid } from "@/lib/validation";
import type { ActivityItem } from "@/types/dashboard";

/** Avisos de Omni (bajadas de precio, recordatorios, pedidos, cambios de plan...), del más reciente al más viejo. */
export async function listNotifications(userId: string, take = 30): Promise<{ items: ActivityItem[]; unread: number }> {
  const [rows, unread] = await Promise.all([
    prisma.appNotification.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: Math.min(Math.max(take, 1), 100) }),
    prisma.appNotification.count({ where: { userId, readAt: null } }),
  ]);
  return {
    unread,
    items: rows.map((n) => ({
      id: n.id,
      type: n.type,
      title: n.title,
      body: n.body,
      href: n.href,
      createdAt: n.createdAt.toISOString(),
      read: n.readAt !== null,
    })),
  };
}

/** Marca como leídos los avisos indicados (o todos). Devuelve cuántos cambiaron. */
export async function markNotificationsRead(userId: string, ids: string[] | null, now = new Date()): Promise<number> {
  const valid = ids?.filter(isUuid) ?? null;
  if (valid && valid.length === 0) return 0;
  const result = await prisma.appNotification.updateMany({
    where: { userId, readAt: null, ...(valid ? { id: { in: valid } } : {}) },
    data: { readAt: now },
  });
  return result.count;
}
