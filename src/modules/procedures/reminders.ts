import "server-only";
import { prisma } from "@/lib/db";
import { OPEN_STATUSES } from "./calendar/calendar.service";
import { readPlanMeta, reminderText } from "./plan-rules";
import { safeTimeZone } from "./time/tz";

// Recordatorios dentro de la app: cuando llega el remind_at de un trámite activo se crea un aviso
// (una sola vez por fecha: reminded_at). En el teléfono suenan además las alarmas de los eventos del
// calendario (feed ICS o calendario conectado).

export async function deliverDueReminders(opts: { userId?: string; limit?: number } = {}): Promise<number> {
  const now = new Date();
  const tasks = await prisma.task.findMany({
    where: {
      ...(opts.userId ? { userId: opts.userId } : {}),
      status: { in: [...OPEN_STATUSES] },
      remindAt: { lte: now },
      remindedAt: null,
    },
    include: { user: { select: { timezone: true } } },
    orderBy: { remindAt: "asc" },
    take: opts.limit ?? 50,
  });

  let delivered = 0;
  for (const task of tasks) {
    // Reclamo atómico: la vista y el cron pueden llegar al mismo tiempo.
    const claimed = await prisma.task.updateMany({ where: { id: task.id, remindedAt: null }, data: { remindedAt: now } });
    if (claimed.count === 0) continue;
    const meta = readPlanMeta(task.metadata, task.type);
    const body = reminderText(
      {
        kind: meta.kind,
        dueAt: task.dueAt,
        dueHasTime: meta.dueHasTime,
        event: meta.event
          ? { ...meta.event, startsAt: new Date(meta.event.startsAt), endsAt: meta.event.endsAt ? new Date(meta.event.endsAt) : null }
          : null,
      },
      now,
      safeTimeZone(task.user.timezone),
    );
    await prisma.appNotification.create({
      data: {
        userId: task.userId,
        type: "REMINDER",
        title: task.title,
        body,
        href: `/tramites?t=${task.id}`,
        data: { taskId: task.id },
      },
    });
    delivered += 1;
  }
  return delivered;
}
