// Datos de ejemplo de Pedidos y devoluciones: filas como las de la base, pasadas por las mismas funciones de vista y
// de redacción que usa la app (entregas, plazos, reclamos, lo recuperado). Coherentes con los demás demos: las
// zapatillas Andes 2 son la compra de hace 9 días del panel de Inicio; los audífonos Aura X2, la de hoy en Compras.
import type { ReturnCase, TrackedOrder } from "@/generated/prisma/client";
import { money, shortDate } from "@/lib/format";
import { OUTCOME_LABEL, REASON_LABEL } from "@/lib/returns-copy";
import { SANDBOX_PRODUCTS, SANDBOX_STORES } from "@/modules/concierge/sandbox/stores";
import { longDate } from "@/modules/procedures/time/es-dates";
import { addLocalDays, atLocalTime } from "@/modules/procedures/time/tz";
import { SANDBOX_RETURN_DAYS } from "@/modules/returns/merchants";
import { cleanDetails, draftClaim } from "@/modules/returns/rules/claim";
import { endOfLocalDay, nextFollowUpAt } from "@/modules/returns/rules/delivery";
import { caseView, lastOutcomeOf, OPEN_CASE_STATUSES, returnsStats, trackedOrderView, type StoredEvent } from "@/modules/returns/views";
import type {
  ApprovalCard,
  ChatMessageView,
  ReturnCaseView,
  ReturnOutcomeId,
  ReturnReasonId,
  ReturnsOverviewView,
  TrackedOrderView,
} from "@/types/cards";

const USER_NAME = "Laura Gómez";

function sandboxProduct(id: string) {
  const item = SANDBOX_PRODUCTS.find((p) => p.id === id);
  const store = SANDBOX_STORES.find((s) => s.id === item?.storeId);
  if (!item || !store) throw new Error(`Producto de prueba desconocido: ${id}`);
  const free = store.freeShippingOver !== null && item.base >= store.freeShippingOver;
  return { title: item.title, merchant: store.name, host: store.host, total: Math.round((item.base + (free ? 0 : store.shipping)) * 100) / 100 };
}

function preview(text: string, max = 260): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

function claimApproval(actionId: string, order: { merchant: string; supportEmail: string | null }, draft: { subject: string; body: string }, reason: ReturnReasonId, desired: ReturnOutcomeId, createdAt: Date): ApprovalCard {
  return {
    kind: "approval",
    actionId,
    type: "SEND_EMAIL",
    status: "PENDING",
    title: draft.subject,
    summary: `Reclamo a ${order.merchant}: ${REASON_LABEL[reason].toLowerCase()}. Pides: ${OUTCOME_LABEL[desired].toLowerCase()}.`,
    merchant: order.merchant,
    amount: null,
    amountPeriod: null,
    currency: null,
    lines: [
      { label: "Para", value: order.supportEmail ?? order.merchant },
      { label: "Pides", value: OUTCOME_LABEL[desired] },
      { label: "Mensaje", value: preview(draft.body) },
    ],
    resultMessage: null,
    createdAt: createdAt.toISOString(),
  };
}

/** Vista previa: el reclamo que Omni prepararía para este pedido desde la hoja "¿Qué pasó con tu pedido?". */
export function demoCaseFor(
  order: TrackedOrderView,
  input: { reason: ReturnReasonId; desired: ReturnOutcomeId; details: string | null },
  mailboxConnected: boolean,
  timeZone: string,
): ReturnCaseView {
  const now = new Date();
  const draft = draftClaim({
    merchant: order.merchant,
    orderNumber: order.orderNumber,
    title: order.title,
    orderedAt: new Date(order.orderedAt),
    expectedBy: order.expectedBy ? new Date(order.expectedBy) : null,
    deliveredAt: order.deliveredAt ? new Date(order.deliveredAt) : null,
    total: order.total,
    currency: order.currency,
    reason: input.reason,
    desired: input.desired,
    details: cleanDetails(input.details),
    userName: USER_NAME,
    now,
    timeZone,
  });
  const email = Boolean(order.supportEmail && mailboxConnected);
  return {
    id: `demo-case-${order.id}`,
    orderId: order.id,
    merchant: order.merchant,
    orderTitle: order.title,
    orderNumber: order.orderNumber,
    reason: input.reason,
    status: "DRAFT",
    channel: email ? "EMAIL" : "MANUAL",
    desired: input.desired,
    details: cleanDetails(input.details),
    subject: draft.subject,
    body: draft.body,
    sendTo: order.supportEmail,
    approval: email ? claimApproval(`demo-claim-${order.id}`, order, draft, input.reason, input.desired, now) : null,
    sentAt: null,
    followUps: 0,
    followUpAt: null,
    repliedAt: null,
    nextStep: null,
    nextStepBy: null,
    awaiting: null,
    outcome: null,
    amount: order.total,
    refundAmount: null,
    currency: order.currency,
    refundReceivedAt: null,
    resolvedAt: null,
    howToClaim: null,
    escalation: [],
    escalated: false,
    disputeSummary: null,
    sandbox: order.sandbox,
    events: [{ at: now.toISOString(), kind: "drafted", text: `Preparé el reclamo: ${REASON_LABEL[input.reason].toLowerCase()}.` }],
    createdAt: now.toISOString(),
  };
}

export function demoReturns(now: Date, timeZone: string) {
  const day = (offset: number, hour = 10, minute = 0) => atLocalTime(addLocalDays(now, offset, timeZone), hour, minute, timeZone);
  const end = (offset: number) => endOfLocalDay(day(offset, 12), timeZone);
  const ev = (at: Date, kind: StoredEvent["kind"], text: string, reply?: string): StoredEvent => ({ at: at.toISOString(), kind, text, ...(reply ? { reply } : {}) });

  const order = (id: string, productId: string, over: Record<string, unknown>): TrackedOrder => {
    const p = sandboxProduct(productId);
    return {
      id,
      userId: "demo",
      source: "EMAIL",
      sourceKey: null,
      purchaseOrderId: null,
      merchant: p.merchant,
      merchantDomain: p.host,
      supportEmail: `soporte@${p.host}`,
      orderNumber: null,
      title: p.title,
      total: p.total,
      currency: "USD",
      status: "SHIPPED",
      orderedAt: day(-5),
      expectedBy: null,
      deliveredAt: null,
      returnWindowDays: SANDBOX_RETURN_DAYS,
      carrier: "EnvíosYa",
      trackingNumber: null,
      lateNotifiedAt: null,
      meta: {},
      dismissedAt: null,
      createdAt: day(-5),
      updatedAt: now,
      ...over,
    } as unknown as TrackedOrder;
  };
  const returnCase = (id: string, o: TrackedOrder, over: Record<string, unknown>): ReturnCase =>
    ({
      id,
      userId: "demo",
      orderId: o.id,
      reason: "LATE",
      status: "DRAFT",
      channel: "EMAIL",
      desired: "REFUND",
      details: null,
      subject: "",
      body: "",
      sendTo: o.supportEmail,
      actionId: null,
      sentAt: null,
      followUps: 0,
      followUpAt: null,
      repliedAt: null,
      nextStep: null,
      nextStepBy: null,
      outcome: null,
      amount: o.total,
      refundAmount: null,
      currency: "USD",
      refundReceivedAt: null,
      resolvedAt: null,
      events: [],
      createdAt: now,
      updatedAt: now,
      ...over,
    }) as unknown as ReturnCase;
  const draftFor = (o: TrackedOrder, reason: ReturnReasonId, desired: ReturnOutcomeId, details: string | null, at: Date) =>
    draftClaim({
      merchant: o.merchant,
      orderNumber: o.orderNumber,
      title: o.title,
      orderedAt: o.orderedAt,
      expectedBy: o.expectedBy,
      deliveredAt: o.deliveredAt,
      total: Number(o.total),
      currency: "USD",
      reason,
      desired,
      details,
      userName: USER_NAME,
      now: at,
      timeZone,
    });

  // 1. Retrasado 3 días (detectado en el correo): Omni preparó el reclamo y espera tu aprobación.
  const limpia = order("demo-order-limpia", "limpia-s3", { orderNumber: "BZC-20417", orderedAt: day(-10, 20, 15), expectedBy: end(-3), trackingNumber: "EY2041700MX" });
  const limpiaDraft = draftFor(limpia, "LATE", "ARRIVED", null, day(-1, 9));
  const limpiaApproval = claimApproval("demo-claim-limpia", limpia, limpiaDraft, "LATE", "ARRIVED", day(-1, 9));
  const limpiaCase = returnCase("demo-case-limpia", limpia, {
    reason: "LATE",
    desired: "ARRIVED",
    subject: limpiaDraft.subject,
    body: limpiaDraft.body,
    actionId: limpiaApproval.actionId,
    createdAt: day(-1, 9),
    events: [
      ev(day(-1, 9), "drafted", "Tu pedido va tarde: Omni preparó el reclamo (no ha llegado)."),
      ev(day(-1, 9), "proposed", `Listo para enviar a ${limpia.supportEmail}: falta tu aprobación.`),
    ],
  });

  // 2. Llegó dañada: la tienda aprobó la devolución y mandó la etiqueta (falta enviar el paquete).
  const barista = order("demo-order-barista", "barista-pro", {
    orderNumber: "CNH-51872",
    status: "DELIVERED",
    orderedAt: day(-11, 13),
    expectedBy: end(-6),
    deliveredAt: day(-6, 15),
  });
  const baristaDraft = draftFor(barista, "DAMAGED", "REFUND", "El depósito de agua llegó rajado y gotea.", day(-5, 9, 30));
  const labelBy = end(6);
  const baristaCase = returnCase("demo-case-barista", barista, {
    reason: "DAMAGED",
    desired: "REFUND",
    status: "ANSWERED",
    details: "El depósito de agua llegó rajado y gotea.",
    subject: baristaDraft.subject,
    body: baristaDraft.body,
    sentAt: day(-5, 9, 32),
    repliedAt: day(-1, 16, 10),
    nextStep: `Envía el producto con la etiqueta de CasaNova Hogar antes del ${longDate(labelBy, timeZone)}.`,
    nextStepBy: labelBy,
    createdAt: day(-5, 9, 30),
    events: [
      ev(day(-5, 9, 30), "drafted", "Preparé el reclamo: llegó dañado o no funciona."),
      ev(day(-5, 9, 30), "proposed", `Listo para enviar a ${barista.supportEmail}: falta tu aprobación.`),
      ev(day(-5, 9, 32), "sent", `Reclamo enviado a ${barista.supportEmail} desde tu correo.`),
      ev(day(-1, 16, 10), "reply", "CasaNova Hogar aprobó la devolución y mandó las instrucciones para enviar el producto.", "return_label"),
    ],
  });

  // 3. No es como lo describían: enviado, esperando a la tienda (Omni insiste si no responde).
  const onda = order("demo-order-onda", "onda-mini", {
    source: "OMNIAGENT",
    orderNumber: "SMX-4K9D2T",
    status: "DELIVERED",
    orderedAt: day(-12, 19),
    expectedBy: end(-8),
    deliveredAt: day(-8, 14),
  });
  const ondaDraft = draftFor(onda, "NOT_AS_DESCRIBED", "REFUND", "El anuncio decía 12 horas de batería y dura 4.", day(-1, 10));
  const ondaSent = day(-1, 10, 5);
  const ondaCase = returnCase("demo-case-onda", onda, {
    reason: "NOT_AS_DESCRIBED",
    desired: "REFUND",
    status: "SENT",
    details: "El anuncio decía 12 horas de batería y dura 4.",
    subject: ondaDraft.subject,
    body: ondaDraft.body,
    sentAt: ondaSent,
    followUpAt: nextFollowUpAt(ondaSent, 0, timeZone),
    createdAt: day(-1, 10),
    events: [
      ev(day(-1, 10), "drafted", "Preparé el reclamo: no es como lo describían."),
      ev(day(-1, 10), "proposed", `Listo para enviar a ${onda.supportEmail}: falta tu aprobación.`),
      ev(ondaSent, "sent", `Reclamo enviado a ${onda.supportEmail} desde tu correo.`),
    ],
  });

  // 4 y 5. En camino: la compra de hoy en Compras y un aviso de envío del correo.
  const aura = order("demo-order-aura", "aura-x2", { source: "OMNIAGENT", orderNumber: "SMX-7F3K2Q", orderedAt: day(0, 9, 40), expectedBy: end(3), status: "ORDERED", carrier: null });
  const envio = order("demo-order-envio", "aura-x2", {
    merchant: "EnvíosYa",
    merchantDomain: null,
    supportEmail: null,
    title: "Pedido 88213",
    total: null,
    orderNumber: "88213",
    orderedAt: day(-1, 21, 10),
    expectedBy: end(2),
    returnWindowDays: null,
  });

  // 6. Entregadas: las zapatillas que compraste con Omni hace 9 días (se pueden devolver 30 días).
  const andes = order("demo-order-andes", "andes-2", {
    source: "OMNIAGENT",
    orderNumber: "CUM-9XK21P",
    status: "DELIVERED",
    total: 96.5,
    orderedAt: day(-9, 11),
    expectedBy: end(-4),
    deliveredAt: day(-4, 14),
    meta: { simulatedDelivery: true },
  });

  // 7. Resuelto: la freidora llegó con la tapa rota y ya volvió el dinero.
  const crisp = order("demo-order-crisp", "crisp-5l", { orderNumber: "CNH-40951", status: "DELIVERED", orderedAt: day(-20, 12), expectedBy: end(-15), deliveredAt: day(-15, 13) });
  const crispDraft = draftFor(crisp, "DAMAGED", "REFUND", "La tapa llegó rota y no cierra.", day(-14, 9));
  const crispCase = returnCase("demo-case-crisp", crisp, {
    reason: "DAMAGED",
    desired: "REFUND",
    status: "RESOLVED",
    outcome: "REFUND",
    details: "La tapa llegó rota y no cierra.",
    subject: crispDraft.subject,
    body: crispDraft.body,
    sentAt: day(-14, 9, 3),
    repliedAt: day(-3, 11),
    refundAmount: crisp.total,
    resolvedAt: day(-3, 11),
    refundReceivedAt: day(-1, 8),
    createdAt: day(-14, 9),
    events: [
      ev(day(-14, 9), "drafted", "Preparé el reclamo: llegó dañado o no funciona."),
      ev(day(-14, 9, 3), "sent", `Reclamo enviado a ${crisp.supportEmail} desde tu correo.`),
      ev(day(-12, 15), "reply", "CasaNova Hogar aprobó la devolución y mandó las instrucciones para enviar el producto.", "return_label"),
      ev(day(-11, 18), "package_sent", "Enviaste el producto de vuelta a CasaNova Hogar."),
      ev(day(-3, 11), "reply", `CasaNova Hogar aprobó el reembolso de ${money(Number(crisp.total), "USD", { cents: true })}.`, "refund"),
      ev(day(-1, 8), "refund_received", `Llegó el reembolso de ${money(Number(crisp.total), "USD", { cents: true })} a tu cuenta.`),
    ],
  });

  const orderRows = [limpia, barista, onda, aura, envio, andes, crisp];
  const caseRows = [
    { row: limpiaCase, approval: limpiaApproval },
    { row: baristaCase, approval: null },
    { row: ondaCase, approval: null },
    { row: crispCase, approval: null },
  ];
  const byId = new Map(orderRows.map((o) => [o.id, o]));
  const cases = caseRows.map(({ row, approval }) => caseView(row, byId.get(row.orderId)!, approval, timeZone));
  const orders = orderRows.map((o) => {
    const own = cases.filter((c) => c.orderId === o.id);
    const open = own.find((c) => (OPEN_CASE_STATUSES as readonly string[]).includes(c.status)) ?? null;
    return trackedOrderView(o, open, own.length - (open ? 1 : 0), now, timeZone, lastOutcomeOf(own));
  });
  const stats = returnsStats(orders, caseRows.map((c) => c.row), "USD", now, timeZone);
  const overview: ReturnsOverviewView = { orders, cases, stats, mailbox: { connected: true, address: "laura.demo@correo-demo.test" } };
  const empty: ReturnsOverviewView = {
    orders: [],
    cases: [],
    stats: { currency: "USD", onTheWay: 0, late: 0, openCases: 0, recoveredThisMonth: 0, recoveredTotal: 0 },
    mailbox: { connected: false, address: null },
  };

  const limpiaView = cases.find((c) => c.id === limpiaCase.id)!;
  const baristaView = cases.find((c) => c.id === baristaCase.id)!;
  const limpiaOrder = orders.find((o) => o.id === limpia.id)!;
  const at = (minutesAgo: number) => new Date(now.getTime() - minutesAgo * 60_000).toISOString();
  const conversation: ChatMessageView[] = [
    { id: "r1", role: "user", text: "Mi robot aspirador de Bazar Central no ha llegado", cards: [], createdAt: at(14) },
    {
      id: "r2",
      role: "assistant",
      text: `Tu pedido BZC-20417 iba a llegar el ${longDate(end(-3), timeZone)} y va 3 días tarde. Ayer te dejé el reclamo listo para ${limpia.supportEmail}: pide que confirmen dónde está y una nueva fecha, o el reembolso si no puede llegar pronto. Si lo apruebas, sale desde tu correo; si no responden en 2 días hábiles, preparo un seguimiento.`,
      cards: [
        { kind: "tracked_orders", title: "Pedidos con retraso", items: [limpiaOrder] },
        { kind: "return_case", returnCase: limpiaView },
        limpiaApproval,
      ],
      createdAt: at(13),
    },
    { id: "r3", role: "user", text: "¿Y la cafetera que llegó rota?", cards: [], createdAt: at(6) },
    {
      id: "r4",
      role: "assistant",
      text: `CasaNova Hogar ya aprobó la devolución y te mandó la etiqueta: envía la cafetera antes del ${longDate(labelBy, timeZone)}. Cuando lo hagas, dime «ya la envié» y quedo pendiente del reembolso de ${money(Number(barista.total), "USD", { cents: true })}.`,
      cards: [{ kind: "return_case", returnCase: baristaView }],
      suggestions: ["Ya la envié", "¿Qué pasa si no responden?"],
      createdAt: at(5),
    },
  ];

  // Para el panel de Inicio: lo que espera un paso tuyo (la aprobación del reclamo ya va en Aprobaciones).
  const attention = [
    {
      id: baristaView.id,
      title: baristaView.orderTitle,
      detail: `Devuélvelo antes del ${shortDate(labelBy, timeZone)}`,
      href: `/devoluciones?caso=${baristaView.id}`,
      amount: baristaView.amount,
      currency: "USD",
    },
  ];

  return {
    overview,
    empty,
    conversation,
    attention,
    /** El pedido entregado sobre el que se abre la hoja del reclamo (pantalla "reclamo"). */
    problemOrderId: andes.id,
    /** Contador de la navegación: la respuesta de CasaNova espera tu paso. */
    badge: 1,
  };
}
