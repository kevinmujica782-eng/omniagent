// Filas de la base de datos → modelos de vista del módulo de compras (sin consultas: funciones puras).
import type { AgentAction, PriceAlert, PurchaseOrder, WatchlistItem } from "@/generated/prisma/client";
import type { ActionState, OrderView, PriceAlertReasonId, PriceAlertView, TrackedItemView, WatchKindId } from "@/types/cards";
import { hostOf, readItemMeta } from "./item-meta";
import { dailyCloses, referenceOf, type HistoryPoint } from "./rules/drops";
import { PAUSE_AFTER_FAILURES } from "./rules/schedule";

const DAY = 86_400_000;
const num = (value: { toString(): string } | number | null | undefined) => (value === null || value === undefined ? null : Number(value));

/** Lectura de precio (fila de price_points o dato de ejemplo): el precio puede venir como Decimal o número. */
export type PointRow = { price: number | { toString(): string }; checkedAt: Date; inStock: boolean | null };

export function toHistory(points: PointRow[]): HistoryPoint[] {
  return points
    .map((p) => ({ price: Number(p.price), at: new Date(p.checkedAt), inStock: p.inStock }))
    .sort((a, b) => a.at.getTime() - b.at.getTime());
}

/** Un precio por día de los últimos `days` días (para la minigráfica). */
export function sparkOf(history: HistoryPoint[], now: Date, days = 30): number[] {
  return dailyCloses(history.filter((p) => p.at.getTime() >= now.getTime() - days * DAY)).map((p) => p.price);
}

export function healthOf(item: Pick<WatchlistItem, "status" | "failCount" | "metadata">): TrackedItemView["health"] {
  const meta = readItemMeta(item.metadata);
  if (meta.blocked) return "blocked";
  if (item.status === "PAUSED" && item.failCount >= PAUSE_AFTER_FAILURES) return "paused";
  if (item.failCount >= 3) return "failing";
  if (item.failCount > 0) return "retrying";
  return "ok";
}

export function trackedItemView(item: WatchlistItem, points: PointRow[], now: Date): TrackedItemView {
  const meta = readItemMeta(item.metadata);
  const history = toHistory(points);
  const previous = history.slice(0, -1);
  const reference = referenceOf(previous, now).price ?? (history.length > 1 ? history[0].price : null);
  const current = num(item.currentPrice);
  const prices = history.map((p) => p.price);
  return {
    id: item.id,
    kind: item.kind as WatchKindId,
    status: item.status,
    title: item.title,
    merchant: item.merchant,
    url: item.url,
    host: meta.host ?? hostOf(item.url),
    source: item.source === "sandbox" || item.source === "web" ? item.source : "manual",
    method: meta.method,
    currency: item.currency,
    currentPrice: current,
    referencePrice: reference,
    changePct: current !== null && reference ? Math.round(((current - reference) / reference) * 100) : null,
    lowestPrice: num(item.lowestPrice) ?? (prices.length ? Math.min(...prices) : null),
    highestPrice: prices.length ? Math.max(...prices) : null,
    targetPrice: num(item.targetPrice),
    dropAlertPct: item.dropAlertPct,
    quantity: meta.quantity,
    inStock: item.inStock,
    stockCount: meta.stockCount,
    detail: meta.detail,
    eventDate: meta.eventDate,
    lastCheckedAt: item.lastCheckedAt?.toISOString() ?? null,
    nextCheckAt: item.status === "ACTIVE" && item.source !== "manual" ? (item.nextCheckAt?.toISOString() ?? null) : null,
    checkEveryMinutes: item.checkEveryMinutes,
    health: healthOf(item),
    lastError: item.lastError,
    spark: sparkOf(history, now),
    createdAt: item.createdAt.toISOString(),
  };
}

export function alertView(
  alert: PriceAlert,
  item: WatchlistItem,
  points: PointRow[],
  action: Pick<AgentAction, "status"> | null,
  now: Date,
): PriceAlertView {
  const meta = readItemMeta(item.metadata);
  const price = Number(alert.price);
  const reference = num(alert.referencePrice);
  return {
    id: alert.id,
    itemId: alert.itemId,
    status: alert.status,
    kind: item.kind as WatchKindId,
    title: item.title,
    merchant: item.merchant,
    detail: meta.detail,
    headline: alert.headline,
    summary: alert.summary,
    verdict: alert.verdict === "buy" || alert.verdict === "wait" ? alert.verdict : null,
    source: alert.source,
    reasons: alert.reasons.filter((r): r is PriceAlertReasonId => r === "DROP" || r === "TARGET" || r === "LOWEST"),
    currency: alert.currency,
    price,
    previousPrice: num(alert.previousPrice),
    referencePrice: reference,
    lowestPrice: num(item.lowestPrice),
    targetPrice: num(item.targetPrice),
    dropPct: alert.dropPct,
    savings: reference !== null && reference > price ? Math.round((reference - price) * 100) / 100 : null,
    inStock: item.inStock,
    stockCount: meta.stockCount,
    spark: sparkOf(toHistory(points), now),
    createdAt: alert.createdAt.toISOString(),
    expiresAt: alert.expiresAt?.toISOString() ?? null,
    actionId: alert.actionId,
    actionStatus: (action?.status as ActionState | undefined) ?? null,
  };
}

type OrderDetails = { delivery?: { label?: string; detail?: string | null; eta?: string | null } };

export function orderView(order: PurchaseOrder): OrderView {
  const details = (order.details ?? {}) as OrderDetails;
  const delivery = details.delivery?.label ? { label: details.delivery.label, detail: details.delivery.detail ?? null } : null;
  return {
    id: order.id,
    status: order.status,
    orderNumber: order.orderNumber,
    kind: order.kind as WatchKindId,
    title: order.title,
    merchant: order.merchant,
    quantity: order.quantity,
    total: Number(order.total),
    currency: order.currency,
    paymentLabel: order.paymentLabel,
    delivery,
    failureReason: order.failureReason,
    sandbox: order.paymentProvider === "sandbox",
    createdAt: order.createdAt.toISOString(),
  };
}
