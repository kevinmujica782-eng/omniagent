import "server-only";
import type { AgentAction, Prisma, ReturnCase, TrackedOrder } from "@/generated/prisma/client";
import type { ReturnOutcome, ShipmentStatus } from "@/generated/prisma/enums";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { Errors } from "@/lib/errors";
import { money, shortDate } from "@/lib/format";
import { defaultDesired, desiredOptions, OUTCOME_LABEL, REASON_LABEL } from "@/lib/returns-copy";
import { isUuid } from "@/lib/validation";
import { proposeAction, toApprovalCard } from "@/modules/actions/actions.service";
import { MAIL_PROVIDERS } from "@/modules/procedures/mail/mailbox";
import { longDate } from "@/modules/procedures/time/es-dates";
import { atLocalTime, parseLocalDateTime, safeTimeZone } from "@/modules/procedures/time/tz";
import type {
  ApprovalCard,
  ReturnCaseView,
  ReturnEventKind,
  ReturnOutcomeId,
  ReturnReasonId,
  ReturnsOverviewView,
  TrackedOrderView,
} from "@/types/cards";
import { domainOf, findMerchantByName, foldName, isSandboxDomain } from "./merchants";
import { cleanDetails, draftClaim, draftFollowUp } from "./rules/claim";
import { addBusinessDays, deliveryState, endOfLocalDay, MAX_FOLLOW_UPS, nextFollowUpAt, REFUND_WATCH_DAYS } from "./rules/delivery";
import { readOrderMail, type OrderSignal } from "./rules/mail-orders";
import { matchRefund } from "./rules/refund-match";
import { readStoreReply, type ReplyKind, type ReplyReading } from "./rules/reply";
import { exampleOrders, sandboxStoreReply } from "./sandbox";
import {
  caseView,
  isSandboxOrder,
  lastOutcomeOf,
  OPEN_CASE_STATUSES,
  readEvents,
  readOrderMeta,
  returnsStats,
  trackedOrderView,
  type OrderMeta,
  type StoredEvent,
} from "./views";

// Pedidos y devoluciones. Omni sigue los pedidos (comprados con OmniAgent, detectados en el correo o agregados a
// mano), detecta retrasos, prepara el reclamo y, si la tienda atiende por correo, lo PROPONE para enviarlo desde
// la bandeja del usuario: nada sale sin que el usuario pulse Aprobar. Después lee las respuestas de la tienda,
// insiste si no contesta (cada seguimiento también se aprueba), sugiere cómo escalar y confirma el reembolso con
// los movimientos de Finanzas. Todo es idempotente: refreshReturns se puede llamar al abrir la pantalla y desde el cron.

const DAY = 86_400_000;
/** Correos que se revisan hacia atrás la primera vez. */
const MAIL_LOOKBACK_DAYS = 45;
/** Hasta dónde se buscan pedidos para unir correos del mismo pedido. */
const ORDER_LOOKBACK_DAYS = 120;
/** Espera antes de preguntar por el reembolso tras devolver el paquete (días hábiles). */
const AFTER_PACKAGE_BUSINESS_DAYS = 5;

type Ctx = { userId: string; timeZone: string; currency: string; name: string | null };
type CaseWithOrder = ReturnCase & { order: TrackedOrder };

async function userCtx(userId: string): Promise<Ctx> {
  const profile = await prisma.profile.findUnique({ where: { id: userId }, select: { timezone: true, currency: true, fullName: true } });
  return {
    userId,
    timeZone: safeTimeZone(profile?.timezone),
    currency: profile?.currency ?? "USD",
    name: profile?.fullName?.trim() || null,
  };
}

const num = (value: { toString(): string } | number | null | undefined) => (value === null || value === undefined ? null : Number(value));
const isUniqueViolation = (error: unknown) => (error as { code?: string } | null)?.code === "P2002";

function event(at: Date, kind: ReturnEventKind, text: string, ref: string | null = null, reply: ReplyKind | null = null): StoredEvent {
  return { at: at.toISOString(), kind, text, ref, ...(reply ? { reply } : {}) };
}

function withEvents(current: unknown, ...added: StoredEvent[]): Prisma.InputJsonValue {
  return [...readEvents(current), ...added].slice(-40) as unknown as Prisma.InputJsonValue;
}

function metaJson(meta: OrderMeta): Prisma.InputJsonValue {
  return meta as unknown as Prisma.InputJsonValue;
}

/**
 * Un pedido que nunca llegó y cuyo reclamo terminó en reembolso o saldo a favor ya no se espera: queda cancelado y sale
 * de "En camino" y de los retrasos. Si la tienda manda uno nuevo, se vuelve a esperar con la fecha nueva (o sin fecha).
 */
async function settleUndeliveredOrder(order: TrackedOrder, outcome: ReturnOutcome, newExpectedBy: Date | null = null): Promise<void> {
  if (order.status !== "ORDERED" && order.status !== "SHIPPED") return;
  if (outcome === "REFUND" || outcome === "STORE_CREDIT") {
    await prisma.trackedOrder.updateMany({ where: { id: order.id, status: { in: ["ORDERED", "SHIPPED"] } }, data: { status: "CANCELED" } });
  } else if (outcome === "REPLACEMENT") {
    const meta: OrderMeta = { ...readOrderMeta(order.meta) };
    delete meta.latestEstimate;
    await prisma.trackedOrder.update({ where: { id: order.id }, data: { expectedBy: newExpectedBy, meta: metaJson(meta) } });
  }
}

async function activeMailbox(userId: string) {
  return prisma.integrationConnection.findFirst({
    where: { userId, provider: { in: [...MAIL_PROVIDERS] }, status: "ACTIVE" },
    orderBy: { createdAt: "asc" },
    select: { id: true, metadata: true },
  });
}

async function ownOrder(userId: string, orderId: string): Promise<TrackedOrder> {
  if (!isUuid(orderId)) throw Errors.notFound("El pedido");
  const order = await prisma.trackedOrder.findFirst({ where: { id: orderId, userId } });
  if (!order) throw Errors.notFound("El pedido");
  return order;
}

async function ownCase(userId: string, caseId: string): Promise<CaseWithOrder> {
  if (!isUuid(caseId)) throw Errors.notFound("El reclamo");
  const row = await prisma.returnCase.findFirst({ where: { id: caseId, userId }, include: { order: true } });
  if (!row) throw Errors.notFound("El reclamo");
  return row;
}

/** Vence una propuesta pendiente que ya no hace falta (la tienda respondió, se cerró el caso, se envió a mano). */
async function expirePendingAction(actionId: string | null, reason: string) {
  if (!actionId) return;
  await prisma.agentAction.updateMany({ where: { id: actionId, status: "PENDING" }, data: { status: "EXPIRED", errorMessage: reason } });
}

async function notify(userId: string, n: { type: "REMINDER" | "SYSTEM" | "ACTION_REQUIRED"; title: string; body: string; href: string; data?: Record<string, string> }) {
  await prisma.appNotification.create({
    data: { userId, type: n.type, title: n.title, body: n.body, href: n.href, data: (n.data ?? {}) as Prisma.InputJsonValue },
  });
}

// ───────────────────────── Vistas ─────────────────────────

async function caseViewOf(row: ReturnCase & { order: TrackedOrder; action?: AgentAction | null }, timeZone: string): Promise<ReturnCaseView> {
  const action = row.action !== undefined ? row.action : row.actionId ? await prisma.agentAction.findUnique({ where: { id: row.actionId } }) : null;
  return caseView(row, row.order, action ? toApprovalCard(action) : null, timeZone);
}

export async function getCaseView(userId: string, caseId: string): Promise<ReturnCaseView> {
  const ctx = await userCtx(userId);
  return caseViewOf(await ownCase(userId, caseId), ctx.timeZone);
}

export async function getOrderView(userId: string, orderId: string, now = new Date()): Promise<TrackedOrderView> {
  const ctx = await userCtx(userId);
  const order = await ownOrder(userId, orderId);
  const cases = await prisma.returnCase.findMany({ where: { orderId: order.id }, orderBy: { createdAt: "desc" }, include: { action: true } });
  const open = cases.find((c) => (OPEN_CASE_STATUSES as readonly string[]).includes(c.status)) ?? null;
  const openView = open ? caseView(open, order, open.action ? toApprovalCard(open.action) : null, ctx.timeZone) : null;
  return trackedOrderView(order, openView, cases.length - (open ? 1 : 0), now, ctx.timeZone, lastOutcomeOf(cases));
}

export type OrdersFilter = "all" | "active" | "late" | "problems" | "delivered";

/** Pedidos con su reclamo abierto (si hay), del más reciente al más antiguo. */
export async function listOrderViews(userId: string, filter: OrdersFilter = "all", now = new Date(), take = 50): Promise<TrackedOrderView[]> {
  const ctx = await userCtx(userId);
  const [orders, cases] = await Promise.all([
    prisma.trackedOrder.findMany({ where: { userId }, orderBy: { orderedAt: "desc" }, take: 100 }),
    prisma.returnCase.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 200, include: { action: true } }),
  ]);
  const views = orders.map((order) => {
    const own = cases.filter((c) => c.orderId === order.id);
    const open = own.find((c) => (OPEN_CASE_STATUSES as readonly string[]).includes(c.status)) ?? null;
    const openView = open ? caseView(open, order, open.action ? toApprovalCard(open.action) : null, ctx.timeZone) : null;
    return trackedOrderView(order, openView, own.length - (open ? 1 : 0), now, ctx.timeZone, lastOutcomeOf(own));
  });
  const filtered = views.filter((o) => {
    switch (filter) {
      case "active":
        return !o.dismissed && (o.status === "ORDERED" || o.status === "SHIPPED");
      case "late":
        return !o.dismissed && o.delivery === "late";
      case "problems":
        return o.openCase !== null || (!o.dismissed && o.delivery === "late");
      case "delivered":
        return o.delivery === "delivered";
      default:
        return true;
    }
  });
  return filtered.slice(0, take);
}

/** Pantalla de Devoluciones: primero pone al día pedidos, correos, seguimientos y reembolsos. */
export async function getReturnsOverview(userId: string, now = new Date()): Promise<ReturnsOverviewView> {
  await refreshReturns(userId, now);
  const ctx = await userCtx(userId);
  const [orders, cases, mailbox] = await Promise.all([
    listOrderViews(userId, "all", now, 100),
    prisma.returnCase.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 100, include: { order: true, action: true } }),
    activeMailbox(userId),
  ]);
  const address = (mailbox?.metadata as { address?: string } | null)?.address ?? null;
  return {
    orders,
    cases: cases.map((c) => caseView(c, c.order, c.action ? toApprovalCard(c.action) : null, ctx.timeZone)),
    stats: returnsStats(orders, cases, ctx.currency, now, ctx.timeZone),
    mailbox: { connected: Boolean(mailbox), address },
  };
}

// ───────────────────────── Poner al día ─────────────────────────

export interface RefreshResult {
  imported: number;
  fromMail: number;
  updated: number;
  replies: number;
  late: number;
  followUps: number;
  refunds: number;
}

/** Pedidos nuevos, correos de tiendas, entregas simuladas, retrasos, seguimientos y reembolsos. Idempotente. */
export async function refreshReturns(userId: string, now = new Date()): Promise<RefreshResult> {
  const ctx = await userCtx(userId);
  const result: RefreshResult = { imported: 0, fromMail: 0, updated: 0, replies: 0, late: 0, followUps: 0, refunds: 0 };
  result.imported = await importOmniOrders(ctx, now);
  const mail = await scanMail(ctx, now);
  result.fromMail = mail.created;
  result.updated = mail.updated;
  result.replies = mail.replies;
  await settleSandboxDeliveries(ctx, now);
  result.late = await handleLateOrders(ctx, now);
  result.followUps = await runFollowUps(ctx, now);
  result.refunds = await matchRefunds(ctx, now);
  return result;
}

/** Compras hechas con la hoja de pago de OmniAgent que se envían a domicilio. */
async function importOmniOrders(ctx: Ctx, now: Date): Promise<number> {
  const orders = await prisma.purchaseOrder.findMany({
    where: { userId: ctx.userId, status: "PLACED", kind: { in: ["PRODUCT", "OTHER"] }, createdAt: { gte: new Date(now.getTime() - ORDER_LOOKBACK_DAYS * DAY) } },
    orderBy: { createdAt: "asc" },
    take: 100,
  });
  if (orders.length === 0) return 0;
  const known = new Set(
    (await prisma.trackedOrder.findMany({ where: { userId: ctx.userId, purchaseOrderId: { in: orders.map((o) => o.id) } }, select: { purchaseOrderId: true } })).map(
      (t) => t.purchaseOrderId,
    ),
  );
  let created = 0;
  for (const po of orders) {
    if (known.has(po.id)) continue;
    const eta = (po.details as { delivery?: { eta?: string | null } | null } | null)?.delivery?.eta ?? null;
    const etaDate = eta ? new Date(eta) : null;
    const merchant = findMerchantByName(po.merchant);
    try {
      await prisma.trackedOrder.create({
        data: {
          userId: ctx.userId,
          source: "OMNIAGENT",
          sourceKey: `omni:${po.id}`,
          purchaseOrderId: po.id,
          merchant: po.merchant ?? "Tienda",
          merchantDomain: merchant?.domains[0] ?? null,
          supportEmail: merchant?.supportEmail ?? null,
          orderNumber: po.orderNumber,
          title: po.title,
          total: po.total,
          currency: po.currency,
          status: "ORDERED",
          orderedAt: po.createdAt,
          expectedBy: etaDate && !Number.isNaN(etaDate.getTime()) ? endOfLocalDay(etaDate, ctx.timeZone) : null,
          returnWindowDays: merchant?.returnWindowDays ?? null,
        },
      });
      created++;
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
    }
  }
  return created;
}

type Prefs = Record<string, unknown> & { returns?: { mailCursor?: string } };

/** Correos nuevos de la bandeja: pedidos (confirmados, en camino, entregados, cancelados) y respuestas a reclamos. */
async function scanMail(ctx: Ctx, now: Date): Promise<{ created: number; updated: number; replies: number }> {
  const counts = { created: 0, updated: 0, replies: 0 };
  const profile = await prisma.profile.findUnique({ where: { id: ctx.userId }, select: { preferences: true } });
  const cursorIso = ((profile?.preferences ?? {}) as Prefs).returns?.mailCursor ?? null;
  const cursor = cursorIso ? new Date(cursorIso) : null;
  const messages = await prisma.mailMessage.findMany({
    where: {
      userId: ctx.userId,
      folder: "inbox",
      receivedAt: { gte: new Date(now.getTime() - MAIL_LOOKBACK_DAYS * DAY) },
      ...(cursor && !Number.isNaN(cursor.getTime()) ? { createdAt: { gt: cursor } } : {}),
    },
    orderBy: { createdAt: "asc" },
    take: 200,
    select: { id: true, subject: true, fromName: true, fromEmail: true, bodyText: true, receivedAt: true, labels: true, createdAt: true },
  });
  if (messages.length === 0) return counts;

  for (const message of messages) {
    const signal = readOrderMail(message, ctx.timeZone);
    if (signal) {
      const applied = await applyOrderSignal(ctx, signal, message, now);
      if (applied.created) counts.created++;
      if (applied.updated) counts.updated++;
    }
    const target = await findCaseForMessage(ctx.userId, message);
    if (target) {
      const reading = readStoreReply(
        {
          subject: message.subject,
          bodyText: message.bodyText,
          receivedAt: message.receivedAt,
          merchant: target.order.merchant,
          currency: target.currency,
          expectedAmount: num(target.amount) ?? num(target.order.total),
        },
        ctx.timeZone,
      );
      if (await applyReply(ctx, target, reading, { messageId: message.id, at: message.receivedAt, now })) counts.replies++;
    }
  }

  // Se relee justo antes de guardar para no pisar otros cambios en las preferencias.
  const fresh = await prisma.profile.findUnique({ where: { id: ctx.userId }, select: { preferences: true } });
  const prefs = { ...((fresh?.preferences ?? {}) as Prefs) };
  prefs.returns = { ...(prefs.returns ?? {}), mailCursor: messages[messages.length - 1].createdAt.toISOString() };
  await prisma.profile.update({ where: { id: ctx.userId }, data: { preferences: prefs as unknown as Prisma.InputJsonValue } });
  return counts;
}

/** Reclamo abierto al que responde este correo: misma tienda, después del envío (y su número de pedido, si hay varios). */
async function findCaseForMessage(
  userId: string,
  message: { fromEmail: string; subject: string; bodyText: string; receivedAt: Date },
): Promise<CaseWithOrder | null> {
  const domain = domainOf(message.fromEmail);
  if (!domain) return null;
  const open = await prisma.returnCase.findMany({
    where: { userId, status: { in: ["SENT", "ANSWERED"] }, sentAt: { not: null } },
    include: { order: true },
    orderBy: { sentAt: "desc" },
  });
  const candidates = open.filter(
    (c) => c.sentAt && message.receivedAt > c.sentAt && (c.order.merchantDomain === domain || domainOf(c.sendTo) === domain),
  );
  if (candidates.length === 0) return null;
  const text = `${message.subject}\n${message.bodyText}`.toUpperCase();
  return candidates.find((c) => c.order.orderNumber && text.includes(c.order.orderNumber.toUpperCase())) ?? candidates[0];
}

const STATUS_RANK: Record<ShipmentStatus, number> = { ORDERED: 0, SHIPPED: 1, DELIVERED: 2, CANCELED: 3 };

function statusOf(kind: OrderSignal["kind"]): ShipmentStatus {
  return kind === "delivered" ? "DELIVERED" : kind === "shipped" ? "SHIPPED" : kind === "canceled" ? "CANCELED" : "ORDERED";
}

async function applyOrderSignal(
  ctx: Ctx,
  signal: OrderSignal,
  message: { id: string; receivedAt: Date },
  now: Date,
): Promise<{ orderId: string | null; created: boolean; updated: boolean }> {
  const since = new Date(now.getTime() - ORDER_LOOKBACK_DAYS * DAY);
  const numbers = [
    ...(signal.orderNumber ? [{ orderNumber: signal.orderNumber }] : []),
    ...(signal.trackingNumber ? [{ trackingNumber: signal.trackingNumber }] : []),
  ];
  const candidates = numbers.length
    ? await prisma.trackedOrder.findMany({ where: { userId: ctx.userId, orderedAt: { gte: since }, OR: numbers }, orderBy: { orderedAt: "desc" } })
    : [];
  // La guía identifica el envío; el número de pedido, solo si es de la misma tienda (varias tiendas usan "#1001").
  const existing =
    candidates.find((o) => signal.trackingNumber && o.trackingNumber === signal.trackingNumber) ??
    candidates.find(
      (o) =>
        signal.orderNumber &&
        o.orderNumber === signal.orderNumber &&
        (!signal.merchantDomain || !o.merchantDomain || o.merchantDomain === signal.merchantDomain),
    ) ??
    null;

  const status = statusOf(signal.kind);
  if (!existing) {
    // Un aviso de cancelación de un pedido que nunca seguimos no se agrega.
    if (signal.kind === "canceled") return { orderId: null, created: false, updated: false };
    const number = signal.orderNumber ?? signal.trackingNumber;
    const merchant = findMerchantByName(signal.merchant);
    try {
      const order = await prisma.trackedOrder.create({
        data: {
          userId: ctx.userId,
          source: "EMAIL",
          sourceKey: number ? `mail:${signal.merchantDomain ?? foldName(signal.carrier ?? "paqueteria").replace(/\s+/g, "")}:${number}` : `mail:${message.id}`,
          merchant: signal.merchant.slice(0, 80),
          merchantDomain: signal.merchantDomain ?? merchant?.domains[0] ?? null,
          supportEmail: signal.supportEmail ?? merchant?.supportEmail ?? null,
          orderNumber: signal.orderNumber,
          title: (signal.title ?? (signal.orderNumber ? `Pedido ${signal.orderNumber}` : `Pedido de ${signal.merchant}`)).slice(0, 160),
          total: signal.total,
          currency: ctx.currency,
          status,
          orderedAt: message.receivedAt,
          expectedBy: signal.expectedBy,
          deliveredAt: status === "DELIVERED" ? (signal.deliveredAt ?? message.receivedAt) : null,
          returnWindowDays: signal.returnWindowDays ?? merchant?.returnWindowDays ?? null,
          carrier: signal.carrier,
          trackingNumber: signal.trackingNumber,
          meta: metaJson({ messageIds: [message.id] }),
        },
      });
      await audit({ userId: ctx.userId, actor: "agent", action: "order.detected", entity: "tracked_order", entityId: order.id, metadata: { kind: signal.kind } });
      return { orderId: order.id, created: true, updated: false };
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      return { orderId: null, created: false, updated: false };
    }
  }

  const meta = readOrderMeta(existing.meta);
  if (meta.messageIds?.includes(message.id)) return { orderId: existing.id, created: false, updated: false };
  const advance =
    status === "CANCELED"
      ? existing.status === "ORDERED" || existing.status === "SHIPPED"
      : existing.status !== "CANCELED" && STATUS_RANK[status] > STATUS_RANK[existing.status];
  const deliveredAt = advance && status === "DELIVERED" ? (signal.deliveredAt ?? message.receivedAt) : null;
  const newEstimate =
    existing.expectedBy && signal.expectedBy && signal.expectedBy.getTime() !== existing.expectedBy.getTime() ? signal.expectedBy.toISOString() : null;
  const genericTitle = /^Pedido (de |[A-Z0-9#-]+$)/.test(existing.title);
  // Un pedido que solo conocíamos por la paquetería toma los datos de la tienda cuando llega su correo.
  const adoptStore = !existing.merchantDomain && Boolean(signal.merchantDomain) && !signal.fromCarrier;
  await prisma.trackedOrder.update({
    where: { id: existing.id },
    data: {
      ...(advance ? { status } : {}),
      ...(deliveredAt ? { deliveredAt } : {}),
      ...(!existing.expectedBy && signal.expectedBy ? { expectedBy: signal.expectedBy } : {}),
      ...(!existing.orderNumber && signal.orderNumber ? { orderNumber: signal.orderNumber } : {}),
      ...(!existing.trackingNumber && signal.trackingNumber ? { trackingNumber: signal.trackingNumber } : {}),
      ...(!existing.carrier && signal.carrier ? { carrier: signal.carrier } : {}),
      ...(genericTitle && signal.title ? { title: signal.title.slice(0, 160) } : {}),
      ...(existing.total === null && signal.total !== null ? { total: signal.total } : {}),
      ...(!existing.supportEmail && signal.supportEmail ? { supportEmail: signal.supportEmail } : {}),
      ...(existing.returnWindowDays === null && signal.returnWindowDays !== null ? { returnWindowDays: signal.returnWindowDays } : {}),
      ...(adoptStore ? { merchant: signal.merchant.slice(0, 80), merchantDomain: signal.merchantDomain } : {}),
      meta: metaJson({
        ...meta,
        ...(newEstimate ? { latestEstimate: newEstimate } : {}),
        messageIds: [...(meta.messageIds ?? []), message.id].slice(-20),
      }),
    },
  });
  if (deliveredAt) await resolveArrived(ctx, existing, deliveredAt);
  if (advance && status === "CANCELED") await resolveCanceled(ctx, existing);
  return { orderId: existing.id, created: false, updated: true };
}

/** Llegó el pedido: los reclamos por retraso quedan resueltos. */
async function resolveArrived(ctx: Ctx, order: TrackedOrder, deliveredAt: Date) {
  const open = await prisma.returnCase.findMany({
    where: { orderId: order.id, status: { in: [...OPEN_CASE_STATUSES] }, reason: { in: ["LATE", "NOT_RECEIVED"] } },
  });
  for (const row of open) {
    const claimed = await prisma.returnCase.updateMany({
      where: { id: row.id, status: { in: [...OPEN_CASE_STATUSES] } },
      data: {
        status: "RESOLVED",
        outcome: "ARRIVED",
        resolvedAt: deliveredAt,
        followUpAt: null,
        nextStep: null,
        nextStepBy: null,
        events: withEvents(row.events, event(deliveredAt, "reply", `El pedido llegó el ${longDate(deliveredAt, ctx.timeZone)}: el reclamo queda resuelto.`)),
      },
    });
    if (claimed.count === 0) continue;
    await expirePendingAction(row.actionId, "El pedido ya llegó.");
    await notify(ctx.userId, {
      type: "SYSTEM",
      title: `Llegó tu pedido de ${order.merchant}`,
      body: `${order.title}. Cerré el reclamo por el retraso.`,
      href: `/devoluciones?caso=${row.id}`,
      data: { caseId: row.id },
    });
  }
}

/** La tienda canceló: si había un reclamo por retraso, pasa a pedir el reembolso. */
async function resolveCanceled(ctx: Ctx, order: TrackedOrder) {
  await notify(ctx.userId, {
    type: "SYSTEM",
    title: `${order.merchant} canceló tu pedido`,
    body: `${order.title}. Si ya lo pagaste, revisa que llegue el reembolso; si no llega, Omni prepara el reclamo.`,
    href: `/devoluciones?pedido=${order.id}`,
    data: { orderId: order.id },
  });
}

/** Compras de prueba hechas con OmniAgent: la tienda de prueba "entrega" el día prometido. */
async function settleSandboxDeliveries(ctx: Ctx, now: Date) {
  const due = await prisma.trackedOrder.findMany({
    where: { userId: ctx.userId, source: "OMNIAGENT", status: { in: ["ORDERED", "SHIPPED"] }, expectedBy: { lt: now } },
  });
  for (const order of due) {
    if (!isSandboxDomain(order.merchantDomain) || !order.expectedBy) continue;
    const afternoon = atLocalTime(order.expectedBy, 14, 0, ctx.timeZone);
    const deliveredAt = afternoon < now ? afternoon : now;
    const claimed = await prisma.trackedOrder.updateMany({
      where: { id: order.id, status: { in: ["ORDERED", "SHIPPED"] } },
      data: { status: "DELIVERED", deliveredAt, meta: metaJson({ ...readOrderMeta(order.meta), simulatedDelivery: true }) },
    });
    if (claimed.count > 0) await resolveArrived(ctx, order, deliveredAt);
  }
}

/**
 * Retrasos: cuando un pedido ya va CLAIM_AFTER_DAYS_LATE días tarde, Omni prepara el reclamo una sola vez (reclamo
 * atómico con late_notified_at). Si la tienda atiende por correo y hay bandeja, queda en Aprobaciones; si no, queda
 * listo para enviarlo a mano. Nunca se envía solo.
 */
async function handleLateOrders(ctx: Ctx, now: Date): Promise<number> {
  const candidates = await prisma.trackedOrder.findMany({
    where: {
      userId: ctx.userId,
      status: { in: ["ORDERED", "SHIPPED"] },
      dismissedAt: null,
      lateNotifiedAt: null,
      expectedBy: { lt: now },
      // Solo si nunca hubo reclamo: uno cerrado o resuelto ya lo decidió el usuario (o la tienda).
      cases: { none: {} },
    },
  });
  let handled = 0;
  for (const order of candidates) {
    const state = deliveryState(
      { status: order.status, expectedBy: order.expectedBy, deliveredAt: order.deliveredAt, returnWindowDays: order.returnWindowDays },
      now,
      ctx.timeZone,
    );
    if (!state.claimable) continue;
    const claimed = await prisma.trackedOrder.updateMany({ where: { id: order.id, lateNotifiedAt: null }, data: { lateNotifiedAt: now } });
    if (claimed.count === 0) continue;
    const reason: ReturnReasonId = state.likelyLost ? "NOT_RECEIVED" : "LATE";
    const prepared = await prepareCase(ctx, order, { reason, desired: defaultDesired(reason), details: null }, { now, auto: true });
    if (prepared.returnCase.channel === "MANUAL") {
      await notify(ctx.userId, {
        type: "REMINDER",
        title: `Tu pedido de ${order.merchant} va ${state.daysLate} días tarde`,
        body: `${order.title}. Te dejé el reclamo listo para enviarlo a la tienda.`,
        href: `/devoluciones?caso=${prepared.returnCase.id}`,
        data: { caseId: prepared.returnCase.id },
      });
    }
    handled++;
  }
  return handled;
}

/** Seguimientos que tocan: propone el correo (se aprueba), recuerda (canal manual) o sugiere escalar. */
async function runFollowUps(ctx: Ctx, now: Date): Promise<number> {
  const due = await prisma.returnCase.findMany({
    where: { userId: ctx.userId, status: "SENT", followUpAt: { lte: now } },
    include: { order: true },
  });
  let count = 0;
  for (const row of due) {
    // Solo una corrida toma cada seguimiento.
    const claimed = await prisma.returnCase.updateMany({ where: { id: row.id, status: "SENT", followUpAt: row.followUpAt }, data: { followUpAt: null } });
    if (claimed.count === 0) continue;
    count++;
    const who = row.order.merchant;
    if (row.followUps >= MAX_FOLLOW_UPS) {
      await prisma.returnCase.update({
        where: { id: row.id },
        data: { events: withEvents(row.events, event(now, "escalated", `${who} no respondió a ${row.followUps} seguimientos. Te dejé cómo escalarlo.`)) },
      });
      await notify(ctx.userId, {
        type: "ACTION_REQUIRED",
        title: `${who} no responde tu reclamo`,
        body: `${row.order.title}. Te dejé los pasos para pedir ayuda a la plataforma o a tu banco.`,
        href: `/devoluciones?caso=${row.id}`,
        data: { caseId: row.id },
      });
      continue;
    }
    if (row.channel === "EMAIL" && row.sendTo && (await activeMailbox(ctx.userId))) {
      const number = row.followUps + 1;
      const draft = draftFollowUp({
        merchant: who,
        orderNumber: row.order.orderNumber,
        title: row.order.title,
        reason: row.reason,
        userName: ctx.name,
        timeZone: ctx.timeZone,
        number,
        firstSentAt: row.sentAt ?? now,
        subject: row.subject,
      });
      const card = await proposeAction({
        userId: ctx.userId,
        module: "CONCIERGE",
        type: "SEND_EMAIL",
        title: draft.subject,
        summary: `Seguimiento n.º ${number} a ${who}: no ha respondido tu reclamo.`,
        merchant: who,
        lines: [
          { label: "Para", value: row.sendTo },
          { label: "Mensaje", value: preview(draft.body, 220) },
        ],
        payload: { to: row.sendTo, subject: draft.subject, body: draft.body, returnCaseId: row.id, followUp: number },
        now,
      });
      await prisma.returnCase.update({
        where: { id: row.id },
        data: {
          actionId: card.actionId,
          events: withEvents(row.events, event(now, "follow_up_proposed", `${who} no respondió: preparé el seguimiento n.º ${number} para que lo apruebes.`, card.actionId)),
        },
      });
    } else {
      const reminders = row.followUps + 1;
      await prisma.returnCase.update({
        where: { id: row.id },
        data: {
          followUps: reminders,
          followUpAt: nextFollowUpAt(now, reminders, ctx.timeZone),
          events: withEvents(row.events, event(now, "reminder", `Te pregunté si ${who} ya respondió.`)),
        },
      });
      await notify(ctx.userId, {
        type: "REMINDER",
        title: `¿${who} respondió tu reclamo?`,
        body: `${row.order.title}. Cuéntale a Omni qué dijo la tienda o prepara un seguimiento.`,
        href: `/devoluciones?caso=${row.id}`,
        data: { caseId: row.id },
      });
    }
  }
  return count;
}

/** Reembolsos confirmados que ya se ven como abono en las cuentas conectadas (Finanzas). */
async function matchRefunds(ctx: Ctx, now: Date): Promise<number> {
  const pending = await prisma.returnCase.findMany({
    where: {
      userId: ctx.userId,
      status: "RESOLVED",
      outcome: "REFUND",
      refundReceivedAt: null,
      // Pasado el plazo se deja de buscar (el usuario puede marcarlo a mano).
      resolvedAt: { gte: new Date(now.getTime() - REFUND_WATCH_DAYS * DAY) },
    },
    include: { order: true },
  });
  if (pending.length === 0) return 0;
  const since = new Date(Math.min(...pending.map((c) => (c.sentAt ?? c.createdAt).getTime())) - DAY);
  const credits = await prisma.transaction.findMany({
    where: { userId: ctx.userId, direction: "CREDIT", postedAt: { gte: since, lte: now } },
    orderBy: { postedAt: "asc" },
    take: 500,
    select: { id: true, amount: true, direction: true, currency: true, merchantName: true, description: true, postedAt: true },
  });
  const used = new Set<string>();
  let matched = 0;
  for (const row of pending) {
    const tx = matchRefund(
      {
        merchant: row.order.merchant,
        amount: num(row.refundAmount) ?? num(row.amount) ?? num(row.order.total),
        currency: row.currency,
        since: row.sentAt ?? row.createdAt,
      },
      credits.filter((c) => !used.has(c.id)).map((c) => ({ ...c, amount: Number(c.amount) })),
    );
    if (!tx) continue;
    used.add(tx.id);
    const claimed = await prisma.returnCase.updateMany({
      where: { id: row.id, refundReceivedAt: null },
      data: {
        refundReceivedAt: tx.postedAt,
        events: withEvents(row.events, event(tx.postedAt, "refund_received", `Llegó el reembolso de ${money(tx.amount, row.currency, { cents: true })} a tu cuenta.`, tx.id)),
      },
    });
    if (claimed.count === 0) continue;
    matched++;
    await notify(ctx.userId, {
      type: "SYSTEM",
      title: `Llegó tu reembolso de ${row.order.merchant}`,
      body: `${money(tx.amount, row.currency, { cents: true })} por ${row.order.title}.`,
      href: `/devoluciones?caso=${row.id}`,
      data: { caseId: row.id },
    });
  }
  return matched;
}

// ───────────────────────── Pedidos ─────────────────────────

export interface ManualOrderInput {
  merchant: string;
  title: string;
  orderNumber?: string | null;
  /** Fechas locales AAAA-MM-DD. */
  orderedOn?: string | null;
  expectedOn?: string | null;
  deliveredOn?: string | null;
  total?: number | null;
  currency?: string | null;
  supportEmail?: string | null;
  trackingNumber?: string | null;
}

function localDay(value: string | null | undefined, timeZone: string, label: string): Date | null {
  if (!value) return null;
  const parsed = parseLocalDateTime(value, timeZone);
  if (!parsed) throw Errors.badRequest(`La fecha ${label} no es válida (usa AAAA-MM-DD).`);
  return parsed.date;
}

export async function addManualOrder(userId: string, input: ManualOrderInput, now = new Date()): Promise<{ order: TrackedOrderView; created: boolean }> {
  const ctx = await userCtx(userId);
  const merchantName = input.merchant.trim().slice(0, 80);
  const title = input.title.trim().slice(0, 160);
  if (merchantName.length < 2 || title.length < 2) throw Errors.badRequest("Escribe la tienda y qué compraste.");
  const orderNumber = input.orderNumber?.trim().replace(/^#/, "").toUpperCase().slice(0, 40) || null;

  const ordered = localDay(input.orderedOn, ctx.timeZone, "de compra");
  const expected = localDay(input.expectedOn, ctx.timeZone, "de entrega");
  const delivered = localDay(input.deliveredOn, ctx.timeZone, "de entrega real");
  const orderedAt = ordered ? atLocalTime(ordered, 12, 0, ctx.timeZone) : now;
  if (orderedAt.getTime() > now.getTime() + DAY) throw Errors.badRequest("La fecha de compra no puede ser futura.");
  const expectedBy = expected ? endOfLocalDay(expected, ctx.timeZone) : null;
  if (expectedBy && expectedBy.getTime() < orderedAt.getTime() - DAY) throw Errors.badRequest("La fecha de entrega no puede ser anterior a la compra.");
  const deliveredAt = delivered ? (atLocalTime(delivered, 12, 0, ctx.timeZone) > now ? now : atLocalTime(delivered, 12, 0, ctx.timeZone)) : null;

  if (orderNumber) {
    const same = await prisma.trackedOrder.findFirst({ where: { userId, orderNumber } });
    if (same && (same.merchant.toLowerCase() === merchantName.toLowerCase() || same.merchantDomain === findMerchantByName(merchantName)?.domains[0])) {
      return { order: await getOrderView(userId, same.id, now), created: false };
    }
  }
  const known = findMerchantByName(merchantName);
  const order = await prisma.trackedOrder.create({
    data: {
      userId,
      source: "MANUAL",
      merchant: known?.name ?? merchantName,
      merchantDomain: known?.domains[0] ?? domainOf(input.supportEmail) ?? null,
      supportEmail: input.supportEmail?.trim().toLowerCase() || known?.supportEmail || null,
      orderNumber,
      title,
      total: input.total ?? null,
      currency: (input.currency ?? ctx.currency).toUpperCase(),
      status: deliveredAt ? "DELIVERED" : "ORDERED",
      orderedAt,
      expectedBy,
      deliveredAt,
      returnWindowDays: known?.returnWindowDays ?? null,
      trackingNumber: input.trackingNumber?.trim().toUpperCase() || null,
    },
  });
  await audit({ userId, actor: "user", action: "order.added", entity: "tracked_order", entityId: order.id });
  return { order: await getOrderView(userId, order.id, now), created: true };
}

/** Pedidos de ejemplo en tiendas de prueba (se pueden borrar). No duplica si ya estaban. */
export async function addExampleOrders(userId: string, now = new Date()): Promise<{ created: number }> {
  const ctx = await userCtx(userId);
  let created = 0;
  for (const example of exampleOrders(now, ctx.timeZone)) {
    try {
      await prisma.trackedOrder.create({
        data: {
          userId,
          source: "EXAMPLE",
          sourceKey: example.key,
          merchant: example.merchant,
          merchantDomain: example.merchantDomain,
          supportEmail: example.supportEmail,
          orderNumber: example.orderNumber,
          title: example.title,
          total: example.total,
          currency: "USD",
          status: example.status,
          orderedAt: example.orderedAt,
          expectedBy: example.expectedBy,
          deliveredAt: example.deliveredAt,
          returnWindowDays: example.returnWindowDays,
          carrier: example.carrier,
          trackingNumber: example.trackingNumber,
        },
      });
      created++;
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
    }
  }
  if (created > 0) await audit({ userId, actor: "user", action: "order.examples_added", metadata: { created } });
  return { created };
}

export type OrderUpdate =
  | { action: "delivered"; deliveredOn?: string | null }
  | { action: "dismiss" }
  | { action: "restore" }
  | { action: "delete" }
  | {
      action: "edit";
      merchant?: string;
      title?: string;
      orderNumber?: string | null;
      expectedOn?: string | null;
      supportEmail?: string | null;
      total?: number | null;
    };

export async function updateOrder(userId: string, orderId: string, input: OrderUpdate, now = new Date()): Promise<TrackedOrderView | { deleted: true }> {
  const ctx = await userCtx(userId);
  const order = await ownOrder(userId, orderId);
  const openCase = await prisma.returnCase.findFirst({ where: { orderId, status: { in: [...OPEN_CASE_STATUSES] } }, select: { id: true } });
  switch (input.action) {
    case "delivered": {
      if (order.status === "DELIVERED") break;
      if (order.status === "CANCELED") throw Errors.conflict("Este pedido está cancelado.");
      const day = localDay(input.deliveredOn, ctx.timeZone, "de entrega");
      const at = day ? atLocalTime(day, 12, 0, ctx.timeZone) : now;
      const deliveredAt = at > now ? now : at;
      await prisma.trackedOrder.update({ where: { id: order.id }, data: { status: "DELIVERED", deliveredAt } });
      await resolveArrived(ctx, order, deliveredAt);
      break;
    }
    case "dismiss":
      if (openCase) throw Errors.conflict("Este pedido tiene un reclamo abierto: ciérralo primero.");
      await prisma.trackedOrder.update({ where: { id: order.id }, data: { dismissedAt: now } });
      break;
    case "restore":
      await prisma.trackedOrder.update({ where: { id: order.id }, data: { dismissedAt: null } });
      break;
    case "delete":
      if (order.source !== "MANUAL" && order.source !== "EXAMPLE") {
        throw Errors.conflict("Solo se borran los pedidos agregados a mano o de ejemplo; este puedes dejar de seguirlo.");
      }
      await prisma.trackedOrder.delete({ where: { id: order.id } });
      await audit({ userId, actor: "user", action: "order.deleted", entity: "tracked_order", entityId: order.id });
      return { deleted: true };
    case "edit": {
      const expected = input.expectedOn === undefined ? undefined : localDay(input.expectedOn, ctx.timeZone, "de entrega");
      const expectedBy = expected === undefined ? undefined : expected ? endOfLocalDay(expected, ctx.timeZone) : null;
      const merchant = input.merchant?.trim().slice(0, 80);
      const known = merchant ? findMerchantByName(merchant) : null;
      await prisma.trackedOrder.update({
        where: { id: order.id },
        data: {
          ...(merchant && merchant.length >= 2
            ? { merchant: known?.name ?? merchant, merchantDomain: known?.domains[0] ?? order.merchantDomain ?? null }
            : {}),
          ...(input.title && input.title.trim().length >= 2 ? { title: input.title.trim().slice(0, 160) } : {}),
          ...(input.orderNumber !== undefined ? { orderNumber: input.orderNumber?.trim().replace(/^#/, "").toUpperCase().slice(0, 40) || null } : {}),
          ...(input.supportEmail !== undefined
            ? {
                supportEmail: input.supportEmail?.trim().toLowerCase() || null,
                ...(!order.merchantDomain && input.supportEmail ? { merchantDomain: domainOf(input.supportEmail) } : {}),
              }
            : {}),
          ...(input.total !== undefined ? { total: input.total } : {}),
          // Nueva fecha prometida: el retraso se vuelve a evaluar desde cero.
          ...(expectedBy !== undefined ? { expectedBy, lateNotifiedAt: null } : {}),
        },
      });
      // Si cambió la tienda o su correo, el reclamo sin enviar se reescribe (saludo y destinatario correctos).
      const fresh = await prisma.trackedOrder.findFirst({ where: { id: order.id } });
      if (fresh && (fresh.merchant !== order.merchant || fresh.supportEmail !== order.supportEmail)) {
        const draft = await prisma.returnCase.findFirst({ where: { orderId: order.id, status: "DRAFT" }, include: { order: true } });
        if (draft) await redraftCase(ctx, { ...draft, order: fresh }, now);
      }
      break;
    }
  }
  return getOrderView(userId, order.id, now);
}

// ───────────────────────── Reclamos ─────────────────────────

export interface ProblemInput {
  reason: ReturnReasonId;
  desired?: ReturnOutcomeId | null;
  details?: string | null;
}

export interface PreparedCase {
  returnCase: ReturnCaseView;
  approval: ApprovalCard | null;
  /** Ya había un reclamo abierto para este pedido (se devuelve ese). */
  existing: boolean;
}

/** Reportar un problema con un pedido: Omni redacta el reclamo y, si puede enviarlo por correo, lo propone. */
export async function reportProblem(
  userId: string,
  orderId: string,
  input: ProblemInput,
  opts: { conversationId?: string | null; now?: Date } = {},
): Promise<PreparedCase> {
  const now = opts.now ?? new Date();
  const ctx = await userCtx(userId);
  let order = await ownOrder(userId, orderId);
  const state = deliveryState(
    { status: order.status, expectedBy: order.expectedBy, deliveredAt: order.deliveredAt, returnWindowDays: order.returnWindowDays },
    now,
    ctx.timeZone,
  );
  const afterDelivery = ["DAMAGED", "WRONG_ITEM", "NOT_AS_DESCRIBED", "CHANGED_MIND"].includes(input.reason);
  if (order.status === "CANCELED" && input.reason !== "NOT_RECEIVED") {
    throw Errors.conflict("Este pedido está cancelado: si no te devolvieron el dinero, elige \"No lo recibí\".");
  }
  if (input.reason === "LATE" && state.kind === "delivered") {
    throw Errors.conflict("Este pedido figura como entregado. Si no te llegó, elige \"No lo recibí\".");
  }
  if (input.reason === "LATE" && order.expectedBy && now.getTime() <= order.expectedBy.getTime()) {
    throw Errors.conflict(
      `Todavía está dentro de la fecha prometida (llega el ${longDate(order.expectedBy, ctx.timeZone)}). Si se atrasa, Omni prepara el reclamo.`,
    );
  }
  if (input.reason === "CHANGED_MIND" && state.returnBy && state.returnDaysLeft !== null && state.returnDaysLeft < 0) {
    throw Errors.conflict(`El plazo para devolverlo venció el ${longDate(state.returnBy, ctx.timeZone)}: la tienda puede negarse.`);
  }
  // Si llegó dañado o distinto, es que llegó: se marca entregado.
  if (afterDelivery && order.status !== "DELIVERED") {
    order = await prisma.trackedOrder.update({ where: { id: order.id }, data: { status: "DELIVERED", deliveredAt: order.deliveredAt ?? now } });
  }
  return prepareCase(ctx, order, input, { now, conversationId: opts.conversationId ?? null, auto: false });
}

async function prepareCase(
  ctx: Ctx,
  order: TrackedOrder,
  input: ProblemInput,
  opts: { now: Date; conversationId?: string | null; auto: boolean },
): Promise<PreparedCase> {
  const open = await prisma.returnCase.findFirst({
    where: { orderId: order.id, status: { in: [...OPEN_CASE_STATUSES] } },
    include: { order: true, action: true },
  });
  if (open) {
    const view = await caseViewOf(open, ctx.timeZone);
    return { returnCase: view, approval: view.approval, existing: true };
  }
  const options = desiredOptions(input.reason);
  const desired = input.desired && options.includes(input.desired) ? input.desired : defaultDesired(input.reason);
  const details = cleanDetails(input.details);
  const total = num(order.total);
  const draft = draftClaim({
    merchant: order.merchant,
    orderNumber: order.orderNumber,
    title: order.title,
    orderedAt: order.orderedAt,
    expectedBy: order.expectedBy,
    deliveredAt: order.deliveredAt,
    total,
    currency: order.currency,
    reason: input.reason,
    desired,
    details,
    userName: ctx.name,
    now: opts.now,
    timeZone: ctx.timeZone,
  });
  const mailbox = order.supportEmail ? await activeMailbox(ctx.userId) : null;
  const channel = order.supportEmail && mailbox ? "EMAIL" : "MANUAL";
  const created = await prisma.returnCase.create({
    data: {
      userId: ctx.userId,
      orderId: order.id,
      reason: input.reason,
      status: "DRAFT",
      channel,
      desired,
      details,
      subject: draft.subject,
      body: draft.body,
      sendTo: order.supportEmail,
      amount: total,
      currency: order.currency,
      events: withEvents(
        [],
        event(
          opts.now,
          "drafted",
          opts.auto ? `Tu pedido va tarde: Omni preparó el reclamo (${REASON_LABEL[input.reason].toLowerCase()}).` : `Preparé el reclamo: ${REASON_LABEL[input.reason].toLowerCase()}.`,
        ),
      ),
      createdAt: opts.now,
    },
  });

  let approval: ApprovalCard | null = null;
  if (channel === "EMAIL" && order.supportEmail) {
    approval = await proposeAction({
      userId: ctx.userId,
      conversationId: opts.conversationId ?? null,
      module: "CONCIERGE",
      type: "SEND_EMAIL",
      title: draft.subject,
      summary: `Reclamo a ${order.merchant}: ${REASON_LABEL[input.reason].toLowerCase()}. Pides: ${OUTCOME_LABEL[desired].toLowerCase()}.`,
      merchant: order.merchant,
      lines: [
        { label: "Para", value: order.supportEmail },
        { label: "Pides", value: OUTCOME_LABEL[desired] },
        { label: "Mensaje", value: preview(draft.body, 260) },
      ],
      payload: { to: order.supportEmail, subject: draft.subject, body: draft.body, returnCaseId: created.id },
      // Si lo pidió el usuario ya lo está viendo; si lo preparó Omni por un retraso, se avisa.
      notify: opts.auto,
      now: opts.now,
    });
    await prisma.returnCase.update({
      where: { id: created.id },
      data: {
        actionId: approval.actionId,
        events: withEvents(created.events, event(opts.now, "proposed", `Listo para enviar a ${order.supportEmail}: falta tu aprobación.`, approval.actionId)),
      },
    });
  }
  await audit({
    userId: ctx.userId,
    actor: opts.auto ? "agent" : "user",
    action: "return.drafted",
    entity: "return_case",
    entityId: created.id,
    metadata: { reason: input.reason, channel },
  });
  const view = await caseViewOf(await ownCase(ctx.userId, created.id), ctx.timeZone);
  return { returnCase: view, approval, existing: false };
}

function preview(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

/** Reescribe un reclamo sin enviar con los datos actuales del pedido y, si ya se puede enviar por correo, lo propone. */
async function redraftCase(ctx: Ctx, row: CaseWithOrder, now: Date) {
  const order = row.order;
  const draft = draftClaim({
    merchant: order.merchant,
    orderNumber: order.orderNumber,
    title: order.title,
    orderedAt: order.orderedAt,
    expectedBy: order.expectedBy,
    deliveredAt: order.deliveredAt,
    total: num(order.total),
    currency: order.currency,
    reason: row.reason,
    desired: row.desired,
    details: row.details,
    userName: ctx.name,
    now,
    timeZone: ctx.timeZone,
  });
  await expirePendingAction(row.actionId, "Cambiaron los datos del pedido.");
  const mailbox = order.supportEmail ? await activeMailbox(ctx.userId) : null;
  let actionId: string | null = null;
  if (order.supportEmail && mailbox) {
    const card = await proposeAction({
      userId: ctx.userId,
      module: "CONCIERGE",
      type: "SEND_EMAIL",
      title: draft.subject,
      summary: `Reclamo a ${order.merchant}: ${REASON_LABEL[row.reason].toLowerCase()}. Pides: ${OUTCOME_LABEL[row.desired].toLowerCase()}.`,
      merchant: order.merchant,
      lines: [
        { label: "Para", value: order.supportEmail },
        { label: "Pides", value: OUTCOME_LABEL[row.desired] },
        { label: "Mensaje", value: preview(draft.body, 260) },
      ],
      payload: { to: order.supportEmail, subject: draft.subject, body: draft.body, returnCaseId: row.id },
      notify: false,
      now,
    });
    actionId = card.actionId;
  }
  await prisma.returnCase.update({
    where: { id: row.id },
    data: {
      subject: draft.subject,
      body: draft.body,
      sendTo: order.supportEmail,
      channel: actionId ? "EMAIL" : "MANUAL",
      actionId,
      events: withEvents(
        row.events,
        event(
          now,
          actionId ? "proposed" : "drafted",
          actionId
            ? `Actualicé el reclamo con los datos nuevos del pedido: listo para enviar a ${order.supportEmail}.`
            : "Actualicé el reclamo con los datos nuevos del pedido.",
          actionId,
        ),
      ),
    },
  });
}

/** El ejecutor de SEND_EMAIL avisa que el reclamo (o un seguimiento) salió desde la bandeja del usuario. */
export async function markClaimSent(
  userId: string,
  caseId: string,
  info: { sentAt: Date; to: string; messageId: string | null; sandbox: boolean },
): Promise<{ followUpAt: Date | null; followUpText: string | null; followUp: boolean } | null> {
  if (!isUuid(caseId)) return null;
  const row = await prisma.returnCase.findFirst({ where: { id: caseId, userId } });
  if (!row) return null;
  const ctx = await userCtx(userId);
  const followUp = row.sentAt !== null;
  const followUps = followUp ? row.followUps + 1 : row.followUps;
  const followUpAt = nextFollowUpAt(info.sentAt, followUps, ctx.timeZone);
  const where = info.sandbox ? " (bandeja de prueba)" : "";
  await prisma.returnCase.update({
    where: { id: row.id },
    data: {
      status: row.status === "DRAFT" ? "SENT" : row.status,
      sentAt: row.sentAt ?? info.sentAt,
      followUps,
      followUpAt: row.status === "DRAFT" || row.status === "SENT" ? followUpAt : row.followUpAt,
      events: withEvents(
        row.events,
        event(
          info.sentAt,
          followUp ? "follow_up_sent" : "sent",
          followUp ? `Seguimiento n.º ${followUps} enviado a ${info.to}${where}.` : `Reclamo enviado a ${info.to} desde tu correo${where}.`,
          info.messageId,
        ),
      ),
    },
  });
  await audit({ userId, actor: "system", action: followUp ? "return.follow_up_sent" : "return.sent", entity: "return_case", entityId: row.id });
  return { followUpAt, followUpText: longDate(followUpAt, ctx.timeZone), followUp };
}

export type CaseUpdate =
  | { action: "sent" }
  | { action: "propose" }
  | { action: "edit"; subject: string; body: string }
  | { action: "reply"; text?: string | null; kind?: ReplyKind | null; amount?: number | null }
  | { action: "package_sent" }
  | { action: "info_sent" }
  | { action: "refund_received"; amount?: number | null }
  | { action: "close" }
  | { action: "reopen" };

export async function updateCase(userId: string, caseId: string, input: CaseUpdate, opts: { now?: Date; conversationId?: string | null } = {}): Promise<ReturnCaseView> {
  const now = opts.now ?? new Date();
  const ctx = await userCtx(userId);
  const row = await ownCase(userId, caseId);
  const who = row.order.merchant;
  const isOpen = (OPEN_CASE_STATUSES as readonly string[]).includes(row.status);

  switch (input.action) {
    case "sent": {
      if (row.status !== "DRAFT") throw Errors.conflict("Este reclamo ya se envió.");
      const claimed = await prisma.returnCase.updateMany({
        where: { id: row.id, status: "DRAFT" },
        data: {
          status: "SENT",
          sentAt: now,
          followUpAt: nextFollowUpAt(now, 0, ctx.timeZone),
          events: withEvents(row.events, event(now, "sent", `Lo enviaste tú a ${who}.`)),
        },
      });
      if (claimed.count === 0) throw Errors.conflict("Este reclamo ya se envió.");
      await expirePendingAction(row.actionId, "Lo enviaste tú.");
      break;
    }
    case "propose": {
      if (row.status !== "DRAFT") throw Errors.conflict("Este reclamo ya se envió.");
      const to = row.sendTo ?? row.order.supportEmail;
      if (!to) throw Errors.badRequest("Falta el correo de la tienda: agrégalo al pedido o envíalo tú desde su página.");
      if (!(await activeMailbox(userId))) throw Errors.badRequest("Conecta tu correo en Trámites para que Omni pueda enviarlo por ti.");
      const current = row.actionId ? await prisma.agentAction.findUnique({ where: { id: row.actionId } }) : null;
      if (current?.status === "PENDING") break;
      const card = await proposeAction({
        userId,
        conversationId: opts.conversationId ?? null,
        module: "CONCIERGE",
        type: "SEND_EMAIL",
        title: row.subject,
        summary: `Reclamo a ${who}: ${REASON_LABEL[row.reason].toLowerCase()}. Pides: ${OUTCOME_LABEL[row.desired].toLowerCase()}.`,
        merchant: who,
        lines: [
          { label: "Para", value: to },
          { label: "Pides", value: OUTCOME_LABEL[row.desired] },
          { label: "Mensaje", value: preview(row.body, 260) },
        ],
        payload: { to, subject: row.subject, body: row.body, returnCaseId: row.id },
        notify: false,
        now,
      });
      await prisma.returnCase.update({
        where: { id: row.id },
        data: {
          channel: "EMAIL",
          sendTo: to,
          actionId: card.actionId,
          events: withEvents(row.events, event(now, "proposed", `Listo para enviar a ${to}: falta tu aprobación.`, card.actionId)),
        },
      });
      break;
    }
    case "edit": {
      if (row.status !== "DRAFT") throw Errors.conflict("Solo se puede editar antes de enviarlo.");
      const subject = input.subject.replace(/\s+/g, " ").trim().slice(0, 160);
      const body = input.body.replace(/\r/g, "").trim().slice(0, 5000);
      if (subject.length < 3 || body.length < 10) throw Errors.badRequest("El asunto y el mensaje no pueden quedar vacíos.");
      await prisma.returnCase.update({ where: { id: row.id }, data: { subject, body } });
      // La propuesta pendiente se actualiza para que se envíe exactamente lo que el usuario ve.
      const action = row.actionId ? await prisma.agentAction.findUnique({ where: { id: row.actionId } }) : null;
      if (action?.status === "PENDING") {
        const payload = (action.payload ?? {}) as Record<string, unknown>;
        const lines = Array.isArray(payload.lines) ? (payload.lines as { label: string; value: string }[]) : [];
        await prisma.agentAction.update({
          where: { id: action.id },
          data: {
            title: subject,
            payload: {
              ...payload,
              subject,
              body,
              lines: lines.map((l) => (l.label === "Mensaje" ? { ...l, value: preview(body, 260) } : l)),
            } as unknown as Prisma.InputJsonValue,
          },
        });
      }
      break;
    }
    case "reply": {
      if (row.status !== "SENT" && row.status !== "ANSWERED") throw Errors.conflict("Primero envía el reclamo a la tienda.");
      const reading = input.text?.trim()
        ? readStoreReply(
            {
              subject: "",
              bodyText: input.text.slice(0, 8000),
              receivedAt: now,
              merchant: who,
              currency: row.currency,
              expectedAmount: num(row.amount) ?? num(row.order.total),
            },
            ctx.timeZone,
          )
        : readingFromKind(input.kind ?? "ack", who, input.amount ?? null, row.currency);
      const amount = input.amount ?? reading.amount;
      await applyReply(ctx, row, { ...reading, amount }, { messageId: null, at: now, now, fromUser: true });
      break;
    }
    case "package_sent":
    case "info_sent": {
      if (row.status !== "ANSWERED") throw Errors.conflict("La tienda todavía no pidió nada.");
      const wait = input.action === "package_sent" ? AFTER_PACKAGE_BUSINESS_DAYS : 2;
      await prisma.returnCase.update({
        where: { id: row.id },
        data: {
          status: "SENT",
          nextStep: null,
          nextStepBy: null,
          followUpAt: atLocalTime(addBusinessDays(now, wait, ctx.timeZone), 9, 0, ctx.timeZone),
          events: withEvents(
            row.events,
            event(now, input.action, input.action === "package_sent" ? `Enviaste el producto de vuelta a ${who}.` : `Le respondiste a ${who} con lo que pidió.`),
          ),
        },
      });
      break;
    }
    case "refund_received": {
      const amount = input.amount ?? num(row.refundAmount) ?? num(row.amount) ?? num(row.order.total);
      await prisma.returnCase.update({
        where: { id: row.id },
        data: {
          status: "RESOLVED",
          outcome: row.outcome === "STORE_CREDIT" ? "STORE_CREDIT" : "REFUND",
          refundAmount: amount,
          resolvedAt: row.resolvedAt ?? now,
          refundReceivedAt: now,
          followUpAt: null,
          nextStep: null,
          nextStepBy: null,
          events: withEvents(
            row.events,
            event(now, "refund_received", amount ? `Confirmaste que recibiste ${money(amount, row.currency, { cents: true })}.` : "Confirmaste que recibiste el reembolso."),
          ),
        },
      });
      await expirePendingAction(row.actionId, "El reembolso ya llegó.");
      await settleUndeliveredOrder(row.order, row.outcome === "STORE_CREDIT" ? "STORE_CREDIT" : "REFUND");
      break;
    }
    case "close": {
      if (!isOpen && row.status !== "REJECTED") throw Errors.conflict("Este reclamo ya está cerrado.");
      await prisma.returnCase.update({
        where: { id: row.id },
        data: { status: "CLOSED", followUpAt: null, nextStep: null, nextStepBy: null, events: withEvents(row.events, event(now, "closed", "Cerraste el reclamo.")) },
      });
      await expirePendingAction(row.actionId, "Cerraste el reclamo.");
      break;
    }
    case "reopen": {
      if (isOpen) throw Errors.conflict("Este reclamo sigue abierto.");
      const other = await prisma.returnCase.findFirst({ where: { orderId: row.orderId, status: { in: [...OPEN_CASE_STATUSES] } }, select: { id: true } });
      if (other) throw Errors.conflict("Este pedido ya tiene otro reclamo abierto.");
      const sent = row.sentAt !== null;
      await prisma.returnCase.update({
        where: { id: row.id },
        data: {
          status: sent ? "SENT" : "DRAFT",
          outcome: null,
          resolvedAt: null,
          followUpAt: sent ? nextFollowUpAt(now, Math.min(row.followUps, MAX_FOLLOW_UPS - 1), ctx.timeZone) : null,
          events: withEvents(row.events, event(now, "reopened", "Reabriste el reclamo.")),
        },
      });
      break;
    }
  }
  await audit({ userId, actor: "user", action: `return.${input.action}`, entity: "return_case", entityId: row.id });
  return getCaseView(userId, row.id);
}

/** Lo que el usuario cuenta que respondió la tienda (sin pegar el texto). */
function readingFromKind(kind: ReplyKind, who: string, amount: number | null, currency: string): ReplyReading {
  const m = amount ? ` de ${money(amount, currency, { cents: true })}` : "";
  const base = { amount, nextStep: null, nextStepBy: null, newExpectedBy: null };
  switch (kind) {
    case "refund":
      return { ...base, kind, summary: `${who} aprobó el reembolso${m}.` };
    case "replacement":
      return { ...base, kind, summary: `${who} enviará un reemplazo.` };
    case "store_credit":
      return { ...base, kind, summary: `${who} te dio saldo a favor${m}.` };
    case "return_label":
      return { ...base, kind, nextStep: `Envía el producto como indicó ${who}.`, summary: `${who} aprobó la devolución y mandó las instrucciones.` };
    case "needs_info":
      return { ...base, kind, nextStep: `${who} pide más datos: respóndele.`, summary: `${who} pide más datos para seguir.` };
    case "rejected":
      return { ...base, kind, summary: `${who} rechazó el reclamo.` };
    case "shipping_update":
      return { ...base, kind, summary: `${who} mandó novedades del envío.` };
    case "ack":
      return { ...base, kind, summary: `${who} respondió que lo está revisando.` };
  }
}

const RESOLVED_BY: Partial<Record<ReplyKind, ReturnOutcome>> = { refund: "REFUND", replacement: "REPLACEMENT", store_credit: "STORE_CREDIT" };

/** Aplica la respuesta de la tienda al caso. Atómico: la misma respuesta nunca se aplica dos veces. */
async function applyReply(
  ctx: Ctx,
  row: CaseWithOrder,
  reading: ReplyReading,
  src: { messageId: string | null; at: Date; now: Date; fromUser?: boolean; simulated?: boolean },
): Promise<boolean> {
  const guard = await prisma.returnCase.updateMany({
    where: { id: row.id, status: { in: ["SENT", "ANSWERED"] }, OR: [{ repliedAt: null }, { repliedAt: { lt: src.at } }] },
    data: { repliedAt: src.at },
  });
  if (guard.count === 0) return false;
  const who = row.order.merchant;
  const resolved = RESOLVED_BY[reading.kind];
  const retry = atLocalTime(addBusinessDays(src.at, 2, ctx.timeZone), 9, 0, ctx.timeZone);
  const summary = src.simulated ? `${reading.summary} (respuesta simulada de la tienda de prueba)` : reading.summary;
  const common = { events: withEvents(row.events, event(src.at, "reply", summary, src.messageId, reading.kind)) };

  if (resolved) {
    await prisma.returnCase.update({
      where: { id: row.id },
      data: {
        ...common,
        status: "RESOLVED",
        outcome: resolved,
        refundAmount: resolved === "REPLACEMENT" ? null : (reading.amount ?? num(row.amount) ?? num(row.order.total)),
        resolvedAt: src.at,
        followUpAt: null,
        nextStep: null,
        nextStepBy: null,
      },
    });
    await settleUndeliveredOrder(row.order, resolved, reading.newExpectedBy);
  } else if (reading.kind === "return_label" || reading.kind === "needs_info") {
    await prisma.returnCase.update({
      where: { id: row.id },
      data: { ...common, status: "ANSWERED", nextStep: reading.nextStep, nextStepBy: reading.nextStepBy, followUpAt: null },
    });
  } else if (reading.kind === "rejected") {
    await prisma.returnCase.update({ where: { id: row.id }, data: { ...common, status: "REJECTED", followUpAt: null, nextStep: null, nextStepBy: null } });
  } else {
    // Novedades del envío o un acuse: se sigue esperando, con una nueva fecha para insistir.
    const eta = reading.newExpectedBy;
    const followUpAt = eta ? atLocalTime(addBusinessDays(eta, 1, ctx.timeZone), 9, 0, ctx.timeZone) : retry;
    await prisma.returnCase.update({ where: { id: row.id }, data: { ...common, status: "SENT", followUpAt } });
    if (eta) {
      const meta = readOrderMeta(row.order.meta);
      await prisma.trackedOrder.update({ where: { id: row.orderId }, data: { meta: metaJson({ ...meta, latestEstimate: eta.toISOString() }) } });
    }
  }
  await expirePendingAction(row.actionId, `${who} ya respondió.`);
  if (src.messageId) {
    // Si el correo de la tienda abrió un trámite sugerido (un "reembolso"), lo lleva Devoluciones.
    await prisma.task.deleteMany({ where: { userId: ctx.userId, status: "SUGGESTED", mailMessageId: src.messageId } });
  }
  if (!src.fromUser) {
    await notify(ctx.userId, {
      type: reading.kind === "return_label" || reading.kind === "needs_info" || reading.kind === "rejected" ? "ACTION_REQUIRED" : "SYSTEM",
      title: `${who} respondió tu reclamo`,
      body: reading.nextStep ? `${reading.summary} ${reading.nextStep}` : reading.summary,
      href: `/devoluciones?caso=${row.id}`,
      data: { caseId: row.id },
    });
  }
  await audit({ userId: ctx.userId, actor: src.fromUser ? "user" : "agent", action: "return.reply", entity: "return_case", entityId: row.id, metadata: { kind: reading.kind } });
  return true;
}

/**
 * Solo tiendas de prueba: la tienda responde el reclamo (o, si ya se devolvió el paquete, confirma el reembolso).
 * Si el reclamo salió por correo, la respuesta llega a la bandeja de prueba como cualquier correo.
 */
export async function simulateStoreReply(userId: string, caseId: string, now = new Date()): Promise<ReturnCaseView> {
  const ctx = await userCtx(userId);
  const row = await ownCase(userId, caseId);
  if (!isSandboxOrder(row.order) || !row.order.merchantDomain) {
    throw Errors.conflict("Solo las tiendas de prueba (.test) responden solas. Con una tienda real, cuéntale a Omni qué te respondió.");
  }
  if (row.status !== "SENT") {
    throw Errors.conflict(row.status === "DRAFT" ? "Primero envía el reclamo a la tienda." : "La tienda ya respondió: sigue el paso que falta.");
  }
  const stage: 0 | 1 = readEvents(row.events).some((e) => e.kind === "package_sent") ? 1 : 0;
  const reply = sandboxStoreReply({
    merchant: row.order.merchant,
    merchantDomain: row.order.merchantDomain,
    orderNumber: row.order.orderNumber,
    subject: row.subject,
    reason: row.reason,
    desired: row.desired,
    amount: num(row.amount) ?? num(row.order.total),
    currency: row.currency,
    stage,
    now,
    timeZone: ctx.timeZone,
  });
  const at = new Date(Math.max(now.getTime(), (row.repliedAt?.getTime() ?? 0) + 1000, (row.sentAt?.getTime() ?? 0) + 1000));
  let messageId: string | null = null;
  const mailbox = row.channel === "EMAIL" ? await activeMailbox(userId) : null;
  if (mailbox) {
    const message = await prisma.mailMessage.create({
      data: {
        userId,
        connectionId: mailbox.id,
        externalId: `sbx_return_${row.id}_${stage}_${at.getTime()}`,
        threadId: `sbx_thr_return_${row.id}`,
        folder: "inbox",
        fromName: reply.fromName,
        fromEmail: reply.fromEmail,
        toEmails: [],
        subject: reply.subject.slice(0, 300),
        snippet: reply.body.replace(/\s+/g, " ").slice(0, 160),
        bodyText: reply.body,
        receivedAt: at,
        labels: ["INBOX"],
        // Ya clasificado: la respuesta a un reclamo la lleva Devoluciones, no crea un trámite.
        category: "INFO",
        triageSource: "RULES",
        triagedAt: at,
        summary: `Respuesta de ${row.order.merchant} a tu reclamo.`,
      },
    });
    messageId = message.id;
  }
  const reading = readStoreReply(
    {
      subject: reply.subject,
      bodyText: reply.body,
      receivedAt: at,
      merchant: row.order.merchant,
      currency: row.currency,
      expectedAmount: num(row.amount) ?? num(row.order.total),
    },
    ctx.timeZone,
  );
  await applyReply(ctx, row, reading, { messageId, at, now, simulated: true });
  return getCaseView(userId, row.id);
}

// ───────────────────────── Inicio (panel) ─────────────────────────

/** Contador de la navegación: retrasos sin reclamo, reclamos por enviar a mano y respuestas que piden un paso tuyo. */
export async function returnsBadge(userId: string, now = new Date()): Promise<number> {
  const [cases, late] = await Promise.all([
    prisma.returnCase.count({
      where: {
        userId,
        OR: [
          { status: { in: ["ANSWERED", "REJECTED"] } },
          // Las propuestas pendientes ya cuentan en Aprobaciones.
          { status: "DRAFT", OR: [{ actionId: null }, { action: { status: { not: "PENDING" } } }] },
        ],
      },
    }),
    prisma.trackedOrder.count({
      where: {
        userId,
        status: { in: ["ORDERED", "SHIPPED"] },
        dismissedAt: null,
        expectedBy: { lt: now },
        cases: { none: {} },
      },
    }),
  ]);
  return cases + late;
}

export interface ReturnsAttention {
  id: string;
  title: string;
  detail: string;
  href: string;
  amount: number | null;
  currency: string;
}

/** Lo que espera al usuario en Devoluciones (para el panel de Inicio) y lo recuperado este mes. */
export async function returnsGlance(userId: string, now = new Date()): Promise<{ attention: ReturnsAttention[]; recoveredThisMonth: number }> {
  const ctx = await userCtx(userId);
  const [cases, late] = await Promise.all([
    prisma.returnCase.findMany({
      where: { userId, status: { not: "CLOSED" } },
      include: { order: true, action: { select: { status: true } } },
      orderBy: { updatedAt: "desc" },
      take: 50,
    }),
    prisma.trackedOrder.findMany({
      // Como en la pantalla: un pedido tarde pide atención si nunca tuvo reclamo (si lo tuvo, se ve el reclamo).
      where: { userId, status: { in: ["ORDERED", "SHIPPED"] }, dismissedAt: null, expectedBy: { lt: now }, cases: { none: {} } },
      take: 10,
    }),
  ]);
  const attention: ReturnsAttention[] = [];
  // Como el resto del panel de Inicio: el título es el pedido y el detalle, lo que falta. El renglón es angosto (lleva
  // el monto al lado), así que el detalle va corto; la tienda y el resto están en el reclamo.
  for (const row of cases) {
    const escalated = readEvents(row.events).some((e) => e.kind === "escalated");
    let detail: string | null = null;
    if (row.status === "DRAFT" && row.action?.status !== "PENDING") {
      detail = `Envía el reclamo a ${row.order.merchant}`;
    } else if (row.status === "ANSWERED") {
      const lastReply = [...readEvents(row.events)].reverse().find((e) => e.kind === "reply");
      detail =
        lastReply?.reply === "needs_info"
          ? `Responde a ${row.order.merchant}`
          : row.nextStepBy
            ? `Devuélvelo antes del ${shortDate(row.nextStepBy, ctx.timeZone)}`
            : `Devuélvelo a ${row.order.merchant}`;
    } else if (row.status === "REJECTED") {
      detail = "Rechazado: puedes escalarlo";
    } else if (row.status === "SENT" && escalated) {
      detail = "Sin respuesta: puedes escalarlo";
    }
    if (!detail) continue;
    attention.push({
      id: row.id,
      title: row.order.title,
      detail,
      href: `/devoluciones?caso=${row.id}`,
      amount: num(row.amount) ?? num(row.order.total),
      currency: row.currency,
    });
  }
  for (const order of late) {
    const state = deliveryState(
      { status: order.status, expectedBy: order.expectedBy, deliveredAt: order.deliveredAt, returnWindowDays: order.returnWindowDays },
      now,
      ctx.timeZone,
    );
    if (state.kind !== "late") continue;
    attention.push({
      id: order.id,
      title: order.title,
      detail: `Va ${state.daysLate} ${state.daysLate === 1 ? "día" : "días"} tarde`,
      href: `/devoluciones?pedido=${order.id}`,
      amount: num(order.total),
      currency: order.currency,
    });
  }
  const stats = returnsStats([], cases, ctx.currency, now, ctx.timeZone);
  return { attention, recoveredThisMonth: stats.recoveredThisMonth };
}
