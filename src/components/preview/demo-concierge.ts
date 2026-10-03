// Datos de ejemplo del módulo de compras para /preview, calculados con el mismo código que usa el servidor:
// tiendas de prueba, historial de precios, detección de bajadas, texto de la alerta, cotización y vistas.
import type { PriceAlert, PurchaseOrder, WatchlistItem } from "@/generated/prisma/client";
import { money } from "@/lib/format";
import type { ItemMeta } from "@/modules/concierge/item-meta";
import { paymentLabel, sandboxPayments } from "@/modules/concierge/payments";
import { rulesAlertText } from "@/modules/concierge/rules/alert-copy";
import { buildQuote, deliveryFor } from "@/modules/concierge/rules/checkout";
import { analyzeReading, referenceOf, type HistoryPoint } from "@/modules/concierge/rules/drops";
import {
  SANDBOX_PRODUCTS,
  sandboxHistory,
  sandboxQuote,
  sandboxUrl,
  storeOf,
  type SandboxFlashSale,
  type SandboxProduct,
} from "@/modules/concierge/sandbox/stores";
import { alertView, orderView, trackedItemView } from "@/modules/concierge/views";
import { longDate } from "@/modules/procedures/time/es-dates";
import type {
  ChatMessageView,
  CheckoutView,
  ConciergeSettingsView,
  OrderView,
  PriceAlertView,
  ProductPreviewView,
  TrackedItemView,
} from "@/types/cards";

const DAY = 86_400_000;
const product = (id: string) => SANDBOX_PRODUCTS.find((p) => p.id === id)!;

function previewOf(p: SandboxProduct, now: Date): ProductPreviewView {
  const store = storeOf(p);
  const quote = sandboxQuote(p, now);
  return {
    url: sandboxUrl(p),
    host: store.host,
    source: "sandbox",
    title: p.title,
    merchant: store.name,
    kind: p.kind,
    price: quote.price,
    currency: p.currency,
    inStock: quote.inStock,
    stockCount: quote.stockCount,
    method: store.style === "plain" ? null : store.style === "meta" ? "meta" : store.style === "microdata" ? "microdata" : "jsonld",
    detail: p.detail ?? null,
    eventDate: p.eventDate ? p.eventDate(now).toISOString() : null,
    spark: sandboxHistory(p, now, 30).map((h) => h.price),
    warnings: store.style === "plain" ? ["Esta tienda no publica datos de producto: el precio se lee con IA."] : [],
    blocked: store.blocksBots ? { reason: "robots", message: "Esta tienda no permite revisiones automáticas (robots.txt)." } : null,
    canReadWithAI: store.style === "plain",
  };
}

type DemoItem = { row: WatchlistItem; points: { price: number; checkedAt: Date; inStock: boolean | null }[]; history: HistoryPoint[] };

function demoItem(
  id: string,
  p: SandboxProduct,
  now: Date,
  opts: { target?: number | null; pct?: number; quantity?: number; flash?: SandboxFlashSale | null; status?: WatchlistItem["status"]; method?: ItemMeta["method"]; trackedDays?: number },
): DemoItem {
  const store = storeOf(p);
  const history = sandboxHistory(p, new Date(now.getTime() - DAY), 29);
  const current = sandboxQuote(p, now, opts.flash ?? null);
  const points = [
    ...history.map((h) => ({ price: h.price, checkedAt: h.at, inStock: h.inStock })),
    { price: current.price, checkedAt: now, inStock: current.inStock },
  ];
  const meta: ItemMeta = {
    method: opts.method ?? (store.style === "meta" ? "meta" : store.style === "microdata" ? "microdata" : "jsonld"),
    host: store.host,
    detail: p.detail ?? null,
    eventDate: p.eventDate ? p.eventDate(now).toISOString() : null,
    stockCount: current.stockCount,
    quantity: opts.quantity ?? 1,
    shipping: store.deliveryDays ? store.shipping : null,
    multipleOffers: false,
    lastAlert: null,
    flash: opts.flash ?? null,
    blocked: false,
    pausedByPlan: false,
  };
  const row = {
    id,
    userId: "demo",
    kind: p.kind,
    status: opts.status ?? "ACTIVE",
    title: p.title,
    url: sandboxUrl(p),
    merchant: store.name,
    currency: p.currency,
    currentPrice: current.price,
    targetPrice: opts.target ?? null,
    lowestPrice: Math.min(...points.map((x) => x.price)),
    dropAlertPct: opts.pct ?? 15,
    checkEveryMinutes: 60,
    lastCheckedAt: new Date(now.getTime() - 18 * 60_000),
    // Las páginas leídas con IA se revisan una vez al día.
    nextCheckAt: new Date(now.getTime() + (opts.method === "ai" ? 20 * 60 : 38) * 60_000),
    source: "sandbox",
    inStock: current.inStock,
    failCount: 0,
    lastError: null,
    metadata: meta,
    createdAt: new Date(now.getTime() - (opts.trackedDays ?? 12) * DAY),
    updatedAt: now,
  } as unknown as WatchlistItem;
  return { row, points, history: history.map((h) => ({ price: h.price, at: h.at, inStock: h.inStock })) };
}

export function demoConcierge(now: Date, timeZone: string) {
  const flash: SandboxFlashSale = { pct: 25, until: new Date(now.getTime() + 6 * 3_600_000).toISOString() };
  const aura = demoItem("demo-aura", product("aura-x2"), now, { target: 260, pct: 15, flash, trackedDays: 18 });
  const cine = demoItem("demo-cine", product("ultima-orbita"), now, { pct: 20, quantity: 2, trackedDays: 5 });
  const flight = demoItem("demo-vuelo", product("mia-bog"), now, { target: 280, pct: 10, trackedDays: 26 });
  const robot = demoItem("demo-robot", product("limpia-s3"), now, { pct: 15, method: "ai", trackedDays: 9 });
  const fryer = demoItem("demo-freidora", product("crisp-5l"), now, { pct: 25, status: "PAUSED", trackedDays: 30 });
  const list = [aura, cine, flight, robot, fryer];

  const items: TrackedItemView[] = list.map((d) => trackedItemView(d.row, d.points, now));
  const points: Record<string, { at: string; price: number }[]> = Object.fromEntries(
    list.map((d) => [d.row.id, d.points.map((p) => ({ at: p.checkedAt.toISOString(), price: Number(p.price) }))]),
  );

  // La alerta sale del mismo análisis que usa el agente (mediana de 30 días, objetivo, mínimo) y su texto por reglas.
  const auraPrice = Number(aura.row.currentPrice);
  const analysis = analyzeReading({
    now,
    price: auraPrice,
    currency: "USD",
    itemCurrency: "USD",
    inStock: true,
    history: aura.history,
    targetPrice: 260,
    dropAlertPct: 15,
    lastAlert: null,
  });
  const facts = {
    title: aura.row.title,
    merchant: aura.row.merchant,
    kind: "PRODUCT" as const,
    currency: "USD",
    price: auraPrice,
    previousPrice: analysis.previousPrice,
    referencePrice: analysis.referencePrice,
    referenceKind: analysis.referenceKind,
    dropPct: analysis.dropPct,
    lowestBefore: analysis.lowestBefore,
    isLowest: analysis.isLowest,
    hitsTarget: analysis.hitsTarget,
    targetPrice: 260,
    reasons: analysis.reasons,
    inStock: true,
    stockCount: 7,
    daysTracked: 18,
    recent: aura.history.map((h) => h.price),
    verdict: analysis.verdict,
  };
  const text = rulesAlertText(facts);
  const alertRow = {
    id: "demo-alerta-aura",
    userId: "demo",
    itemId: aura.row.id,
    status: "NEW",
    price: auraPrice,
    previousPrice: analysis.previousPrice,
    referencePrice: analysis.referencePrice,
    currency: "USD",
    dropPct: analysis.dropPct,
    reasons: analysis.reasons,
    headline: text.headline,
    summary: text.summary,
    verdict: text.verdict,
    source: "RULES",
    actionId: null,
    expiresAt: new Date(now.getTime() + 3 * DAY),
    seenAt: null,
    createdAt: new Date(now.getTime() - 40 * 60_000),
    updatedAt: now,
  } as unknown as PriceAlert;
  const auraMeta = { ...(aura.row.metadata as unknown as ItemMeta), stockCount: 7 };
  const alerts: PriceAlertView[] = [alertView(alertRow, { ...aura.row, metadata: auraMeta } as unknown as WatchlistItem, aura.points, null, now)];

  const methods = sandboxPayments.methods();
  const orderRow = {
    id: "demo-pedido-andes",
    userId: "demo",
    itemId: null,
    actionId: "demo-accion-andes",
    status: "PLACED",
    kind: "PRODUCT",
    title: "Zapatillas de trail Andes 2",
    merchant: "Cumbre Sports",
    quantity: 1,
    unitPrice: 90,
    shipping: 6.5,
    tax: 0,
    total: 96.5,
    currency: "USD",
    paymentProvider: "sandbox",
    paymentLabel: paymentLabel(methods[0]),
    paymentRef: "sbx_ch_demo",
    orderNumber: "CUM-4K9T2B",
    failureReason: null,
    details: { delivery: { label: "Envío a domicilio", detail: "Entregado el lunes" } },
    createdAt: new Date(now.getTime() - 9 * DAY),
    updatedAt: now,
  } as unknown as PurchaseOrder;
  // Gasto del mes = pedidos confirmados de este mes (como spentThisMonth en el servidor).
  const spentThisMonth = [orderRow]
    .filter((o) => o.status === "PLACED" && o.createdAt.getFullYear() === now.getFullYear() && o.createdAt.getMonth() === now.getMonth())
    .reduce((sum, o) => sum + Number(o.total), 0);

  // Hoja de pago de la compra rápida (misma cotización y entrega que el servidor).
  const store = storeOf(product("aura-x2"));
  const quote = buildQuote({ unitPrice: auraPrice, quantity: 1, currency: "USD", kind: "PRODUCT", fees: store, offerShipping: null });
  const plan = deliveryFor("PRODUCT", store, now, null);
  const checkout: CheckoutView = {
    actionId: "demo-compra-aura",
    status: "PENDING",
    itemId: aura.row.id,
    kind: "PRODUCT",
    title: aura.row.title,
    merchant: aura.row.merchant,
    detail: null,
    quantity: 1,
    unitPrice: auraPrice,
    currency: "USD",
    lines: quote.lines.map((l) => ({ label: l.label, amount: l.amount, note: l.note ?? null })),
    total: quote.total,
    quoteId: "demo",
    lockedUntil: new Date(now.getTime() + DAY).toISOString(),
    expiresAt: new Date(now.getTime() + DAY).toISOString(),
    methods,
    defaultMethodId: methods[0].id,
    delivery: plan ? { label: plan.label, detail: `Llega hacia el ${longDate(plan.eta ?? now, timeZone)} · ${plan.detail ?? ""}` } : null,
    guard: `Solo se cobra si el total sigue en ${money(quote.total, "USD", { cents: true })} o menos.`,
    notes: ["Pago simulado: no se cobra a ninguna tarjeta ni se envía el pedido a una tienda real."],
    sandbox: true,
    limits: { perOrder: 500, monthlyRemaining: Math.max(0, 1000 - spentThisMonth) },
    order: null,
    resultMessage: null,
    priceChanged: null,
  };

  const orders: OrderView[] = [orderView(orderRow)];
  const orderForReceipt: OrderView = {
    id: "demo-pedido-aura",
    status: "PLACED",
    orderNumber: "SMX-7F3K2Q",
    kind: "PRODUCT",
    title: aura.row.title,
    merchant: aura.row.merchant,
    quantity: 1,
    total: quote.total,
    currency: "USD",
    paymentLabel: paymentLabel(methods[0]),
    delivery: checkout.delivery,
    failureReason: null,
    sandbox: true,
    createdAt: now.toISOString(),
  };
  const receipt: CheckoutView = {
    ...checkout,
    status: "EXECUTED",
    order: orderForReceipt,
    resultMessage: `Pedido SMX-7F3K2Q confirmado por ${money(quote.total, "USD", { cents: true })}. Simulado: no se cobró de verdad.`,
  };

  const settings: ConciergeSettingsView = {
    currency: "USD",
    perOrderLimit: 500,
    monthlyLimit: 1000,
    spentThisMonth,
    methods,
    webChecks: true,
    plan: "PRO",
    maxItems: 50,
    checkEveryMinutes: 60,
  };

  const catalog = SANDBOX_PRODUCTS.map((p) => previewOf(p, now));
  const track = previewOf(product("brisa-cartagena"), now);

  const at = (minutesAgo: number) => new Date(now.getTime() - minutesAgo * 60_000).toISOString();
  // La conversación empezó hace unos 18 días, un día sin oferta: sus tarjetas muestran los precios de ese momento.
  let startDays = 18;
  while (startDays < 27 && sandboxQuote(product("aura-x2"), new Date(now.getTime() - startDays * DAY)).onSale) startDays++;
  const startedAt = new Date(now.getTime() - startDays * DAY);
  const startMinutes = startDays * 24 * 60;
  const offers = SANDBOX_PRODUCTS.filter((p) => p.id === "aura-x2" || p.id === "onda-mini").map((p) => previewOf(p, startedAt));
  const auraThen = offers.find((o) => o.title === aura.row.title)!;
  const thenHistory = sandboxHistory(product("aura-x2"), new Date(startedAt.getTime() - DAY), 29).map((h) => ({ price: h.price, at: h.at, inStock: true }));
  const thenReference = referenceOf(thenHistory, startedAt).price;
  const trackedThen: TrackedItemView = {
    ...items[0],
    currentPrice: auraThen.price,
    referencePrice: thenReference,
    changePct: auraThen.price !== null && thenReference ? Math.round(((auraThen.price - thenReference) / thenReference) * 100) : null,
    lowestPrice: Math.min(auraThen.price ?? Infinity, ...thenHistory.map((h) => h.price)),
    spark: [...thenHistory.map((h) => h.price), auraThen.price ?? thenHistory[thenHistory.length - 1].price],
    lastCheckedAt: startedAt.toISOString(),
    nextCheckAt: null, // una fecha de hace 18 días se leería rara en la captura
  };
  const conversation: ChatMessageView[] = [
    { id: "c1", role: "user", text: "Vigila unos audífonos inalámbricos y avísame si bajan", cards: [], createdAt: at(startMinutes) },
    {
      id: "c2",
      role: "assistant",
      text: "Encontré estos en las tiendas de prueba. ¿Cuál sigo? También puedes pegarme el enlace de otra tienda.",
      cards: [{ kind: "offers", query: "audífonos inalámbricos", results: offers, currency: "USD", checkEveryMinutes: 60 }],
      createdAt: at(startMinutes - 1),
    },
    { id: "c3", role: "user", text: "Los Aura X2. Avísame si llegan a $260", cards: [], createdAt: at(startMinutes - 2) },
    {
      id: "c4",
      role: "assistant",
      text: "Listo: los reviso cada hora y te aviso si bajan 15% frente a lo normal o si llegan a $260.",
      // Así se veía el día que empezó a seguirlo (antes de la bajada de hoy).
      cards: [{ kind: "tracked_item", item: trackedThen }],
      createdAt: at(startMinutes - 3),
    },
    {
      id: "c5",
      role: "assistant",
      text: `Bajaron: hoy cuestan ${money(auraPrice, "USD")} en SonidoMax, por debajo de tu objetivo. ¿Te preparo la compra?`,
      cards: [{ kind: "price_alert", alert: alerts[0] }],
      createdAt: at(40),
    },
    { id: "c6", role: "user", text: "Sí, cómpralos", cards: [], createdAt: at(12) },
    {
      id: "c7",
      role: "assistant",
      text: "Te dejé la compra lista. Revisa el total y decide con Permitir o Denegar; nada se cobra antes.",
      cards: [{ kind: "checkout", checkout }],
      suggestions: ["¿Cuándo llegan?", "Muéstrame el historial de precio"],
      createdAt: at(11),
    },
  ];

  return { items, alerts, checkouts: [] as CheckoutView[], orders, settings, points, checkout, receipt, catalog, track, conversation };
}
