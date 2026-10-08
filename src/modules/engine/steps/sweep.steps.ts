import "server-only";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { listJoin, plural } from "@/lib/format";
import { countPendingActions } from "@/modules/actions/actions.service";
import { runPriceChecks } from "@/modules/concierge/checker";
import { countActiveTracking } from "@/modules/concierge/tracking.service";
import { syncAllMailboxes } from "@/modules/procedures/mail/mail.service";
import { MAIL_PROVIDERS } from "@/modules/procedures/mail/mailbox";
import { procedureCounts } from "@/modules/procedures/plan";
import { refreshReturns } from "@/modules/returns/returns.service";
import { defineStep, done, skip } from "../engine.types";
import { syncAccounts } from "./finance.steps";

// Pasos de "poner todo al día": correo, precios y pedidos (el banco es el mismo paso de finanzas) y un resumen final.
// Cada módulo usa sus propias reglas: los límites del plan se respetan (por ejemplo, los precios solo se revisan
// cuando ya les toca según el plan).

/** Revisa las bandejas conectadas y sugiere los trámites que encuentre. */
export const syncMail = defineStep({
  key: "procedures.mail",
  title: "Revisar tu correo",
  module: "PROCEDURES",
  output: z.object({ mailboxes: z.number().int(), created: z.number().int(), suggested: z.number().int() }),
  timeoutMs: 45_000,
  maxAttempts: 2,
  optional: true,
  async run({ userId }) {
    const connected = await prisma.integrationConnection.count({ where: { userId, provider: { in: [...MAIL_PROVIDERS] }, status: "ACTIVE" } });
    if (connected === 0) return skip("No tienes correo conectado.");
    const totals = await syncAllMailboxes(userId);
    if (totals.mailboxes === 0) throw new AppError(503, "mail_unavailable", "No pude entrar a tu correo.");
    const note =
      totals.created === 0
        ? "Sin correos nuevos."
        : `${plural(totals.created, "correo nuevo", "correos nuevos")}, ${plural(totals.suggested, "trámite sugerido", "trámites sugeridos")}.`;
    return done({ mailboxes: totals.mailboxes, created: totals.created, suggested: totals.suggested }, note);
  },
});

/** Revisa los precios que vigilas y que ya toca revisar según el plan. */
export const checkPrices = defineStep({
  key: "concierge.prices",
  title: "Revisar tus precios",
  module: "CONCIERGE",
  output: z.object({ due: z.number().int(), checked: z.number().int(), alerts: z.number().int() }),
  timeoutMs: 40_000,
  maxAttempts: 1,
  optional: true,
  async run({ userId, now }) {
    const watching = await countActiveTracking(userId);
    if (watching === 0) return skip("Todavía no vigilas precios.");
    const summary = await runPriceChecks({ userId, now, limit: 20, budgetMs: 30_000 });
    if (summary.due === 0) return skip(`${plural(watching, "precio vigilado", "precios vigilados")}: ninguno toca revisar todavía.`);
    const checked = plural(summary.checked, "precio revisado", "precios revisados");
    const note = summary.alerts > 0 ? `${checked}; ${plural(summary.alerts, "bajó de verdad", "bajaron de verdad")}.` : `${checked}, sin bajadas.`;
    return done({ due: summary.due, checked: summary.checked, alerts: summary.alerts }, note);
  },
});

/** Pedidos en camino, retrasos, respuestas de las tiendas y reembolsos. */
export const refreshOrders = defineStep({
  key: "returns.orders",
  title: "Revisar tus pedidos",
  module: "CONCIERGE",
  output: z.object({ imported: z.number().int(), late: z.number().int(), replies: z.number().int(), refunds: z.number().int() }),
  timeoutMs: 40_000,
  maxAttempts: 2,
  optional: true,
  async run({ userId, now }) {
    const result = await refreshReturns(userId, now);
    const parts = [
      result.imported + result.fromMail > 0 ? plural(result.imported + result.fromMail, "pedido nuevo", "pedidos nuevos") : null,
      result.late > 0 ? plural(result.late, "atrasado con el reclamo listo", "atrasados con el reclamo listo") : null,
      result.replies > 0 ? plural(result.replies, "respuesta de tienda", "respuestas de tiendas") : null,
      result.refunds > 0 ? plural(result.refunds, "reembolso confirmado", "reembolsos confirmados") : null,
    ].filter((part): part is string => part !== null);
    return done(
      { imported: result.imported + result.fromMail, late: result.late, replies: result.replies, refunds: result.refunds },
      parts.length ? `${listJoin(parts)}.` : "Sin novedades en tus pedidos.",
    );
  },
});

/** Lo que quedó para la persona después de ponerse al día. */
export const summarizeDay = defineStep({
  key: "summary.today",
  title: "Resumirte lo nuevo",
  module: "GENERAL",
  output: z.object({ lines: z.array(z.string()), approvals: z.number().int(), procedures: z.number().int() }),
  timeoutMs: 15_000,
  maxAttempts: 2,
  async run(ctx) {
    const [approvals, procedures] = await Promise.all([countPendingActions(ctx.userId), procedureCounts(ctx.userId)]);
    const bank = ctx.outputOf(syncAccounts);
    const mail = ctx.outputOf(syncMail);
    const prices = ctx.outputOf(checkPrices);
    const orders = ctx.outputOf(refreshOrders);
    const lines = [
      approvals > 0 ? plural(approvals, "cosa espera tu aprobación", "cosas esperan tu aprobación") : null,
      mail && mail.suggested > 0 ? plural(mail.suggested, "trámite nuevo en tu correo", "trámites nuevos en tu correo") : null,
      procedures.due > 0 ? plural(procedures.due, "trámite vence pronto", "trámites vencen pronto") : null,
      prices && prices.alerts > 0 ? plural(prices.alerts, "precio bajó", "precios bajaron") : null,
      orders && orders.late > 0 ? plural(orders.late, "pedido va atrasado", "pedidos van atrasados") : null,
      bank && bank.added > 0 ? plural(bank.added, "movimiento nuevo en tus cuentas", "movimientos nuevos en tus cuentas") : null,
    ].filter((line): line is string => line !== null);
    const note = lines.length ? `${listJoin(lines)}.` : "Nada nuevo: todo está en orden.";
    return done({ lines, approvals, procedures: procedures.suggested + procedures.due }, note);
  },
});
