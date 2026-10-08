import "server-only";
import type { Prisma, WatchlistItem } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { log } from "@/lib/log";
import { getEntitlements, hasFeature } from "@/modules/billing/entitlements";
import { createPriceAlert, notifyTrackingProblem } from "./alerts.service";
import { readItemMeta, type ItemMeta } from "./item-meta";
import { analyzeReading, type DropAnalysis } from "./rules/drops";
import { LEASE_MINUTES, nextCheckAt, PAUSE_AFTER_FAILURES } from "./rules/schedule";
import type { FetchOptions } from "./scraper/fetcher";
import { readPrice, type PriceReading, type ReadOutcome } from "./sources";
import { toHistory } from "./views";

// El agente de precios: revisa cada producto cuando le toca, guarda el precio, decide si es una bajada drástica
// y, si lo es, crea la alerta inteligente. Lo llaman el cron (en lote), "Revisar ahora" y "Probar una bajada".

const DAY = 86_400_000;

export type CheckOutcome =
  | { status: "ok"; itemId: string; price: number; currency: string; alertId: string | null; analysis: DropAnalysis }
  | { status: "failed"; itemId: string; code: string; message: string; paused: boolean }
  | { status: "skipped"; itemId: string; reason: "not_due" | "inactive" | "manual" };

type Trigger = "cron" | "manual" | "simulate";

async function readFor(item: WatchlistItem, meta: ItemMeta, now: Date, fetchOptions?: Partial<FetchOptions>): Promise<ReadOutcome> {
  return readPrice(item.url ?? "", {
    userId: item.userId,
    now,
    flash: item.source === "sandbox" ? meta.flash : null,
    ai: meta.method === "ai" ? "if_needed" : "never",
    fallbackCurrency: item.currency,
    fetchOptions,
  });
}

/**
 * Frecuencia efectiva: la guardada en el producto, pero nunca más seguida de lo que permite el plan actual
 * (si una suscripción vence sin aviso, el agente vuelve solo a la revisión diaria).
 */
function cadence(item: WatchlistItem, planMinutes: number): number {
  return Math.max(item.checkEveryMinutes, planMinutes);
}

async function handleFailure(
  item: WatchlistItem,
  meta: ItemMeta,
  outcome: Extract<ReadOutcome, { ok: false }>,
  now: Date,
  planMinutes: number,
): Promise<CheckOutcome> {
  // Sin cupo de IA o con la lectura de páginas reales desactivada no es culpa de la tienda: se espera un día.
  if (outcome.code === "ai_quota" || outcome.code === "disabled") {
    await prisma.watchlistItem.update({
      where: { id: item.id },
      data: { lastError: outcome.message, lastCheckedAt: now, nextCheckAt: new Date(now.getTime() + DAY) },
    });
    return { status: "failed", itemId: item.id, code: outcome.code, message: outcome.message, paused: false };
  }
  const failCount = item.failCount + 1;
  const blocked = outcome.code === "robots" || outcome.code === "blocked_address";
  const paused = blocked || failCount >= PAUSE_AFTER_FAILURES || (outcome.code === "not_found" && failCount >= 3);
  await prisma.watchlistItem.update({
    where: { id: item.id },
    data: {
      failCount,
      lastError: outcome.message,
      lastCheckedAt: now,
      status: paused ? "PAUSED" : item.status,
      nextCheckAt: paused ? null : nextCheckAt(now, cadence(item, planMinutes), { failCount }),
      metadata: { ...meta, blocked } as unknown as Prisma.InputJsonValue,
    },
  });
  if (paused) {
    await notifyTrackingProblem(
      item,
      blocked ? `No puedo seguir revisando ${item.title}` : `Pausé el seguimiento de ${item.title}`,
      blocked
        ? `${outcome.message}`
        : `${outcome.message} Lo pausé para no insistir; puedes reanudarlo en Compras.`,
    );
  }
  return { status: "failed", itemId: item.id, code: outcome.code, message: outcome.message, paused };
}

function analyze(item: WatchlistItem, meta: ItemMeta, reading: PriceReading, history: ReturnType<typeof toHistory>, now: Date, confirmed = false): DropAnalysis {
  return analyzeReading({
    now,
    price: reading.offer.price,
    currency: reading.offer.currency,
    itemCurrency: item.currency,
    inStock: reading.offer.inStock,
    history,
    targetPrice: item.targetPrice === null ? null : Number(item.targetPrice),
    dropAlertPct: item.dropAlertPct,
    lastAlert: meta.lastAlert ? { price: meta.lastAlert.price, at: new Date(meta.lastAlert.at) } : null,
    confirmed,
  });
}

export async function checkItem(
  itemId: string,
  opts: { now?: Date; trigger: Trigger; fetchOptions?: Partial<FetchOptions> },
): Promise<CheckOutcome> {
  const now = opts.now ?? new Date();
  if (opts.trigger === "cron") {
    // Reclamo atómico: si dos corridas coinciden, solo una revisa este producto.
    const claimed = await prisma.watchlistItem.updateMany({
      where: { id: itemId, status: "ACTIVE", nextCheckAt: { lte: now } },
      data: { nextCheckAt: new Date(now.getTime() + LEASE_MINUTES * 60_000) },
    });
    if (claimed.count === 0) return { status: "skipped", itemId, reason: "not_due" };
  }
  const item = await prisma.watchlistItem.findUnique({ where: { id: itemId } });
  if (!item || item.status !== "ACTIVE") return { status: "skipped", itemId, reason: "inactive" };
  if (!item.url || item.source === "manual") return { status: "skipped", itemId, reason: "manual" };

  const meta = readItemMeta(item.metadata);
  const entitlements = await getEntitlements(item.userId, now);
  const planMinutes = entitlements.limits.priceCheckMinutes;
  const points = await prisma.pricePoint.findMany({
    where: { itemId, checkedAt: { gte: new Date(now.getTime() - 90 * DAY) } },
    orderBy: { checkedAt: "asc" },
    select: { price: true, checkedAt: true, inStock: true },
  });
  const history = toHistory(points);

  const first = await readFor(item, meta, now, opts.fetchOptions);
  if (!first.ok) return handleFailure(item, meta, first, now, planMinutes);
  let reading = first.reading;

  // La página cambió de moneda: se registra el problema pero no se mezclan precios.
  if (reading.offer.currency !== item.currency) {
    await prisma.watchlistItem.update({
      where: { id: item.id },
      data: {
        lastCheckedAt: now,
        lastError: `La página ahora muestra el precio en ${reading.offer.currency}.`,
        nextCheckAt: nextCheckAt(now, cadence(item, planMinutes), { seed: item.id }),
      },
    });
    return { status: "failed", itemId, code: "currency", message: `La página ahora muestra el precio en ${reading.offer.currency}.`, paused: false };
  }

  let analysis = analyze(item, meta, reading, history, now);
  if (analysis.suppressed === "needs_confirmation") {
    // Bajada de más del 60%: se confirma con una segunda lectura antes de avisar.
    const second = await readFor(item, meta, now, opts.fetchOptions);
    if (second.ok && Math.abs(second.reading.offer.price - reading.offer.price) <= reading.offer.price * 0.01) {
      analysis = analyze(item, meta, reading, history, now, true);
    } else if (second.ok) {
      reading = second.reading;
      analysis = analyze(item, meta, reading, history, now);
    }
  }

  const { offer } = reading;
  await prisma.pricePoint.create({
    data: { itemId, price: offer.price, currency: offer.currency, inStock: offer.inStock, source: offer.method, checkedAt: now },
  });

  const nextMeta: ItemMeta = {
    ...meta,
    method: offer.method,
    stockCount: offer.stockCount,
    detail: offer.detail ?? meta.detail,
    eventDate: offer.eventDate ?? meta.eventDate,
    shipping: offer.shipping ?? meta.shipping,
    multipleOffers: offer.multipleOffers,
    blocked: false,
  };
  let alertId: string | null = null;
  if (analysis.shouldAlert) {
    const alert = await createPriceAlert({
      item,
      analysis,
      reading: { price: offer.price, currency: offer.currency, inStock: offer.inStock, stockCount: offer.stockCount },
      history,
      now,
      // Alertas redactadas por Claude: función de Pro. En Gratis, el texto por reglas (mismas cifras).
      writeWithAI: hasFeature(entitlements, "ai_alerts"),
    });
    alertId = alert.id;
    nextMeta.lastAlert = { price: offer.price, at: now.toISOString(), alertId };
  }

  const lowest = item.lowestPrice === null ? offer.price : Math.min(Number(item.lowestPrice), offer.price);
  await prisma.watchlistItem.update({
    where: { id: itemId },
    data: {
      currentPrice: offer.price,
      lowestPrice: lowest,
      inStock: offer.inStock,
      failCount: 0,
      lastError: null,
      lastCheckedAt: now,
      nextCheckAt: nextCheckAt(now, cadence(item, planMinutes), { seed: item.id, aiRead: offer.method === "ai" }),
      metadata: nextMeta as unknown as Prisma.InputJsonValue,
    },
  });
  return { status: "ok", itemId, price: offer.price, currency: offer.currency, alertId, analysis };
}

export type CheckRunSummary = { due: number; checked: number; alerts: number; failed: number; skipped: number; pending: number };

/** Revisa en lote los productos que ya tocan (los más atrasados primero), con varias a la vez y un tiempo máximo. */
export async function runPriceChecks(
  opts: {
    now?: Date;
    limit?: number;
    budgetMs?: number;
    concurrency?: number;
    fetchOptions?: Partial<FetchOptions>;
    /** Solo los productos de esta persona (el motor, al poner todo al día). */
    userId?: string;
  } = {},
): Promise<CheckRunSummary> {
  const now = opts.now ?? new Date();
  const started = Date.now();
  const due = await prisma.watchlistItem.findMany({
    where: { ...(opts.userId ? { userId: opts.userId } : {}), status: "ACTIVE", source: { in: ["sandbox", "web"] }, nextCheckAt: { lte: now } },
    orderBy: { nextCheckAt: "asc" },
    take: opts.limit ?? 40,
    select: { id: true },
  });
  const summary: CheckRunSummary = { due: due.length, checked: 0, alerts: 0, failed: 0, skipped: 0, pending: 0 };
  let index = 0;
  const worker = async () => {
    while (index < due.length) {
      if (Date.now() - started > (opts.budgetMs ?? 45_000)) return;
      const { id } = due[index++];
      try {
        const result = await checkItem(id, { now, trigger: "cron", fetchOptions: opts.fetchOptions });
        if (result.status === "ok") {
          summary.checked++;
          if (result.alertId) summary.alerts++;
        } else if (result.status === "failed") summary.failed++;
        else summary.skipped++;
      } catch (error) {
        summary.failed++;
        log.error("concierge.check_failed", { itemId: id, error });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(opts.concurrency ?? 4, due.length) }, worker));
  summary.pending = due.length - index;
  return summary;
}
