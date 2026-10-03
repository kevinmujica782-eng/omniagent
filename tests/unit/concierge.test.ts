import { describe, expect, it } from "vitest";
import { purchaseReason } from "@/modules/concierge/rules/alert-copy";
import { buildQuote, checkLimits } from "@/modules/concierge/rules/checkout";
import { analyzeReading, median, type HistoryPoint } from "@/modules/concierge/rules/drops";
import { currencyFromText, parseAmount } from "@/modules/concierge/scraper/money";
import { checkUrl, isPublicAddress } from "@/modules/concierge/scraper/net-policy";
import { parseRobots } from "@/modules/concierge/scraper/robots";

const DAY = 86_400_000;
const NOW = new Date("2026-09-28T15:00:00Z");
const steady = (price: number, days = 20): HistoryPoint[] =>
  Array.from({ length: days }, (_, i) => ({ price, at: new Date(NOW.getTime() - (i + 1) * DAY), inStock: true }));

describe("precios escritos en páginas", () => {
  it("entiende formatos de varios países", () => {
    expect(parseAmount("$1,299.90")).toBe(1299.9);
    expect(parseAmount("1.299,90 €")).toBe(1299.9);
    expect(parseAmount("COP 1.250.000")).toBe(1250000);
  });

  it("reconoce la moneda", () => {
    expect(currencyFromText("Precio: 1.299,90 €")).toBe("EUR");
    expect(currencyFromText("COP 1.250.000")).toBe("COP");
  });
});

describe("bajadas de verdad", () => {
  it("compara con la mediana de 30 días y marca objetivo y mínimo", () => {
    const result = analyzeReading({
      now: NOW,
      price: 247,
      currency: "USD",
      itemCurrency: "USD",
      inStock: true,
      history: steady(329),
      targetPrice: 260,
      dropAlertPct: 15,
      lastAlert: null,
    });
    expect(result.referencePrice).toBe(329);
    expect(result.referenceKind).toBe("median30");
    expect(result.dropPct).toBe(25);
    expect(result.reasons).toEqual(["DROP", "TARGET", "LOWEST"]);
    expect(result.shouldAlert).toBe(true);
    expect(result.verdict).toBe("buy");
  });

  it("no avisa lo que no es una bajada, lo agotado ni lo ya avisado", () => {
    const base = { now: NOW, currency: "USD", itemCurrency: "USD", inStock: true, history: steady(329), targetPrice: null, dropAlertPct: 15, lastAlert: null };
    expect(analyzeReading({ ...base, price: 320 }).shouldAlert).toBe(false);
    expect(analyzeReading({ ...base, price: 247, inStock: false }).suppressed).toBe("out_of_stock");
    expect(analyzeReading({ ...base, price: 247, currency: "EUR" }).suppressed).toBe("currency_mismatch");
    // Ya se avisó hace 12 h a $249 y desde entonces no volvió a subir: no se repite.
    const repeated = analyzeReading({ ...base, price: 247, lastAlert: { price: 249, at: new Date(NOW.getTime() - 12 * 3_600_000) } });
    expect(repeated.suppressed).toBe("already_alerted");
    // Si el precio se recuperó después del aviso, una nueva bajada sí se avisa.
    const recovered = analyzeReading({ ...base, price: 247, lastAlert: { price: 249, at: new Date(NOW.getTime() - 3 * DAY) } });
    expect(recovered.shouldAlert).toBe(true);
  });

  it("una bajada de 60% o más se confirma antes de avisar", () => {
    const result = analyzeReading({
      now: NOW,
      price: 99,
      currency: "USD",
      itemCurrency: "USD",
      inStock: true,
      history: steady(329),
      targetPrice: null,
      dropAlertPct: 15,
      lastAlert: null,
    });
    expect(result.suppressed).toBe("needs_confirmation");
    expect(result.suspicious).toBe(true);
  });

  it("mediana robusta a un día raro", () => {
    expect(median([329, 331, 99, 330, 328])).toBe(329);
    expect(median([])).toBeNull();
  });
});

describe("cotización y límites", () => {
  const fees = { shipping: 9.9, freeShippingOver: 150, feePerUnit: 0, feeLabel: null, taxRate: 0, taxLabel: null, deliveryDays: 4 };

  it("suma envío hasta el umbral de envío gratis", () => {
    const small = buildQuote({ unitPrice: 79.9, quantity: 1, currency: "USD", kind: "PRODUCT", fees, offerShipping: null });
    expect(small.total).toBe(89.8);
    const big = buildQuote({ unitPrice: 79.9, quantity: 2, currency: "USD", kind: "PRODUCT", fees, offerShipping: null });
    expect(big.lines.find((l) => l.label === "Envío")?.amount).toBe(0);
    expect(big.total).toBe(159.8);
  });

  it("aplica cargos por unidad e impuestos", () => {
    const quote = buildQuote({
      unitPrice: 100,
      quantity: 2,
      currency: "USD",
      kind: "HOTEL",
      fees: { shipping: 0, freeShippingOver: null, feePerUnit: 3.5, feeLabel: "Cargo", taxRate: 0.12, taxLabel: "Tasas", deliveryDays: null },
      offerShipping: null,
    });
    expect(quote.total).toBe(231);
    expect(quote.complete).toBe(true);
  });

  it("respeta el tope por compra y el del mes", () => {
    expect(checkLimits(600, { perOrder: 500, monthly: 1000, spentThisMonth: 0, currency: "USD" })).toMatchObject({ ok: false, reason: "per_order" });
    expect(checkLimits(300, { perOrder: 500, monthly: 1000, spentThisMonth: 800, currency: "USD" })).toMatchObject({ ok: false, reason: "monthly" });
    expect(checkLimits(200, { perOrder: 500, monthly: 1000, spentThisMonth: 800, currency: "USD" })).toEqual({ ok: true });
  });

  it("explica por qué comprar sin repetir el nombre", () => {
    expect(purchaseReason({ dropPct: 24, referencePrice: 327, reasons: ["DROP"], targetPrice: null, currency: "USD" })).toBe(
      "Bajó 24% frente a lo normal ($327).",
    );
    expect(purchaseReason({ dropPct: null, referencePrice: null, reasons: ["LOWEST"], targetPrice: null, currency: "USD" })).toBeNull();
  });
});

describe("red segura del rastreador", () => {
  it("rechaza enlaces a redes privadas, puertos raros y credenciales", () => {
    expect(checkUrl("http://127.0.0.1/admin").ok).toBe(false);
    expect(checkUrl("http://169.254.169.254/latest/meta-data").ok).toBe(false);
    expect(checkUrl("https://tienda.com:8443/p").ok).toBe(false);
    expect(checkUrl("https://usuario:clave@tienda.com/p").ok).toBe(false);
    expect(checkUrl("file:///etc/passwd").ok).toBe(false);
    expect(checkUrl("https://intranet.local/p").ok).toBe(false);
    expect(checkUrl("https://www.tienda.com/p/1").ok).toBe(true);
  });

  it("distingue direcciones públicas de privadas (IPv4 e IPv6)", () => {
    expect(isPublicAddress("8.8.8.8")).toBe(true);
    expect(isPublicAddress("10.1.2.3")).toBe(false);
    expect(isPublicAddress("100.64.0.1")).toBe(false);
    expect(isPublicAddress("::1")).toBe(false);
    expect(isPublicAddress("::ffff:127.0.0.1")).toBe(false);
  });

  it("respeta robots.txt con su grupo propio", () => {
    const robots = parseRobots("User-agent: *\nDisallow: /\n\nUser-agent: OmniAgentBot\nDisallow: /carrito\nCrawl-delay: 2");
    expect(robots.specific).toBe(true);
    expect(robots.allowed("/p/audifonos")).toBe(true);
    expect(robots.allowed("/carrito/pagar")).toBe(false);
    expect(robots.crawlDelay).toBe(2);
    expect(parseRobots("User-agent: *\nDisallow: /").allowed("/p/1")).toBe(false);
  });
});
