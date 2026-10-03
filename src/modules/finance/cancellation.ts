import "server-only";
import { prisma } from "@/lib/db";
import { Errors } from "@/lib/errors";
import { CADENCE_LABEL, money, shortDate } from "@/lib/format";
import { isUuid } from "@/lib/validation";
import { proposeAction, toApprovalCard } from "@/modules/actions/actions.service";
import type { ApprovalCard } from "@/types/cards";

/**
 * Prepara la baja de una suscripción como propuesta pendiente de aprobación (nunca cancela directo).
 * Si ya hay una propuesta pendiente para ese cargo, la reutiliza.
 */
export async function proposeSubscriptionCancellation(
  userId: string,
  recurringChargeId: string,
  opts: { reason: string; conversationId?: string | null; timeZone?: string },
): Promise<{ card: ApprovalCard | null; alreadyRequested: boolean; merchant: string }> {
  if (!isUuid(recurringChargeId)) throw Errors.badRequest("Ese id de suscripción no es válido.");
  const charge = await prisma.recurringCharge.findFirst({ where: { id: recurringChargeId, userId } });
  if (!charge) throw Errors.notFound("La suscripción");
  if (charge.status === "CANCELLATION_REQUESTED" || charge.status === "CANCELED") {
    return { card: null, alreadyRequested: true, merchant: charge.merchantName };
  }

  const pending = await prisma.agentAction.findFirst({
    where: {
      userId,
      type: "CANCEL_SUBSCRIPTION",
      status: "PENDING",
      payload: { path: ["recurringChargeId"], equals: charge.id },
    },
  });
  if (pending) return { card: toApprovalCard(pending), alreadyRequested: false, merchant: charge.merchantName };

  const amount = Number(charge.amount);
  const card = await proposeAction({
    userId,
    conversationId: opts.conversationId ?? null,
    module: "FINANCE",
    type: "CANCEL_SUBSCRIPTION",
    title: charge.merchantName,
    summary: opts.reason,
    merchant: charge.merchantName,
    amount,
    currency: charge.currency,
    lines: [
      { label: "Cobro", value: `${money(amount, charge.currency, { cents: true })} por ${CADENCE_LABEL[charge.cadence]}` },
      ...(charge.nextExpectedAt ? [{ label: "Próximo cobro", value: shortDate(charge.nextExpectedAt, opts.timeZone) }] : []),
    ],
    payload: { recurringChargeId: charge.id, cadence: charge.cadence },
  });
  return { card, alreadyRequested: false, merchant: charge.merchantName };
}
