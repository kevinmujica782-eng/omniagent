import "server-only";
import type { AgentAction, Prisma, WatchlistItem } from "@/generated/prisma/client";
import { audit } from "@/lib/audit";
import { decryptSecret, digest, sameDigest } from "@/lib/crypto";
import { prisma } from "@/lib/db";
import { AppError, Errors } from "@/lib/errors";
import { money } from "@/lib/format";
import { isUuid } from "@/lib/validation";
import { proposeAction } from "@/modules/actions/actions.service";
import { SELF } from "@/modules/procedures/documents/personal-keys";
import { longDate } from "@/modules/procedures/time/es-dates";
import type { ActionState, CheckoutView, WatchKindId } from "@/types/cards";
import { readItemMeta } from "./item-meta";
import { paymentLabel, paymentProvider } from "./payments";
import { purchaseReason } from "./rules/alert-copy";
import { referenceOf } from "./rules/drops";
import { buildQuote, checkLimits, deliveryFor, orderNumber, type FeeConfig, type Quote, type QuoteLine } from "./rules/checkout";
import { findSandboxProduct, storeOf } from "./sandbox/stores";
import { getPurchaseLimits, spentThisMonth } from "./settings.service";
import { readPrice } from "./sources";
import { orderView, toHistory } from "./views";

// Checkout con autorización explícita: Omni prepara la compra (una agent_action PURCHASE en PENDING con la
// cotización) y la hoja de pago muestra el total, el medio de pago y la entrega con dos botones: Denegar y Permitir.
// Permitir solo vale para la cotización que el usuario vio (huella HMAC) y, antes de cobrar, se vuelve a leer el
// precio en la tienda: si subió, no se cobra y se pide autorizar el nuevo total; si bajó, se cobra el menor.

const round2 = (n: number) => Math.round(n * 100) / 100;
export const CHECKOUT_TTL_HOURS = 24;

type CheckoutPayload = {
  watchlistItemId: string | null;
  alertId: string | null;
  quantity: number;
  unitPrice: number;
  total: number;
  currency: string;
  kind: WatchKindId;
  quoteLines: QuoteLine[];
  complete: boolean;
  version: number;
  priceChanged: { from: number; to: number } | null;
};

function readPayload(action: AgentAction): CheckoutPayload {
  const p = (action.payload ?? {}) as Record<string, unknown>;
  const str = (k: string) => (typeof p[k] === "string" ? (p[k] as string) : null);
  const num = (k: string) => (typeof p[k] === "number" && Number.isFinite(p[k]) ? (p[k] as number) : null);
  const quantity = Math.max(1, Math.floor(num("quantity") ?? 1));
  // Compras preparadas antes de este módulo solo guardaban el máximo: se adaptan.
  const total = num("total") ?? (action.amount === null ? 0 : Number(action.amount));
  const unitPrice = num("unitPrice") ?? round2(total / quantity);
  const changed = p.priceChanged as { from?: unknown; to?: unknown } | null | undefined;
  return {
    watchlistItemId: str("watchlistItemId"),
    alertId: str("alertId"),
    quantity,
    unitPrice,
    total,
    currency: str("currency") ?? action.currency ?? "USD",
    kind: (["PRODUCT", "FLIGHT", "EVENT_TICKET", "HOTEL", "OTHER"].includes(str("kind") ?? "") ? str("kind") : "PRODUCT") as WatchKindId,
    quoteLines: Array.isArray(p.quoteLines) ? (p.quoteLines as QuoteLine[]) : [{ label: "Precio", amount: total }],
    complete: p.complete !== false,
    version: num("version") ?? 1,
    priceChanged: changed && typeof changed.from === "number" && typeof changed.to === "number" ? { from: changed.from, to: changed.to } : null,
  };
}

function quoteIdOf(actionId: string, p: CheckoutPayload): string {
  return digest("quote", `${actionId}|${p.version}|${p.total.toFixed(2)}|${p.currency}|${p.quantity}`);
}

function feesFor(item: WatchlistItem): FeeConfig | null {
  if (item.source !== "sandbox" || !item.url) return null;
  const product = findSandboxProduct(item.url);
  return product ? storeOf(product) : null;
}

function orderPrefix(item: WatchlistItem | null): string {
  const product = item?.url && item.source === "sandbox" ? findSandboxProduct(item.url) : null;
  if (product) return storeOf(product).orderPrefix;
  const letters = (item?.merchant ?? "OMN").normalize("NFD").replace(/[^A-Za-z]/g, "").toUpperCase();
  return (letters + "OMN").slice(0, 3);
}

/** Líneas legibles para la boleta de Aprobaciones. */
function slipLines(quote: Quote): { label: string; value: string }[] {
  return quote.lines.map((line) => ({
    label: line.label,
    value: line.note ?? money(line.amount, quote.currency, { cents: true }),
  }));
}

async function selfAddress(userId: string): Promise<string | null> {
  const field = await prisma.personalField.findFirst({ where: { userId, person: SELF, fieldKey: "address" } });
  if (!field) return null;
  try {
    return decryptSecret(field.valueEncrypted);
  } catch {
    return null;
  }
}

async function deliveryText(userId: string, kind: WatchKindId, fees: FeeConfig | null, now: Date, timeZone: string) {
  const plan = deliveryFor(kind, fees, now, kind === "PRODUCT" || kind === "OTHER" ? await selfAddress(userId) : null);
  if (!plan) return null;
  const detail = plan.eta ? `Llega hacia el ${longDate(plan.eta, timeZone)} · ${plan.detail ?? ""}`.replace(/ · $/, "") : plan.detail;
  return { label: plan.label, detail, eta: plan.eta };
}

export async function checkoutView(userId: string, action: AgentAction, now = new Date()): Promise<CheckoutView> {
  const payload = readPayload(action);
  const [item, order, limits, profile] = await Promise.all([
    payload.watchlistItemId && isUuid(payload.watchlistItemId)
      ? prisma.watchlistItem.findFirst({ where: { id: payload.watchlistItemId, userId } })
      : Promise.resolve(null),
    prisma.purchaseOrder.findUnique({ where: { actionId: action.id } }),
    getPurchaseLimits(userId),
    prisma.profile.findUnique({ where: { id: userId }, select: { timezone: true } }),
  ]);
  const spent = await spentThisMonth(userId, limits.currency, now);
  const methods = paymentProvider().methods();
  const fees = item ? feesFor(item) : null;
  const delivery = order ? orderView(order).delivery : await deliveryText(userId, payload.kind, fees, now, profile?.timezone ?? "UTC");
  const result = (action.result ?? null) as { message?: string } | null;
  const notes = [
    "Pago simulado: no se cobra a ninguna tarjeta ni se envía el pedido a una tienda real.",
    ...(payload.complete ? [] : ["El envío y los impuestos, si los hay, los confirma la tienda."]),
    ...(payload.currency !== limits.currency ? [`Tus límites de compra están en ${limits.currency}; este total es en ${payload.currency}.`] : []),
  ];
  return {
    actionId: action.id,
    status: action.status as ActionState,
    itemId: payload.watchlistItemId,
    kind: payload.kind,
    title: item?.title ?? action.title,
    merchant: item?.merchant ?? null,
    detail: item ? (readItemMeta(item.metadata).detail ?? null) : null,
    quantity: payload.quantity,
    unitPrice: payload.unitPrice,
    currency: payload.currency,
    lines: payload.quoteLines.map((line) => ({ label: line.label, amount: line.amount, note: line.note ?? null })),
    total: payload.total,
    quoteId: quoteIdOf(action.id, payload),
    lockedUntil: (action.expiresAt ?? new Date(now.getTime() + CHECKOUT_TTL_HOURS * 3_600_000)).toISOString(),
    expiresAt: action.expiresAt?.toISOString() ?? null,
    methods,
    defaultMethodId: methods.find((m) => !m.declines)?.id ?? methods[0].id,
    delivery: delivery ? { label: delivery.label, detail: delivery.detail ?? null } : null,
    guard: `Solo se cobra si el total sigue en ${money(payload.total, payload.currency, { cents: true })} o menos.`,
    notes,
    sandbox: true,
    limits: { perOrder: limits.perOrder, monthlyRemaining: round2(Math.max(0, limits.monthly - spent)) },
    order: order ? orderView(order) : null,
    resultMessage: action.errorMessage ?? result?.message ?? null,
    priceChanged: action.status === "PENDING" ? payload.priceChanged : null,
  };
}

async function loadPurchase(userId: string, actionId: string): Promise<AgentAction> {
  if (!isUuid(actionId)) throw Errors.notFound("La compra");
  const action = await prisma.agentAction.findFirst({ where: { id: actionId, userId, type: "PURCHASE" } });
  if (!action) throw Errors.notFound("La compra");
  return action;
}

export async function getCheckout(userId: string, actionId: string, now = new Date()): Promise<CheckoutView> {
  return checkoutView(userId, await loadPurchase(userId, actionId), now);
}

/**
 * Prepara la compra de un producto que Omni sigue (desde una alerta, la lista o el chat). No cobra nada:
 * deja la cotización lista para que el usuario la Permita o la Deniegue en la hoja de pago.
 */
export async function startCheckout(
  userId: string,
  input: { itemId: string; quantity?: number; alertId?: string | null; conversationId?: string | null; actor: "user" | "agent" },
  now = new Date(),
): Promise<CheckoutView> {
  if (!isUuid(input.itemId)) throw Errors.notFound("El producto");
  const item = await prisma.watchlistItem.findFirst({ where: { id: input.itemId, userId } });
  if (!item) throw Errors.notFound("El producto");
  if (item.status === "PURCHASED") throw Errors.conflict("Ya compraste esto. Míralo en Compras → Pedidos.");
  if (item.status === "ARCHIVED") throw Errors.conflict("Ya no sigues este producto.");
  if (!item.url || item.source === "manual") {
    throw Errors.badRequest("Para comprar necesito el enlace de la tienda: pégalo en Compras y lo sigo desde ahí.");
  }
  if (item.currentPrice === null) throw Errors.conflict("Todavía no tengo el precio de este producto.");
  if (item.inStock === false) throw Errors.conflict("Está agotado. Te aviso cuando vuelva y baje.");

  const meta = readItemMeta(item.metadata);
  const quantity = Math.max(1, Math.min(10, Math.floor(input.quantity ?? meta.quantity)));

  // Si ya hay una compra pendiente de este producto, se reutiliza (o se reemplaza si cambió la cantidad).
  const pending = await prisma.agentAction.findMany({ where: { userId, type: "PURCHASE", status: "PENDING" }, orderBy: { createdAt: "desc" } });
  for (const action of pending) {
    const payload = readPayload(action);
    if (payload.watchlistItemId !== item.id) continue;
    const alive = !action.expiresAt || action.expiresAt > now;
    if (alive && payload.quantity === quantity) {
      if (input.alertId && isUuid(input.alertId)) {
        await prisma.priceAlert.updateMany({ where: { id: input.alertId, userId }, data: { status: "ACTED", actionId: action.id } });
      }
      return checkoutView(userId, action, now);
    }
    await prisma.agentAction.updateMany({ where: { id: action.id, status: "PENDING" }, data: { status: "EXPIRED" } });
  }

  const quote = buildQuote({
    unitPrice: Number(item.currentPrice),
    quantity,
    currency: item.currency,
    kind: item.kind as WatchKindId,
    fees: feesFor(item),
    offerShipping: meta.shipping,
  });
  const limits = await getPurchaseLimits(userId);
  if (item.currency === limits.currency) {
    const check = checkLimits(quote.total, { ...limits, spentThisMonth: await spentThisMonth(userId, limits.currency, now) });
    if (!check.ok) throw new AppError(409, "purchase_limit", check.message);
  }

  const alert =
    input.alertId && isUuid(input.alertId) ? await prisma.priceAlert.findFirst({ where: { id: input.alertId, userId, itemId: item.id } }) : null;
  const card = await proposeAction({
    userId,
    conversationId: input.conversationId ?? null,
    module: "CONCIERGE",
    type: "PURCHASE",
    title: quantity > 1 ? `${item.title} (×${quantity})` : item.title,
    summary: alert
      ? purchaseReason({
          dropPct: alert.dropPct,
          referencePrice: alert.referencePrice === null ? null : Number(alert.referencePrice),
          reasons: alert.reasons,
          targetPrice: item.targetPrice === null ? null : Number(item.targetPrice),
          currency: alert.currency,
        })
      : null,
    merchant: item.merchant,
    amount: quote.total,
    currency: item.currency,
    lines: slipLines(quote),
    payload: {
      watchlistItemId: item.id,
      alertId: alert?.id ?? null,
      quantity,
      unitPrice: quote.unitPrice,
      total: quote.total,
      currency: item.currency,
      kind: item.kind,
      quoteLines: quote.lines,
      complete: quote.complete,
      version: 1,
      priceChanged: null,
    },
    ttlHours: CHECKOUT_TTL_HOURS,
    // Si el usuario tocó "Comprar", no hace falta avisarle; si lo propuso Omni en el chat, sí.
    notify: input.actor === "agent",
    now,
  });
  if (alert) await prisma.priceAlert.update({ where: { id: alert.id }, data: { status: "ACTED", actionId: card.actionId } });
  await audit({ userId, actor: input.actor, action: "purchase.checkout", entity: "agent_action", entityId: card.actionId, metadata: { itemId: item.id, total: quote.total } });
  return getCheckout(userId, card.actionId, now);
}

export type Decision = { decision: "allow" | "deny"; quoteId?: string | null; methodId?: string | null };

/** La decisión del usuario en la hoja de pago. Permitir cobra (simulado) y crea el pedido; Denegar no hace nada más. */
export async function authorizeCheckout(userId: string, actionId: string, input: Decision, now = new Date()): Promise<CheckoutView> {
  const action = await loadPurchase(userId, actionId);
  if (action.status !== "PENDING") {
    if (input.decision === "allow" && action.status === "EXECUTED") return checkoutView(userId, action, now);
    throw Errors.conflict("Esta compra ya fue decidida.");
  }
  if (action.expiresAt && action.expiresAt < now) {
    await prisma.agentAction.updateMany({ where: { id: actionId, status: "PENDING" }, data: { status: "EXPIRED" } });
    throw Errors.conflict("Esta autorización venció. Prepara la compra de nuevo para ver el precio de hoy.");
  }

  if (input.decision === "deny") {
    const claimed = await prisma.agentAction.updateMany({
      where: { id: actionId, userId, status: "PENDING" },
      data: { status: "REJECTED", decidedAt: now, result: { message: "Denegaste la compra. No se cobró nada y sigo vigilando el precio." } },
    });
    if (claimed.count === 0) throw Errors.conflict("Esta compra ya fue decidida.");
    await audit({ userId, actor: "user", action: "purchase.denied", entity: "agent_action", entityId: actionId });
    return getCheckout(userId, actionId, now);
  }

  // ── Permitir ──
  const payload = readPayload(action);
  if (!input.quoteId || !sameDigest(input.quoteId, quoteIdOf(action.id, payload))) {
    throw new AppError(409, "quote_changed", "El total cambió desde que abriste la hoja de pago. Revísalo y vuelve a permitir.", {
      checkout: await checkoutView(userId, action, now),
    });
  }
  const methods = paymentProvider().methods();
  const method = methods.find((m) => m.id === input.methodId);
  if (!method) throw Errors.badRequest("Elige un medio de pago.");

  const item = payload.watchlistItemId && isUuid(payload.watchlistItemId)
    ? await prisma.watchlistItem.findFirst({ where: { id: payload.watchlistItemId, userId } })
    : null;
  if (!item || !item.url || item.status === "ARCHIVED") throw Errors.conflict("Ya no sigues este producto; no se cobró nada.");
  if (item.status === "PURCHASED") throw Errors.conflict("Ya compraste este producto; no se cobró nada.");

  // Precio de ahora mismo en la tienda: nunca se cobra más de lo autorizado.
  const meta = readItemMeta(item.metadata);
  const fresh = await readPrice(item.url, {
    userId,
    now,
    flash: item.source === "sandbox" ? meta.flash : null,
    ai: meta.method === "ai" ? "if_needed" : "never",
    fallbackCurrency: item.currency,
  });
  if (!fresh.ok) {
    throw new AppError(409, "price_unverified", `No pude confirmar el precio con la tienda (${fresh.message}) No se cobró nada; inténtalo de nuevo.`);
  }
  const offer = fresh.reading.offer;
  if (offer.inStock === false) throw Errors.conflict("Se agotó justo ahora. No se cobró nada; te aviso si vuelve.");
  if (offer.currency !== payload.currency) throw Errors.conflict("La tienda cambió de moneda. No se cobró nada.");

  const quote = buildQuote({
    unitPrice: offer.price,
    quantity: payload.quantity,
    currency: payload.currency,
    kind: payload.kind,
    fees: feesFor(item),
    offerShipping: offer.shipping ?? meta.shipping,
  });
  await prisma.pricePoint.create({
    data: { itemId: item.id, price: offer.price, currency: offer.currency, inStock: offer.inStock, source: offer.method, checkedAt: now },
  });

  if (quote.total > payload.total + 0.005) {
    const stored = (action.payload ?? {}) as Record<string, unknown>;
    const next = {
      ...stored,
      unitPrice: quote.unitPrice,
      total: quote.total,
      quoteLines: quote.lines,
      complete: quote.complete,
      version: payload.version + 1,
      priceChanged: { from: payload.total, to: quote.total },
      lines: slipLines(quote),
    };
    const updated = await prisma.agentAction.update({
      where: { id: action.id },
      data: { amount: quote.total, payload: next as unknown as Prisma.InputJsonValue },
    });
    await prisma.watchlistItem.update({ where: { id: item.id }, data: { currentPrice: offer.price, lastCheckedAt: now } });
    throw new AppError(
      409,
      "price_changed",
      `El precio subió: ahora el total es ${money(quote.total, quote.currency, { cents: true })} (antes ${money(payload.total, payload.currency, { cents: true })}). No se cobró nada; revisa y vuelve a permitir si te sirve.`,
      { checkout: await checkoutView(userId, updated, now) },
    );
  }

  const limits = await getPurchaseLimits(userId);
  if (payload.currency === limits.currency) {
    const check = checkLimits(quote.total, { ...limits, spentThisMonth: await spentThisMonth(userId, limits.currency, now) });
    if (!check.ok) throw new AppError(409, "purchase_limit", check.message);
  }

  // Reclamo atómico: un doble toque (o dos dispositivos) no cobra dos veces.
  const claimed = await prisma.agentAction.updateMany({
    where: { id: actionId, userId, status: "PENDING" },
    data: { status: "APPROVED", decidedAt: now },
  });
  if (claimed.count === 0) throw Errors.conflict("Esta compra ya fue decidida.");
  await audit({ userId, actor: "user", action: "purchase.allowed", entity: "agent_action", entityId: actionId, metadata: { total: quote.total, method: method.id } });

  const profile = await prisma.profile.findUnique({ where: { id: userId }, select: { timezone: true } });
  const fees = feesFor(item);
  const delivery = await deliveryText(userId, payload.kind, fees, now, profile?.timezone ?? "UTC");
  const charge = await paymentProvider().charge({
    methodId: method.id,
    amount: quote.total,
    currency: quote.currency,
    idempotencyKey: action.id,
    description: item.title,
  });
  const base = {
    userId,
    itemId: item.id,
    actionId: action.id,
    kind: item.kind,
    title: payload.quantity > 1 ? `${item.title} (×${payload.quantity})` : item.title,
    merchant: item.merchant,
    quantity: payload.quantity,
    unitPrice: quote.unitPrice,
    shipping: quote.lines.find((l) => l.label === "Envío")?.amount ?? 0,
    tax: round2(quote.lines.filter((l) => l.label !== "Envío" && l !== quote.lines[0]).reduce((sum, l) => sum + l.amount, 0)),
    total: quote.total,
    currency: quote.currency,
    paymentProvider: "sandbox",
    paymentLabel: paymentLabel(method),
    createdAt: now,
  };

  if (charge.status === "declined") {
    await prisma.purchaseOrder.create({
      data: { ...base, status: "FAILED", failureReason: charge.reason, details: { lines: quote.lines } as unknown as Prisma.InputJsonValue },
    });
    await prisma.agentAction.update({ where: { id: actionId }, data: { status: "FAILED", errorMessage: `${charge.reason} No se hizo el pedido.` } });
    await audit({ userId, actor: "system", action: "purchase.declined", entity: "agent_action", entityId: actionId });
    return getCheckout(userId, actionId, now);
  }

  const number = orderNumber(orderPrefix(item), action.id);
  // Ahorro frente al precio normal (el de la alerta o, si no vino de una, la mediana de 30 días del historial).
  // Lo muestra el panel de Inicio como "ahorro con Omni".
  const reference = await normalPriceFor(userId, item.id, payload.alertId, now);
  const savings = reference !== null && reference > quote.unitPrice ? round2((reference - quote.unitPrice) * payload.quantity) : 0;
  const order = await prisma.purchaseOrder.create({
    data: {
      ...base,
      status: "PLACED",
      paymentRef: charge.reference,
      orderNumber: number,
      details: {
        lines: quote.lines,
        delivery: delivery ? { label: delivery.label, detail: delivery.detail, eta: delivery.eta?.toISOString() ?? null } : null,
        referencePrice: reference,
        savings,
      } as unknown as Prisma.InputJsonValue,
    },
  });
  const saved = round2(payload.total - quote.total);
  const message =
    saved > 0
      ? `Pedido ${number} confirmado: pagaste ${money(quote.total, quote.currency, { cents: true })} (bajó ${money(saved, quote.currency, { cents: true })} más desde que lo autorizaste). Simulado: no se cobró de verdad.`
      : `Pedido ${number} confirmado por ${money(quote.total, quote.currency, { cents: true })}. Simulado: no se cobró de verdad.`;
  await prisma.agentAction.update({
    where: { id: actionId },
    data: {
      status: "EXECUTED",
      executedAt: now,
      amount: quote.total,
      result: { message, orderId: order.id, orderNumber: number, mode: "simulated" } as Prisma.InputJsonValue,
    },
  });
  await prisma.watchlistItem.update({
    where: { id: item.id },
    data: { status: "PURCHASED", nextCheckAt: null, currentPrice: offer.price, lastCheckedAt: now },
  });
  await prisma.appNotification.create({
    data: {
      userId,
      type: "SYSTEM",
      title: `Pedido confirmado: ${item.title}`,
      body: `${money(quote.total, quote.currency, { cents: true })} con ${paymentLabel(method)} (simulado).`,
      href: `/compras?pedido=${order.id}`,
      data: { orderId: order.id },
    },
  });
  await audit({ userId, actor: "system", action: "purchase.placed", entity: "purchase_order", entityId: order.id, metadata: { total: quote.total } });
  return getCheckout(userId, actionId, now);
}

async function normalPriceFor(userId: string, itemId: string, alertId: string | null, now: Date): Promise<number | null> {
  if (alertId && isUuid(alertId)) {
    const alert = await prisma.priceAlert.findFirst({ where: { id: alertId, userId }, select: { referencePrice: true } });
    if (alert?.referencePrice !== null && alert?.referencePrice !== undefined) return Number(alert.referencePrice);
  }
  const points = await prisma.pricePoint.findMany({
    where: { itemId, checkedAt: { gte: new Date(now.getTime() - 31 * 86_400_000), lte: now } },
    select: { price: true, checkedAt: true, inStock: true },
  });
  const reference = referenceOf(toHistory(points), now);
  return reference.kind === "median30" ? reference.price : null;
}

/** Compras preparadas que esperan Permitir o Denegar. */
export async function pendingCheckouts(userId: string, now = new Date()): Promise<CheckoutView[]> {
  const actions = await prisma.agentAction.findMany({
    where: { userId, type: "PURCHASE", status: "PENDING", OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
    orderBy: { createdAt: "desc" },
    take: 10,
  });
  return Promise.all(actions.map((action) => checkoutView(userId, action, now)));
}

export async function checkoutsByIds(userId: string, ids: string[], now = new Date()): Promise<Map<string, CheckoutView>> {
  const valid = ids.filter(isUuid);
  if (valid.length === 0) return new Map();
  const actions = await prisma.agentAction.findMany({ where: { userId, type: "PURCHASE", id: { in: valid } } });
  const views = await Promise.all(actions.map((action) => checkoutView(userId, action, now)));
  return new Map(views.map((v) => [v.actionId, v]));
}
