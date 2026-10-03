import "server-only";
import type { WatchlistItem } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import type { ConciergeSettingsView, CheckoutView, OrderView, PriceAlertView, TrackedItemView, TrackingCard } from "@/types/cards";
import { countNewAlerts, listAlertViews } from "./alerts.service";
import { pendingCheckouts } from "./checkout.service";
import { getConciergeSettings } from "./settings.service";
import { listOrderViews, listTrackedViews } from "./tracking.service";

// Punto de entrada del módulo de compras para las páginas y la navegación.

const num = (value: { toString(): string } | null) => (value === null ? null : Number(value));

/** Tarjeta de seguimiento de versiones anteriores (mensajes viejos del chat). */
export function toTrackingCard(item: WatchlistItem): TrackingCard {
  return {
    kind: "tracking",
    itemId: item.id,
    title: item.title,
    merchant: item.merchant,
    url: item.url,
    currency: item.currency,
    currentPrice: num(item.currentPrice),
    targetPrice: num(item.targetPrice),
    lowestPrice: num(item.lowestPrice),
    dropAlertPct: item.dropAlertPct,
  };
}

export async function listTracking(userId: string) {
  return prisma.watchlistItem.findMany({
    where: { userId, status: { in: ["ACTIVE", "PAUSED"] } },
    orderBy: { createdAt: "desc" },
  });
}

export async function countTracking(userId: string): Promise<number> {
  return prisma.watchlistItem.count({ where: { userId, status: "ACTIVE" } });
}

/** Ofertas nuevas sin ver más compras esperando Permitir/Denegar (para el contador de Compras). */
export async function conciergeBadge(userId: string): Promise<number> {
  const [alerts, checkouts] = await Promise.all([
    countNewAlerts(userId),
    prisma.agentAction.count({ where: { userId, type: "PURCHASE", status: "PENDING", OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] } }),
  ]);
  return alerts + checkouts;
}

export type ConciergePageData = {
  items: TrackedItemView[];
  alerts: PriceAlertView[];
  checkouts: CheckoutView[];
  orders: OrderView[];
  settings: ConciergeSettingsView;
};

export async function getConciergePage(userId: string, now = new Date()): Promise<ConciergePageData> {
  const [items, alerts, checkouts, orders, settings] = await Promise.all([
    listTrackedViews(userId, now),
    listAlertViews(userId, now),
    pendingCheckouts(userId, now),
    listOrderViews(userId),
    getConciergeSettings(userId, now),
  ]);
  return { items, alerts, checkouts, orders, settings };
}
