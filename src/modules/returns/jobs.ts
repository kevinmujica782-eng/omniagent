import "server-only";
import { prisma } from "@/lib/db";
import { log } from "@/lib/log";
import { MAIL_PROVIDERS } from "@/modules/procedures/mail/mailbox";
import { refreshReturns } from "./returns.service";
import { REFUND_WATCH_DAYS } from "./rules/delivery";
import { pickReturnUsers } from "./rules/turns";

// Trabajo programado de pedidos y devoluciones: para cada persona con pedidos en camino, reclamos que esperan
// respuesta, reembolsos por confirmar, correo conectado o compras recientes, pone todo al día (retrasos,
// seguimientos, respuestas y reembolsos). Primero quien tiene algo vencido; los demás, por turnos: cada corrida
// empieza en otro punto de la lista, así nadie queda siempre afuera cuando hay más personas que lugares. Lotes
// pequeños para caber en una función serverless. Llamar de más no duplica nada: cada paso es idempotente.

const DAY = 86_400_000;

export async function runScheduledReturnJobs(opts: { limit?: number; now?: Date } = {}) {
  const now = opts.now ?? new Date();
  const limit = opts.limit ?? 50;
  const [urgent, active, mailboxes, purchases] = await Promise.all([
    prisma.returnCase.findMany({
      where: {
        OR: [
          { status: "SENT", followUpAt: { lte: now } },
          { status: "RESOLVED", outcome: "REFUND", refundReceivedAt: null, resolvedAt: { gte: new Date(now.getTime() - REFUND_WATCH_DAYS * DAY) } },
        ],
      },
      select: { userId: true },
      take: 2000,
    }),
    prisma.trackedOrder.findMany({ where: { status: { in: ["ORDERED", "SHIPPED"] }, dismissedAt: null }, select: { userId: true }, take: 2000 }),
    prisma.integrationConnection.findMany({ where: { provider: { in: [...MAIL_PROVIDERS] }, status: "ACTIVE" }, select: { userId: true }, take: 2000 }),
    prisma.purchaseOrder.findMany({ where: { status: "PLACED", createdAt: { gte: new Date(now.getTime() - 7 * DAY) } }, select: { userId: true }, take: 2000 }),
  ]);
  const users = pickReturnUsers(
    urgent.map((row) => row.userId),
    [...active, ...purchases, ...mailboxes].map((row) => row.userId),
    limit,
    now,
  );

  const result = { users: users.length, imported: 0, fromMail: 0, replies: 0, late: 0, followUps: 0, refunds: 0, errors: 0 };
  for (const userId of users) {
    try {
      const run = await refreshReturns(userId, now);
      result.imported += run.imported;
      result.fromMail += run.fromMail;
      result.replies += run.replies;
      result.late += run.late;
      result.followUps += run.followUps;
      result.refunds += run.refunds;
    } catch (error) {
      result.errors += 1;
      log.error("returns.refresh_failed", { userId, error });
    }
  }
  return result;
}
