import "server-only";
import { CRON_BUDGET_MS, runBatch } from "@/lib/batch";
import { prisma } from "@/lib/db";
import { entitledSubscriptionWhere } from "@/modules/billing/entitlements";
import { PLANS } from "@/modules/billing/plans";
import { MAIL_PROVIDERS } from "./mail/mailbox";
import { syncMailbox } from "./mail/mail.service";
import { deliverDueReminders } from "./reminders";

// Trabajo programado del módulo de trámites: revisa las bandejas atrasadas (y crea las sugerencias) y entrega los
// recordatorios que vencieron. Las bandejas van por lotes: las más atrasadas primero, varias a la vez y sin empezar
// otra cuando se acaba el tiempo; las que no alcanzan se revisan en la próxima corrida.

/** Bandejas que se toman por corrida (el tiempo máximo corta antes si hace falta). */
const MAILBOXES_PER_RUN = 60;
/** Bandejas que se revisan a la vez: cada una abre su propia conexión IMAP. */
const MAILBOX_CONCURRENCY = 3;

export async function runScheduledProcedureJobs(opts: { syncLimit?: number; now?: Date; budgetMs?: number } = {}) {
  const nowDate = opts.now ?? new Date();
  const now = nowDate.getTime();
  const result = { synced: 0, suggested: 0, reminders: 0, errors: 0, pending: 0 };

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
    take: opts.syncLimit ?? MAILBOXES_PER_RUN,
    select: { id: true, userId: true },
  });
  // Con correos reales (IMAP), cada bandeja tarda unos segundos.
  const batch = await runBatch(
    stale,
    async (connection) => {
      const sync = await syncMailbox(connection.userId, connection.id);
      result.suggested += sync.suggested;
    },
    {
      budgetMs: opts.budgetMs ?? CRON_BUDGET_MS,
      concurrency: MAILBOX_CONCURRENCY,
      onError: (connection, error) => console.error("[cron] no se pudo revisar la bandeja", connection.id, error),
    },
  );
  result.synced = batch.done;
  result.errors = batch.failed;
  result.pending = batch.pending;

  result.reminders = await deliverDueReminders({ limit: 500 });
  return result;
}
