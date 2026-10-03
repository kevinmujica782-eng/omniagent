import "server-only";
import type { Prisma, WatchlistItem } from "@/generated/prisma/client";
import type { WatchKind } from "@/generated/prisma/enums";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { AppError, Errors } from "@/lib/errors";
import { isUuid } from "@/lib/validation";
import { clockTime } from "@/modules/procedures/time/es-dates";
import { getEntitlements, planLimitError, type Entitlements } from "@/modules/billing/entitlements";
import type { OrderView, PriceAlertView, ProductPreviewView, TrackedItemView, WatchKindId } from "@/types/cards";
import { aiConfigured } from "./ai";
import { pointsFor } from "./alerts.service";
import { checkItem } from "./checker";
import { hostOf, readItemMeta, type ItemMeta } from "./item-meta";
import { canCheckNow, nextCheckAt } from "./rules/schedule";
import {
  findSandboxProduct,
  sandboxHistory,
  sandboxQuote,
  sandboxUrl,
  searchSandbox,
  storeOf,
  type SandboxProduct,
} from "./sandbox/stores";
import { checkUrl } from "./scraper/net-policy";
import { readPrice } from "./sources";
import { alertView, orderView, sparkOf, toHistory, trackedItemView } from "./views";

// Seguimientos: pegar un enlace (o elegir un resultado de las tiendas de prueba), ver la vista previa,
// seguirlo con un precio objetivo y una sensibilidad, revisarlo ahora, pausarlo o dejar de seguirlo.

const DAY = 86_400_000;
const PREVIEWS_PER_HOUR = 30;

/** Límite de precios activos del plan (402 con detalle para ofrecer Pro solo en el plan Gratis). */
function watchlistLimit(entitlements: Entitlements) {
  const max = entitlements.limits.watchlistItems;
  return planLimitError(
    entitlements,
    "watchlist",
    entitlements.plan === "FREE"
      ? `Tu plan permite seguir ${max} precios a la vez. Pausa uno o pásate a Pro.`
      : "Llegaste al máximo de precios que puedes seguir a la vez. Pausa o archiva alguno.",
    { limit: max },
  );
}

async function profileOf(userId: string) {
  const profile = await prisma.profile.findUnique({ where: { id: userId }, select: { currency: true, timezone: true } });
  return { currency: profile?.currency ?? "USD", timezone: profile?.timezone ?? "UTC" };
}

// ─── Vista previa y búsqueda ─────────────────────────────────────────────

function sandboxPreview(product: SandboxProduct, now: Date): ProductPreviewView {
  const store = storeOf(product);
  const quote = sandboxQuote(product, now);
  const url = sandboxUrl(product);
  const method = store.style === "plain" ? null : store.style === "meta" ? "meta" : store.style === "microdata" ? "microdata" : "jsonld";
  return {
    url,
    host: store.host,
    source: "sandbox",
    title: product.title,
    merchant: store.name,
    kind: product.kind,
    price: quote.price,
    currency: product.currency,
    inStock: quote.inStock,
    stockCount: quote.stockCount,
    method,
    detail: product.detail ?? null,
    eventDate: product.eventDate ? product.eventDate(now).toISOString() : null,
    spark: sandboxHistory(product, now, 30).map((p) => p.price),
    warnings: store.style === "plain" ? ["Esta tienda no publica datos de producto: el precio se lee con IA."] : [],
    blocked: store.blocksBots
      ? { reason: "robots", message: "Esta tienda no permite revisiones automáticas (robots.txt)." }
      : null,
    canReadWithAI: store.style === "plain" && aiConfigured(),
  };
}

/** Resultados de las tiendas de prueba (productos, boletos, un vuelo y un hotel). */
export function searchOffers(query: string, now = new Date(), limit = 6): ProductPreviewView[] {
  return searchSandbox(query, limit).map((product) => sandboxPreview(product, now));
}

async function assertPreviewRate(userId: string, now: Date) {
  const recent = await prisma.auditLog.count({
    where: { userId, action: "concierge.preview", createdAt: { gte: new Date(now.getTime() - 3_600_000) } },
  });
  if (recent >= PREVIEWS_PER_HOUR) throw new AppError(429, "rate_limited", "Revisaste muchos enlaces en la última hora. Espera un poco.");
}

/** Lee un enlace sin seguirlo todavía: qué es, cuánto cuesta y si se puede revisar automáticamente. */
export async function previewLink(userId: string, rawUrl: string, opts: { useAI?: boolean; now?: Date } = {}): Promise<ProductPreviewView> {
  const now = opts.now ?? new Date();
  const check = checkUrl(rawUrl);
  const base = (url: string, host: string, source: "sandbox" | "web"): ProductPreviewView => ({
    url,
    host,
    source,
    title: null,
    merchant: null,
    kind: "PRODUCT",
    price: null,
    currency: null,
    inStock: null,
    stockCount: null,
    method: null,
    detail: null,
    eventDate: null,
    spark: [],
    warnings: [],
    blocked: null,
    canReadWithAI: false,
  });
  if (!check.ok) return { ...base(rawUrl.slice(0, 300), "", "web"), blocked: { reason: check.reason, message: check.message } };
  await assertPreviewRate(userId, now);
  await audit({ userId, actor: "user", action: "concierge.preview", metadata: { host: check.url.hostname } });

  const url = check.url.toString();
  const product = check.sandbox ? findSandboxProduct(check.url) : null;
  const { currency } = await profileOf(userId);
  const outcome = await readPrice(url, { userId, now, ai: opts.useAI ? "if_needed" : "never", fallbackCurrency: currency });
  const view = base(url, check.url.hostname, check.sandbox ? "sandbox" : "web");
  if (!outcome.ok) {
    return {
      ...view,
      title: outcome.facts?.title ?? product?.title ?? null,
      merchant: outcome.facts?.siteName ?? (product ? storeOf(product).name : null),
      kind: product?.kind ?? "PRODUCT",
      blocked: outcome.code === "no_price" && outcome.canReadWithAI ? null : { reason: outcome.code, message: outcome.message },
      warnings: outcome.code === "no_price" && outcome.canReadWithAI ? [outcome.message] : [],
      canReadWithAI: outcome.canReadWithAI,
    };
  }
  const { offer } = outcome.reading;
  const warnings: string[] = [];
  if (offer.multipleOffers) warnings.push("La página tiene varias opciones (talla, color o zona): sigo la del enlace o la más barata disponible.");
  if (offer.method === "ai") warnings.push("Leí el precio con IA porque la página no publica datos de producto.");
  if (offer.inStock === false) warnings.push("Ahora está agotado: te aviso cuando vuelva y baje.");
  return {
    ...view,
    url: outcome.reading.url,
    title: offer.title,
    merchant: offer.merchant,
    kind: offer.kind,
    price: offer.price,
    currency: offer.currency,
    inStock: offer.inStock,
    stockCount: offer.stockCount,
    method: offer.method,
    detail: offer.detail,
    eventDate: offer.eventDate,
    spark: product ? sandboxHistory(product, now, 30).map((p) => p.price) : [],
    warnings,
  };
}

// ─── Seguir, editar, revisar ─────────────────────────────────────────────

async function views(userId: string, items: WatchlistItem[], now: Date): Promise<TrackedItemView[]> {
  const points = await pointsFor(
    items.map((i) => i.id),
    new Date(now.getTime() - 90 * DAY),
  );
  return items.map((item) => trackedItemView(item, points.get(item.id) ?? [], now));
}

export async function trackedView(userId: string, item: WatchlistItem, now = new Date()): Promise<TrackedItemView> {
  return (await views(userId, [item], now))[0];
}

async function findItem(userId: string, itemId: string): Promise<WatchlistItem> {
  if (!isUuid(itemId)) throw Errors.notFound("El seguimiento");
  const item = await prisma.watchlistItem.findFirst({ where: { id: itemId, userId } });
  if (!item) throw Errors.notFound("El seguimiento");
  return item;
}

export type TrackInput = {
  url: string;
  title?: string | null;
  targetPrice?: number | null;
  dropAlertPct?: number;
  quantity?: number;
  useAI?: boolean;
};

/** Empieza a seguir un enlace: lee el precio, guarda la primera lectura y agenda la próxima revisión. */
export async function trackLink(userId: string, input: TrackInput, now = new Date()): Promise<{ item: TrackedItemView; created: boolean }> {
  const check = checkUrl(input.url);
  if (!check.ok) throw Errors.badRequest(check.message);
  const url = check.url.toString();

  const existing = await prisma.watchlistItem.findFirst({ where: { userId, url, status: { in: ["ACTIVE", "PAUSED"] } } });
  if (existing) return { item: await trackedView(userId, existing, now), created: false };

  const entitlements = await getEntitlements(userId);
  const active = await prisma.watchlistItem.count({ where: { userId, status: "ACTIVE" } });
  if (active >= entitlements.limits.watchlistItems) {
    throw watchlistLimit(entitlements);
  }

  const { currency } = await profileOf(userId);
  const outcome = await readPrice(url, { userId, now, ai: input.useAI ? "if_needed" : "never", fallbackCurrency: currency });
  if (!outcome.ok) {
    if (outcome.code === "no_price" && outcome.canReadWithAI) throw new AppError(422, "needs_ai", outcome.message);
    if (outcome.code === "ai_quota") {
      throw planLimitError(entitlements, "page_reads", outcome.message, { limit: entitlements.limits.monthlyPageReads });
    }
    if (outcome.permanent || outcome.code === "no_price") throw Errors.badRequest(outcome.message);
    throw new AppError(502, "unreachable", `${outcome.message} Inténtalo de nuevo en un rato.`);
  }
  const { offer } = outcome.reading;
  const product = check.sandbox ? findSandboxProduct(check.url) : null;
  const dropAlertPct = Math.max(5, Math.min(80, Math.round(input.dropAlertPct ?? 15)));
  const target = input.targetPrice && input.targetPrice > 0 ? Math.round(input.targetPrice * 100) / 100 : null;
  const meta: ItemMeta = {
    method: offer.method,
    host: hostOf(url),
    detail: offer.detail,
    eventDate: offer.eventDate,
    stockCount: offer.stockCount,
    quantity: Math.max(1, Math.min(10, Math.floor(input.quantity ?? 1))),
    shipping: offer.shipping,
    multipleOffers: offer.multipleOffers,
    lastAlert: null,
    flash: null,
    blocked: false,
    pausedByPlan: false,
  };
  // Las tiendas de prueba publican su historial de 30 días: así la referencia y la gráfica tienen sentido desde el día 1.
  const backfill = product ? sandboxHistory(product, new Date(now.getTime() - DAY), 29) : [];
  const lowest = Math.min(offer.price, ...backfill.map((p) => p.price));

  const item = await prisma.watchlistItem.create({
    data: {
      userId,
      kind: offer.kind as WatchKind,
      title: (input.title?.trim() || offer.title).slice(0, 160),
      url,
      merchant: offer.merchant,
      currency: offer.currency,
      currentPrice: offer.price,
      targetPrice: target,
      lowestPrice: lowest,
      dropAlertPct,
      checkEveryMinutes: entitlements.limits.priceCheckMinutes,
      lastCheckedAt: now,
      nextCheckAt: nextCheckAt(now, entitlements.limits.priceCheckMinutes, { seed: url, aiRead: offer.method === "ai" }),
      source: outcome.reading.source,
      inStock: offer.inStock,
      metadata: meta as unknown as Prisma.InputJsonValue,
      createdAt: now,
    },
  });
  if (backfill.length > 0) {
    await prisma.pricePoint.createMany({
      data: backfill.map((p) => ({ itemId: item.id, price: p.price, currency: offer.currency, inStock: p.inStock, source: "sandbox_history", checkedAt: p.at })),
    });
  }
  await prisma.pricePoint.create({
    data: { itemId: item.id, price: offer.price, currency: offer.currency, inStock: offer.inStock, source: offer.method, checkedAt: now },
  });
  await audit({ userId, actor: "user", action: "concierge.track", entity: "watchlist_item", entityId: item.id, metadata: { host: meta.host, method: offer.method } });
  return { item: await trackedView(userId, item, now), created: true };
}

/** Seguimiento sin enlace (lo que el usuario cuenta en el chat): no se revisa solo; sirve de recordatorio. */
export async function trackManual(
  userId: string,
  input: { title: string; kind: WatchKindId; merchant: string | null; currency: string; currentPrice: number | null; targetPrice: number | null; dropAlertPct: number },
  now = new Date(),
): Promise<TrackedItemView> {
  const entitlements = await getEntitlements(userId);
  const active = await prisma.watchlistItem.count({ where: { userId, status: "ACTIVE" } });
  if (active >= entitlements.limits.watchlistItems) {
    throw watchlistLimit(entitlements);
  }
  const item = await prisma.watchlistItem.create({
    data: {
      userId,
      kind: input.kind as WatchKind,
      title: input.title.slice(0, 160),
      merchant: input.merchant,
      currency: input.currency,
      currentPrice: input.currentPrice,
      targetPrice: input.targetPrice,
      lowestPrice: input.currentPrice,
      dropAlertPct: input.dropAlertPct,
      checkEveryMinutes: entitlements.limits.priceCheckMinutes,
      lastCheckedAt: input.currentPrice === null ? null : now,
      nextCheckAt: null,
      source: "manual",
      metadata: { method: "manual", quantity: 1 } as Prisma.InputJsonValue,
      createdAt: now,
    },
  });
  if (input.currentPrice !== null) {
    await prisma.pricePoint.create({ data: { itemId: item.id, price: input.currentPrice, currency: input.currency, source: "manual", checkedAt: now } });
  }
  return trackedView(userId, item, now);
}

export type TrackingPatch = {
  title?: string;
  targetPrice?: number | null;
  dropAlertPct?: number;
  quantity?: number;
  status?: "ACTIVE" | "PAUSED";
};

export async function updateTracking(userId: string, itemId: string, patch: TrackingPatch, now = new Date()): Promise<TrackedItemView> {
  const item = await findItem(userId, itemId);
  if (item.status === "ARCHIVED" || item.status === "PURCHASED") throw Errors.conflict("Este seguimiento ya terminó.");
  const meta = readItemMeta(item.metadata);
  const data: {
    title?: string;
    targetPrice?: number | null;
    dropAlertPct?: number;
    status?: "ACTIVE" | "PAUSED";
    failCount?: number;
    lastError?: string | null;
    checkEveryMinutes?: number;
    nextCheckAt?: Date | null;
    metadata?: Prisma.InputJsonValue;
  } = {};
  if (patch.title !== undefined && patch.title.trim()) data.title = patch.title.trim().slice(0, 160);
  if (patch.targetPrice !== undefined) {
    if (patch.targetPrice !== null && !(patch.targetPrice > 0)) throw Errors.badRequest("El precio objetivo debe ser mayor que cero.");
    data.targetPrice = patch.targetPrice === null ? null : Math.round(patch.targetPrice * 100) / 100;
  }
  if (patch.dropAlertPct !== undefined) {
    if (!Number.isInteger(patch.dropAlertPct) || patch.dropAlertPct < 5 || patch.dropAlertPct > 80) {
      throw Errors.badRequest("La sensibilidad va de 5% a 80%.");
    }
    data.dropAlertPct = patch.dropAlertPct;
  }
  if (patch.quantity !== undefined) meta.quantity = Math.max(1, Math.min(10, Math.floor(patch.quantity)));
  if (patch.status === "PAUSED" && item.status === "ACTIVE") {
    data.status = "PAUSED";
    data.nextCheckAt = null;
  }
  if (patch.status === "ACTIVE" && item.status === "PAUSED") {
    const entitlements = await getEntitlements(userId);
    const active = await prisma.watchlistItem.count({ where: { userId, status: "ACTIVE" } });
    if (active >= entitlements.limits.watchlistItems) throw watchlistLimit(entitlements);
    data.status = "ACTIVE";
    data.failCount = 0;
    data.lastError = null;
    data.checkEveryMinutes = entitlements.limits.priceCheckMinutes;
    data.nextCheckAt = item.source === "manual" ? null : now; // se revisa en la próxima corrida
    meta.blocked = false;
    meta.pausedByPlan = false;
  }
  data.metadata = meta as unknown as Prisma.InputJsonValue;
  const updated = await prisma.watchlistItem.update({ where: { id: item.id }, data });
  return trackedView(userId, updated, now);
}

export async function archiveTracking(userId: string, itemId: string, now = new Date()): Promise<TrackedItemView> {
  const item = await findItem(userId, itemId);
  const updated = await prisma.watchlistItem.update({ where: { id: item.id }, data: { status: "ARCHIVED", nextCheckAt: null } });
  await prisma.priceAlert.updateMany({ where: { itemId: item.id, status: { in: ["NEW", "SEEN"] } }, data: { status: "DISMISSED" } });
  await audit({ userId, actor: "user", action: "concierge.untrack", entity: "watchlist_item", entityId: item.id });
  return trackedView(userId, updated, now);
}

export type CheckNowResult = { item: TrackedItemView; alert: PriceAlertView | null; message: string };

async function resultOf(userId: string, itemId: string, outcome: Awaited<ReturnType<typeof checkItem>>, now: Date): Promise<CheckNowResult> {
  const item = await findItem(userId, itemId);
  const view = await trackedView(userId, item, now);
  let alert: PriceAlertView | null = null;
  if (outcome.status === "ok" && outcome.alertId) {
    const row = await prisma.priceAlert.findUnique({ where: { id: outcome.alertId } });
    if (row) {
      const points = await pointsFor([item.id], new Date(now.getTime() - 30 * DAY));
      alert = alertView(row, item, points.get(item.id) ?? [], null, now);
    }
  }
  const message =
    outcome.status === "ok"
      ? alert
        ? alert.headline
        : outcome.analysis.suppressed === "out_of_stock"
          ? "Bajó, pero está agotado: te aviso cuando vuelva."
          : outcome.analysis.suppressed === "already_alerted"
            ? "Sigue en el precio que ya te avisé."
            : "Revisado: todavía no hay una bajada que valga la pena."
      : outcome.status === "failed"
        ? outcome.message
        : "Este seguimiento no se revisa solo.";
  return { item: view, alert, message };
}

/** "Revisar ahora", con el límite de frecuencia del plan. */
export async function checkNow(userId: string, itemId: string, now = new Date()): Promise<CheckNowResult> {
  const item = await findItem(userId, itemId);
  if (item.status !== "ACTIVE") throw Errors.conflict("Reanuda el seguimiento para revisarlo.");
  if (!item.url || item.source === "manual") throw Errors.badRequest("Este seguimiento no tiene enlace: pégalo para que lo revise solo.");
  const [entitlements, profile] = await Promise.all([getEntitlements(userId), profileOf(userId)]);
  const allowed = canCheckNow(item.lastCheckedAt, now, entitlements.plan);
  if (!allowed.ok) {
    throw new AppError(429, "too_soon", `Lo revisé hace poco. Puedes volver a pedirlo a las ${clockTime(allowed.retryAt, profile.timezone)}`);
  }
  const outcome = await checkItem(item.id, { now, trigger: "manual" });
  return resultOf(userId, item.id, outcome, now);
}

/** Solo tiendas de prueba: activa una oferta relámpago de 6 horas y revisa, para probar la alerta y la compra. */
export async function simulateDrop(userId: string, itemId: string, now = new Date()): Promise<CheckNowResult> {
  const item = await findItem(userId, itemId);
  if (item.source !== "sandbox") throw Errors.badRequest("Solo se puede simular una bajada en las tiendas de prueba.");
  if (item.status !== "ACTIVE") throw Errors.conflict("Reanuda el seguimiento para probarlo.");
  const meta = readItemMeta(item.metadata);
  meta.flash = { pct: Math.max(25, Math.min(45, item.dropAlertPct + 10)), until: new Date(now.getTime() + 6 * 3_600_000).toISOString() };
  meta.lastAlert = null;
  await prisma.watchlistItem.update({ where: { id: item.id }, data: { metadata: meta as unknown as Prisma.InputJsonValue } });
  await audit({ userId, actor: "user", action: "concierge.simulate_drop", entity: "watchlist_item", entityId: item.id });
  const outcome = await checkItem(item.id, { now, trigger: "simulate" });
  return resultOf(userId, item.id, outcome, now);
}

// ─── Listas y detalle ────────────────────────────────────────────────────

export async function listTrackedViews(userId: string, now = new Date(), opts: { includeDone?: boolean } = {}): Promise<TrackedItemView[]> {
  const items = await prisma.watchlistItem.findMany({
    where: { userId, status: { in: opts.includeDone ? ["ACTIVE", "PAUSED", "PURCHASED"] : ["ACTIVE", "PAUSED"] } },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: 60,
  });
  return views(userId, items, now);
}

export async function trackedViewsByIds(userId: string, ids: string[], now = new Date()): Promise<Map<string, TrackedItemView>> {
  const valid = ids.filter(isUuid);
  if (valid.length === 0) return new Map();
  const items = await prisma.watchlistItem.findMany({ where: { userId, id: { in: valid } } });
  const list = await views(userId, items, now);
  return new Map(list.map((v) => [v.id, v]));
}

export type TrackedDetail = {
  item: TrackedItemView;
  points: { at: string; price: number }[];
  stats: { min: number; max: number; median: number; days: number };
};

export async function getTrackedDetail(userId: string, itemId: string, now = new Date()): Promise<TrackedDetail> {
  const item = await findItem(userId, itemId);
  const points = await prisma.pricePoint.findMany({
    where: { itemId: item.id, checkedAt: { gte: new Date(now.getTime() - 90 * DAY) } },
    orderBy: { checkedAt: "asc" },
    select: { price: true, checkedAt: true, inStock: true },
  });
  const history = toHistory(points);
  const daily = sparkOf(history, now, 90);
  const sorted = [...daily].sort((a, b) => a - b);
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
  const first = history[0]?.at ?? now;
  const view = trackedItemView(item, points, now);
  return {
    item: view,
    points: history.map((p) => ({ at: p.at.toISOString(), price: p.price })),
    stats: {
      min: sorted[0] ?? 0,
      max: sorted[sorted.length - 1] ?? 0,
      median,
      days: Math.max(1, Math.round((now.getTime() - first.getTime()) / DAY)),
    },
  };
}

export async function listOrderViews(userId: string, take = 20): Promise<OrderView[]> {
  const orders = await prisma.purchaseOrder.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take });
  return orders.map(orderView);
}

export async function countActiveTracking(userId: string): Promise<number> {
  return prisma.watchlistItem.count({ where: { userId, status: "ACTIVE" } });
}

