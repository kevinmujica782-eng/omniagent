import "server-only";
import { prisma } from "@/lib/db";
import { entitledSubscriptionWhere } from "@/modules/billing/entitlements";
import { PLANS } from "@/modules/billing/plans";
import { MAIL_PROVIDERS } from "./mail/mailbox";
import { syncMailbox } from "./mail/mail.service";
import { deliverDueReminders } from "./reminders";

// Trabajo programado del módulo de trámites: revisa las bandejas atrasadas (y crea las sugerencias)
// y entrega los recordatorios que vencieron. Lotes pequeños para caber en una función serverless.

export async function runScheduledProcedureJobs(opts: { syncLimit?: number; now?: Date } = {}) {
  const nowDate = opts.now ?? new Date();
  const now = nowDate.getTime();
  const result = { synced: 0, suggested: 0, reminders: 0, errors: 0 };

  // Correo en piloto automático: en Pro la bandeja se revisa cada pocas horas; en Gratis, una vez al día.
  const stale = await prisma.integrationConnection.findMany({
    where: {
      provider: { in: [...MAIL_PROVIDERS] },
      status: "ACTIVE",
      OR: [
        { lastSyncedAt: null },
        { lastSyncedAt: { lt: new Date(now - PLANS.FREE.mailCheckHours * 3_600_000) } },
        {
          lastSyncedAt: { lt: new Date(now - PLANS.PRO.mailCheckHours * 3_600_000) },
          user: { subscriptions: { some: entitledSubscriptionWhere(nowDate) } },
        },
      ],
    },
    orderBy: { lastSyncedAt: "asc" },
    take: opts.syncLimit ?? 20,
    select: { id: true, userId: true },
  });
  for (const connection of stale) {
    try {
      const sync = await syncMailbox(connection.userId, connection.id);
      result.synced += 1;
      result.suggested += sync.suggested;
    } catch (error) {
      result.errors += 1;
      console.error("[cron] no se pudo revisar la bandeja", connection.id, error);
    }
  }

  result.reminders = await deliverDueReminders({ limit: 500 });
  return result;
}
