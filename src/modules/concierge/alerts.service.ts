import "server-only";
import type { PriceAlert, WatchlistItem } from "@/generated/prisma/client";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { Errors } from "@/lib/errors";
import { money } from "@/lib/format";
import { isUuid } from "@/lib/validation";
import type { PriceAlertView, WatchKindId } from "@/types/cards";
import { writeAlertWithClaude } from "./ai";
import { rulesAlertText, type AlertFacts } from "./rules/alert-copy";
import type { DropAnalysis, HistoryPoint } from "./rules/drops";
import { alertView, sparkOf, type PointRow } from "./views";

// Alertas inteligentes: cuando el agente detecta una bajada drástica (o el precio objetivo), crea la alerta con un
// resumen (Claude validado o reglas), avisa en la app y deja la compra a un toque (que abre la hoja de pago).

const DAY = 86_400_000;
export const ALERT_TTL_HOURS = 72;
const OPEN = ["NEW", "SEEN", "ACTED"] as const;

export async function pointsFor(itemIds: string[], since: Date): Promise<Map<string, PointRow[]>> {
  const map = new Map<string, PointRow[]>();
  if (itemIds.length === 0) return map;
  const rows = await prisma.pricePoint.findMany({
    where: { itemId: { in: itemIds }, checkedAt: { gte: since } },
    orderBy: { checkedAt: "asc" },
    select: { itemId: true, price: true, checkedAt: true, inStock: true },
  });
  for (const row of rows) {
    const list = map.get(row.itemId) ?? [];
    list.push(row);
    map.set(row.itemId, list);
  }
  return map;
}

export function alertFactsFor(item: WatchlistItem, analysis: DropAnalysis, reading: { price: number; currency: string; inStock: boolean | null; stockCount: number | null }, history: HistoryPoint[], now: Date): AlertFacts {
  return {
    title: item.title,
    merchant: item.merchant,
    kind: item.kind as WatchKindId,
    currency: reading.currency,
    price: reading.price,
    previousPrice: analysis.previousPrice,
    referencePrice: analysis.referencePrice,
    referenceKind: analysis.referenceKind,
    dropPct: analysis.dropPct,
    lowestBefore: analysis.lowestBefore,
    isLowest: analysis.isLowest,
    hitsTarget: analysis.hitsTarget,
    targetPrice: item.targetPrice === null ? null : Number(item.targetPrice),
    reasons: analysis.reasons,
    inStock: reading.inStock,
    stockCount: reading.stockCount,
    daysTracked: Math.max(1, Math.round((now.getTime() - item.createdAt.getTime()) / DAY)),
    recent: sparkOf(history, now, 30),
    verdict: analysis.verdict,
  };
}

export async function createPriceAlert(input: {
  item: WatchlistItem;
  analysis: DropAnalysis;
  reading: { price: number; currency: string; inStock: boolean | null; stockCount: number | null };
  history: HistoryPoint[];
  now: Date;
  /** Redactar con Claude (Pro). Si es false o Claude falla, se usa el texto por reglas. */
  writeWithAI: boolean;
}): Promise<PriceAlert> {
  const { item, analysis, reading, now } = input;
  const facts = alertFactsFor(item, analysis, reading, input.history, now);
  const ai = input.writeWithAI ? await writeAlertWithClaude(item.userId, facts) : null;
  const text = ai ?? rulesAlertText(facts);

  // Una alerta abierta por producto: la anterior queda vencida (salvo que ya tenga una compra en curso).
  await prisma.priceAlert.updateMany({
    where: { itemId: item.id, status: { in: ["NEW", "SEEN"] } },
    data: { status: "EXPIRED" },
  });
  const alert = await prisma.priceAlert.create({
    data: {
      userId: item.userId,
      itemId: item.id,
      price: reading.price,
      previousPrice: analysis.previousPrice,
      referencePrice: analysis.referencePrice,
      currency: reading.currency,
      dropPct: analysis.dropPct,
      reasons: analysis.reasons,
      headline: text.headline.slice(0, 120),
      summary: text.summary.slice(0, 500),
      verdict: text.verdict,
      source: ai ? "AI" : "RULES",
      expiresAt: new Date(now.getTime() + ALERT_TTL_HOURS * 3_600_000),
      createdAt: now,
    },
  });

  await prisma.appNotification.create({
    data: {
      userId: item.userId,
      type: "PRICE_DROP",
      title: alert.headline,
      body: alert.summary.length > 280 ? `${alert.summary.slice(0, 277)}…` : alert.summary,
      href: `/compras?alerta=${alert.id}`,
      data: { alertId: alert.id, itemId: item.id, price: reading.price },
    },
  });
  await prisma.suggestion.upsert({
    where: { userId_dedupeKey: { userId: item.userId, dedupeKey: `price-drop:${item.id}` } },
    create: {
      userId: item.userId,
      module: "CONCIERGE",
      type: "PRICE_DROP",
      title: alert.headline,
      body: alert.summary,
      prompt: `Prepara la compra de “${item.title}” si sigue en ${money(reading.price, reading.currency, { cents: true })} o menos.`,
      dedupeKey: `price-drop:${item.id}`,
      expiresAt: alert.expiresAt,
    },
    update: { status: "NEW", title: alert.headline, body: alert.summary, expiresAt: alert.expiresAt },
  });
  await audit({
    userId: item.userId,
    actor: "agent",
    action: "price.alert",
    entity: "price_alert",
    entityId: alert.id,
    metadata: { itemId: item.id, price: reading.price, dropPct: analysis.dropPct, source: alert.source },
  });
  return alert;
}

async function viewsFor(userId: string, alerts: PriceAlert[], now: Date): Promise<PriceAlertView[]> {
  if (alerts.length === 0) return [];
  const itemIds = [...new Set(alerts.map((a) => a.itemId))];
  const actionIds = alerts.map((a) => a.actionId).filter((id): id is string => Boolean(id));
  const [items, points, actions] = await Promise.all([
    prisma.watchlistItem.findMany({ where: { id: { in: itemIds }, userId } }),
    pointsFor(itemIds, new Date(now.getTime() - 30 * DAY)),
    actionIds.length ? prisma.agentAction.findMany({ where: { id: { in: actionIds }, userId }, select: { id: true, status: true } }) : Promise.resolve([]),
  ]);
  const itemById = new Map(items.map((i) => [i.id, i]));
  const actionById = new Map(actions.map((a) => [a.id, a]));
  return alerts.flatMap((alert) => {
    const item = itemById.get(alert.itemId);
    if (!item) return [];
    return [alertView(alert, item, points.get(item.id) ?? [], alert.actionId ? (actionById.get(alert.actionId) ?? null) : null, now)];
  });
}

/** Ofertas detectadas en los últimos 7 días que siguen abiertas (o con la compra en curso). */
export async function listAlertViews(userId: string, now = new Date(), take = 12): Promise<PriceAlertView[]> {
  const alerts = await prisma.priceAlert.findMany({
    where: { userId, status: { in: [...OPEN] }, createdAt: { gte: new Date(now.getTime() - 7 * DAY) } },
    orderBy: { createdAt: "desc" },
    take,
  });
  return viewsFor(userId, alerts, now);
}

export async function alertViewsByIds(userId: string, ids: string[], now = new Date()): Promise<Map<string, PriceAlertView>> {
  const valid = ids.filter(isUuid);
  if (valid.length === 0) return new Map();
  const alerts = await prisma.priceAlert.findMany({ where: { userId, id: { in: valid } } });
  const views = await viewsFor(userId, alerts, now);
  return new Map(views.map((v) => [v.id, v]));
}

export async function getAlertView(userId: string, alertId: string, now = new Date()): Promise<PriceAlertView> {
  const view = (await alertViewsByIds(userId, [alertId], now)).get(alertId);
  if (!view) throw Errors.notFound("La alerta");
  return view;
}

export async function countNewAlerts(userId: string): Promise<number> {
  return prisma.priceAlert.count({ where: { userId, status: "NEW" } });
}

export async function markAlertsSeen(userId: string, now = new Date()): Promise<void> {
  await prisma.priceAlert.updateMany({ where: { userId, status: "NEW" }, data: { status: "SEEN", seenAt: now } });
}

export async function dismissAlert(userId: string, alertId: string, now = new Date()): Promise<PriceAlertView> {
  if (!isUuid(alertId)) throw Errors.notFound("La alerta");
  const alert = await prisma.priceAlert.findFirst({ where: { id: alertId, userId } });
  if (!alert) throw Errors.notFound("La alerta");
  if (alert.status === "NEW" || alert.status === "SEEN") {
    await prisma.priceAlert.update({ where: { id: alertId }, data: { status: "DISMISSED" } });
    await prisma.suggestion.updateMany({
      where: { userId, dedupeKey: `price-drop:${alert.itemId}`, status: "NEW" },
      data: { status: "DISMISSED" },
    });
  }
  return getAlertView(userId, alertId, now);
}

/** Vence las alertas viejas (el precio pudo cambiar): las usa el cron. */
export async function expireStaleAlerts(now = new Date()): Promise<number> {
  const result = await prisma.priceAlert.updateMany({
    where: { status: { in: ["NEW", "SEEN"] }, expiresAt: { lt: now } },
    data: { status: "EXPIRED" },
  });
  return result.count;
}

/** Para el aviso de que un seguimiento se pausó o se bloqueó. */
export async function notifyTrackingProblem(item: WatchlistItem, title: string, body: string): Promise<void> {
  await prisma.appNotification.create({
    data: { userId: item.userId, type: "SYSTEM", title, body, href: `/compras?producto=${item.id}`, data: { itemId: item.id } },
  });
}
