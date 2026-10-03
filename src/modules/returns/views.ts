// Filas de la base de datos → modelos de vista de pedidos y devoluciones (sin consultas: funciones puras).
import type { ReturnCase, TrackedOrder } from "@/generated/prisma/client";
import { localParts } from "@/modules/procedures/time/tz";
import type {
  ApprovalCard,
  ReturnCaseView,
  ReturnOutcomeId,
  ReturnEventKind,
  ReturnEventView,
  ReturnsStatsView,
  TrackedOrderView,
} from "@/types/cards";
import { findMerchantByDomain, findMerchantByName, isSandboxDomain, type MerchantInfo } from "./merchants";
import { caseSummary, escalationSteps } from "./rules/claim";
import { deliveryState } from "./rules/delivery";

const num = (value: { toString(): string } | number | null | undefined) => (value === null || value === undefined ? null : Number(value));

export const OPEN_CASE_STATUSES = ["DRAFT", "SENT", "ANSWERED"] as const;

export type StoredEvent = { at: string; kind: ReturnEventKind; text: string; ref?: string | null; reply?: string | null };

export function readEvents(value: unknown): StoredEvent[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (e): e is StoredEvent => typeof e === "object" && e !== null && typeof (e as StoredEvent).at === "string" && typeof (e as StoredEvent).text === "string",
  );
}

export type OrderMeta = {
  /** Correos de los que salió o que lo actualizaron (ids de mail_messages). */
  messageIds?: string[];
  /** Última fecha que dio la paquetería o la tienda (ISO), si cambió la prometida. */
  latestEstimate?: string | null;
  /** Entrega simulada de una compra de prueba hecha con OmniAgent. */
  simulatedDelivery?: boolean;
};

export function readOrderMeta(value: unknown): OrderMeta {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as OrderMeta) : {};
}

export function merchantOf(order: Pick<TrackedOrder, "merchant" | "merchantDomain">): MerchantInfo | null {
  return findMerchantByDomain(order.merchantDomain) ?? findMerchantByName(order.merchant);
}

export function isSandboxOrder(order: Pick<TrackedOrder, "merchantDomain" | "source">): boolean {
  return order.source === "EXAMPLE" || isSandboxDomain(order.merchantDomain);
}

export function caseView(row: ReturnCase, order: TrackedOrder, approval: ApprovalCard | null, timeZone: string): ReturnCaseView {
  const merchant = merchantOf(order);
  const events = readEvents(row.events);
  const escalated = events.some((e) => e.kind === "escalated");
  const lastReply = [...events].reverse().find((e) => e.kind === "reply");
  const needsEscalation = row.status === "REJECTED" || (escalated && (row.status === "SENT" || row.status === "ANSWERED"));
  return {
    id: row.id,
    orderId: row.orderId,
    merchant: order.merchant,
    orderTitle: order.title,
    orderNumber: order.orderNumber,
    reason: row.reason,
    status: row.status,
    channel: row.channel,
    desired: row.desired,
    details: row.details,
    subject: row.subject,
    body: row.body,
    sendTo: row.sendTo,
    approval,
    sentAt: row.sentAt?.toISOString() ?? null,
    followUps: row.followUps,
    followUpAt: row.followUpAt?.toISOString() ?? null,
    repliedAt: row.repliedAt?.toISOString() ?? null,
    nextStep: row.nextStep,
    nextStepBy: row.nextStepBy?.toISOString() ?? null,
    awaiting: row.status === "ANSWERED" ? (lastReply?.reply === "needs_info" ? "info" : "package") : null,
    outcome: row.outcome,
    amount: num(row.amount),
    refundAmount: num(row.refundAmount),
    currency: row.currency,
    refundReceivedAt: row.refundReceivedAt?.toISOString() ?? null,
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
    howToClaim: row.channel === "MANUAL" ? (merchant?.howToClaim ?? null) : null,
    escalation: needsEscalation ? escalationSteps(merchant) : [],
    escalated,
    disputeSummary: needsEscalation
      ? caseSummary({
          merchant: order.merchant,
          orderNumber: order.orderNumber,
          title: order.title,
          orderedAt: order.orderedAt,
          total: num(order.total),
          currency: order.currency,
          reason: row.reason,
          sentAt: row.sentAt,
          followUps: row.followUps,
          timeZone,
        })
      : null,
    sandbox: isSandboxOrder(order),
    events: events.map(({ at, kind, text }): ReturnEventView => ({ at, kind, text })),
    createdAt: row.createdAt.toISOString(),
  };
}

export function trackedOrderView(
  row: TrackedOrder,
  openCase: ReturnCaseView | null,
  closedCases: number,
  now: Date,
  timeZone: string,
  lastOutcome: ReturnOutcomeId | null = null,
): TrackedOrderView {
  const state = deliveryState(
    { status: row.status, expectedBy: row.expectedBy, deliveredAt: row.deliveredAt, returnWindowDays: row.returnWindowDays },
    now,
    timeZone,
  );
  const meta = readOrderMeta(row.meta);
  return {
    id: row.id,
    source: row.source,
    sandbox: isSandboxOrder(row),
    merchant: row.merchant,
    title: row.title,
    orderNumber: row.orderNumber,
    total: num(row.total),
    currency: row.currency,
    status: row.status,
    orderedAt: row.orderedAt.toISOString(),
    expectedBy: row.expectedBy?.toISOString() ?? null,
    latestEstimate: meta.latestEstimate ?? null,
    deliveredAt: row.deliveredAt?.toISOString() ?? null,
    carrier: row.carrier,
    trackingNumber: row.trackingNumber,
    delivery: state.kind,
    daysLate: state.daysLate,
    daysLeft: state.daysLeft,
    claimable: state.claimable && !openCase && !row.dismissedAt,
    likelyLost: state.likelyLost,
    returnBy: state.returnBy?.toISOString() ?? null,
    returnDaysLeft: state.returnDaysLeft,
    supportEmail: row.supportEmail,
    dismissed: row.dismissedAt !== null,
    openCase,
    closedCases,
    lastOutcome,
  };
}

/** Resultado del reclamo resuelto más reciente de un pedido (los casos vienen del más nuevo al más viejo). */
export function lastOutcomeOf(cases: Pick<ReturnCase, "status" | "outcome">[]): ReturnOutcomeId | null {
  return cases.find((c) => c.status === "RESOLVED" && c.outcome)?.outcome ?? null;
}

/** Plata recuperada: reembolsos y saldos a favor confirmados por la tienda, en la moneda del usuario. */
export function recoveredAmount(row: Pick<ReturnCase, "status" | "outcome" | "refundAmount" | "amount" | "currency">, currency: string): number {
  if (row.status !== "RESOLVED" || (row.outcome !== "REFUND" && row.outcome !== "STORE_CREDIT") || row.currency !== currency) return 0;
  return num(row.refundAmount) ?? num(row.amount) ?? 0;
}

export function returnsStats(
  orders: TrackedOrderView[],
  cases: Pick<ReturnCase, "status" | "outcome" | "refundAmount" | "amount" | "currency" | "resolvedAt">[],
  currency: string,
  now: Date,
  timeZone: string,
): ReturnsStatsView {
  const month = localParts(now, timeZone);
  const sameMonth = (date: Date | null) => {
    if (!date) return false;
    const p = localParts(date, timeZone);
    return p.year === month.year && p.month === month.month;
  };
  let recoveredThisMonth = 0;
  let recoveredTotal = 0;
  for (const row of cases) {
    const amount = recoveredAmount(row, currency);
    recoveredTotal += amount;
    if (sameMonth(row.resolvedAt)) recoveredThisMonth += amount;
  }
  const active = orders.filter((o) => !o.dismissed);
  return {
    currency,
    onTheWay: active.filter((o) => o.status === "ORDERED" || o.status === "SHIPPED").length,
    late: active.filter((o) => o.delivery === "late").length,
    openCases: cases.filter((c) => (OPEN_CASE_STATUSES as readonly string[]).includes(c.status)).length,
    recoveredThisMonth: Math.round(recoveredThisMonth * 100) / 100,
    recoveredTotal: Math.round(recoveredTotal * 100) / 100,
  };
}
