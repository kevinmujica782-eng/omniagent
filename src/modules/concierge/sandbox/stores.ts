// Tiendas de prueba (dominios .test, que nunca existen en internet): un catálogo ficticio de productos, boletos,
// un vuelo y un hotel con precios deterministas que suben y bajan como en la vida real (ofertas cíclicas, ruido
// diario, agotados), páginas HTML con distintos formatos de datos (JSON-LD, microdatos, metaetiquetas y texto
// plano) y su robots.txt. El rastreador las lee con el mismo código que usa para páginas reales.
// Sin dependencias de servidor: también lo usan la vista previa y las pruebas.
import type { WatchKindId } from "@/types/cards";

const DAY = 86_400_000;
const EPOCH = Date.UTC(2026, 0, 1); // jueves

export type SandboxStyle = "jsonld" | "meta" | "microdata" | "event" | "screening" | "flight" | "hotel" | "plain";

export type SandboxStore = {
  id: string;
  name: string;
  host: string;
  style: SandboxStyle;
  /** robots.txt prohíbe a OmniAgentBot (para probar que el rastreador lo respeta). */
  blocksBots?: boolean;
  shipping: number;
  freeShippingOver: number | null;
  feePerUnit: number;
  feeLabel: string | null;
  taxRate: number;
  taxLabel: string | null;
  /** Días hábiles de entrega; null = digital (boletos) o reserva. */
  deliveryDays: number | null;
  orderPrefix: string;
};

export type SandboxProduct = {
  id: string;
  storeId: string;
  path: string;
  title: string;
  kind: WatchKindId;
  category: string;
  keywords: string[];
  description: string;
  base: number;
  currency: string;
  /** Oferta cíclica: `saleDays` de cada `cycleDays` días, con `salePct` de descuento. */
  cycleDays: number;
  saleDays: number;
  salePct: number;
  phase: number;
  /** Variación diaria (± fracción del precio). */
  noisePct: number;
  stock: "units" | "tickets" | "seats" | "rooms";
  /** Un día agotado cada N días. */
  outOfStockEvery?: number;
  /** Lugar o ruta que muestra la página. */
  detail?: string;
  /** Fecha del evento, la función, el vuelo o la llegada al hotel. */
  eventDate?: (at: Date) => Date;
};

export const SANDBOX_STORES: SandboxStore[] = [
  { id: "sonidomax", name: "SonidoMax", host: "sonidomax.test", style: "jsonld", shipping: 0, freeShippingOver: null, feePerUnit: 0, feeLabel: null, taxRate: 0, taxLabel: null, deliveryDays: 3, orderPrefix: "SMX" },
  { id: "casanova", name: "CasaNova Hogar", host: "casanova.test", style: "meta", shipping: 9.9, freeShippingOver: 150, feePerUnit: 0, feeLabel: null, taxRate: 0, taxLabel: null, deliveryDays: 4, orderPrefix: "CNH" },
  { id: "cumbre", name: "Cumbre Sports", host: "cumbresports.test", style: "microdata", shipping: 6.5, freeShippingOver: 99, feePerUnit: 0, feeLabel: null, taxRate: 0, taxLabel: null, deliveryDays: 5, orderPrefix: "CUM" },
  { id: "boletoya", name: "BoletoYa", host: "boletoya.test", style: "event", shipping: 0, freeShippingOver: null, feePerUnit: 3.5, feeLabel: "Cargo por servicio", taxRate: 0, taxLabel: null, deliveryDays: null, orderPrefix: "BYA" },
  { id: "cinepolar", name: "Cine Polar", host: "cinepolar.test", style: "screening", shipping: 0, freeShippingOver: null, feePerUnit: 0.99, feeLabel: "Cargo por reserva", taxRate: 0, taxLabel: null, deliveryDays: null, orderPrefix: "CPL" },
  { id: "vuelaya", name: "VuelaYa", host: "vuelaya.test", style: "flight", shipping: 0, freeShippingOver: null, feePerUnit: 0, feeLabel: null, taxRate: 0, taxLabel: null, deliveryDays: null, orderPrefix: "VYA" },
  { id: "hotelbrisa", name: "Hotel Brisa", host: "hotelbrisa.test", style: "hotel", shipping: 0, freeShippingOver: null, feePerUnit: 0, feeLabel: null, taxRate: 0.12, taxLabel: "Tasas hoteleras", deliveryDays: null, orderPrefix: "HBR" },
  { id: "bazar", name: "Bazar Central", host: "bazarcentral.test", style: "plain", shipping: 9, freeShippingOver: null, feePerUnit: 0, feeLabel: null, taxRate: 0, taxLabel: null, deliveryDays: 6, orderPrefix: "BZC" },
  { id: "megatienda", name: "MegaTienda", host: "megatienda.test", style: "jsonld", blocksBots: true, shipping: 0, freeShippingOver: null, feePerUnit: 0, feeLabel: null, taxRate: 0, taxLabel: null, deliveryDays: 4, orderPrefix: "MGT" },
];

/** Próxima fecha fija (se repite cada año si ya pasó). */
function yearly(iso: string) {
  return (at: Date) => {
    const date = new Date(iso);
    while (date.getTime() < at.getTime() + DAY) date.setUTCFullYear(date.getUTCFullYear() + 1);
    return date;
  };
}

/** Próximo sábado a las 7:00 p. m. (UTC−4), para la función de cine. */
function nextSaturdayShow(at: Date): Date {
  const date = new Date(at.getTime());
  date.setUTCHours(23, 0, 0, 0);
  while (date.getUTCDay() !== 6 || date.getTime() <= at.getTime()) date.setUTCDate(date.getUTCDate() + 1);
  return date;
}

export const SANDBOX_PRODUCTS: SandboxProduct[] = [
  {
    id: "aura-x2", storeId: "sonidomax", path: "/p/audifonos-aura-x2", title: "Audífonos inalámbricos Aura X2", kind: "PRODUCT",
    category: "Audio", keywords: ["audifonos", "auriculares", "inalambricos", "bluetooth", "cancelacion", "ruido"],
    description: "Cancelación de ruido activa, 40 horas de batería y estuche de carga.",
    base: 329, currency: "USD", cycleDays: 9, saleDays: 2, salePct: 0.25, phase: 3, noisePct: 0.02, stock: "units",
  },
  {
    id: "onda-mini", storeId: "sonidomax", path: "/p/parlante-onda-mini", title: "Parlante portátil Onda Mini", kind: "PRODUCT",
    category: "Audio", keywords: ["parlante", "bocina", "altavoz", "portatil", "bluetooth"],
    description: "Resistente al agua, 12 horas de música.",
    base: 79, currency: "USD", cycleDays: 14, saleDays: 3, salePct: 0.2, phase: 6, noisePct: 0.03, stock: "units", outOfStockEvery: 11,
  },
  {
    id: "crisp-5l", storeId: "casanova", path: "/cocina/freidora-de-aire-crisp-5l", title: "Freidora de aire Crisp 5 L", kind: "PRODUCT",
    category: "Cocina", keywords: ["freidora", "aire", "cocina", "airfryer"],
    description: "Canasta de 5 litros, 8 programas y pantalla táctil.",
    base: 129, currency: "USD", cycleDays: 12, saleDays: 2, salePct: 0.3, phase: 1, noisePct: 0.02, stock: "units",
  },
  {
    id: "barista-pro", storeId: "casanova", path: "/cocina/cafetera-espresso-barista-pro", title: "Cafetera espresso Barista Pro", kind: "PRODUCT",
    category: "Cocina", keywords: ["cafetera", "espresso", "cafe", "capuchino"],
    description: "Bomba de 15 bares y vaporizador de leche.",
    base: 249, currency: "USD", cycleDays: 20, saleDays: 4, salePct: 0.18, phase: 9, noisePct: 0.015, stock: "units",
  },
  {
    id: "andes-2", storeId: "cumbre", path: "/calzado/zapatillas-trail-andes-2", title: "Zapatillas de trail Andes 2", kind: "PRODUCT",
    category: "Deportes", keywords: ["zapatillas", "tenis", "trail", "correr", "running", "calzado"],
    description: "Suela de alto agarre y drop de 6 mm.",
    base: 139, currency: "USD", cycleDays: 15, saleDays: 3, salePct: 0.35, phase: 4, noisePct: 0.02, stock: "units",
  },
  {
    id: "estereo-sur", storeId: "boletoya", path: "/eventos/estereo-sur-arena-del-rio", title: "Estéreo Sur en la Arena del Río · General", kind: "EVENT_TICKET",
    category: "Conciertos", keywords: ["estereo", "sur", "concierto", "entradas", "boletos", "musica"],
    description: "Gira aniversario. Entrada general de pie.",
    base: 95, currency: "USD", cycleDays: 10, saleDays: 1, salePct: 0.2, phase: 2, noisePct: 0.0, stock: "tickets",
    detail: "Arena del Río", eventDate: yearly("2026-11-15T01:00:00Z"),
  },
  {
    id: "ultima-orbita", storeId: "cinepolar", path: "/funciones/la-ultima-orbita-sabado", title: "La última órbita · función del sábado 7:00 p. m.", kind: "EVENT_TICKET",
    category: "Cine", keywords: ["cine", "pelicula", "orbita", "funcion", "entradas", "boletos", "estreno"],
    description: "Sala 3, formato 2D subtitulado.",
    base: 12.5, currency: "USD", cycleDays: 7, saleDays: 1, salePct: 0.4, phase: 2, noisePct: 0, stock: "seats",
    detail: "Cine Polar Centro · Sala 3", eventDate: nextSaturdayShow,
  },
  {
    id: "mia-bog", storeId: "vuelaya", path: "/vuelos/mia-bog-18-dic", title: "Vuelo Miami → Bogotá, ida y vuelta (18 al 27 de diciembre)", kind: "FLIGHT",
    category: "Viajes", keywords: ["vuelo", "vuelos", "miami", "bogota", "diciembre", "pasaje", "aerolinea"],
    description: "Tarifa económica con equipaje de mano. Precio por pasajero.",
    base: 312, currency: "USD", cycleDays: 8, saleDays: 2, salePct: 0.2, phase: 5, noisePct: 0.06, stock: "seats",
    detail: "MIA → BOG · VY 412", eventDate: yearly("2026-12-18T13:05:00Z"),
  },
  {
    id: "brisa-cartagena", storeId: "hotelbrisa", path: "/reservas/cartagena-3-noches-diciembre", title: "Hotel Brisa Cartagena · 3 noches (20 al 23 de diciembre)", kind: "HOTEL",
    category: "Viajes", keywords: ["hotel", "cartagena", "noches", "hospedaje", "vacaciones", "diciembre"],
    description: "Habitación doble con vista al mar y desayuno.",
    base: 540, currency: "USD", cycleDays: 10, saleDays: 3, salePct: 0.15, phase: 7, noisePct: 0.02, stock: "rooms",
    detail: "Cartagena", eventDate: yearly("2026-12-20T20:00:00Z"),
  },
  {
    id: "limpia-s3", storeId: "bazar", path: "/hogar/robot-aspirador-limpia-s3", title: "Robot aspirador Limpia S3", kind: "PRODUCT",
    category: "Hogar", keywords: ["robot", "aspiradora", "aspirador", "limpieza", "hogar"],
    description: "Mapeo del hogar y 120 minutos de autonomía.",
    base: 199, currency: "USD", cycleDays: 10, saleDays: 2, salePct: 0.25, phase: 8, noisePct: 0.02, stock: "units",
  },
  {
    id: "lumen-55", storeId: "megatienda", path: "/tv/televisor-lumen-55-4k", title: "Televisor Lumen 55\" 4K", kind: "PRODUCT",
    category: "Televisores", keywords: ["televisor", "tv", "pantalla", "4k", "lumen"],
    description: "Panel 4K de 55 pulgadas.",
    base: 499, currency: "USD", cycleDays: 12, saleDays: 2, salePct: 0.2, phase: 0, noisePct: 0.02, stock: "units",
  },
];

// ─── Precios deterministas ───────────────────────────────────────────────

function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export const unitRandom = (seed: string) => (hash(seed) % 10_000) / 10_000;

export function sandboxDay(at: Date): number {
  return Math.floor((at.getTime() - EPOCH) / DAY);
}

/** Redondeo de tienda: $329, $78.99, $12.50. */
function retail(price: number): number {
  if (price >= 100) return Math.round(price);
  if (price >= 20) return Math.round(price) - 0.01;
  return Math.round(price * 2) / 2;
}

export type SandboxFlashSale = { pct: number; until: string };

export type SandboxQuote = {
  price: number;
  /** Precio sin la oferta del ciclo (el "antes" que muestra la página). */
  regular: number;
  onSale: boolean;
  inStock: boolean;
  stockCount: number | null;
};

export function sandboxQuote(product: SandboxProduct, at: Date, flash: SandboxFlashSale | null = null): SandboxQuote {
  const day = sandboxDay(at);
  const noise = product.noisePct ? (unitRandom(`${product.id}:${day}`) - 0.5) * 2 * product.noisePct : 0;
  const position = (((day + product.phase) % product.cycleDays) + product.cycleDays) % product.cycleDays;
  const cycleSale = position < product.saleDays;
  const regular = retail(product.base * (1 + noise));
  let price = cycleSale ? retail(product.base * (1 + noise) * (1 - product.salePct)) : regular;
  let onSale = cycleSale;
  if (flash && new Date(flash.until).getTime() > at.getTime()) {
    const flashPrice = retail(product.base * (1 - flash.pct / 100));
    if (flashPrice < price) {
      price = flashPrice;
      onSale = true;
    }
  }

  let stockCount: number | null = null;
  let inStock = true;
  if (product.stock === "units") {
    inStock = !(product.outOfStockEvery && day % product.outOfStockEvery === 0);
    stockCount = inStock ? 2 + (hash(`${product.id}:stock:${day}`) % 14) : 0;
  } else if (product.eventDate) {
    const daysLeft = Math.max(0, (product.eventDate(at).getTime() - at.getTime()) / DAY);
    const capacity = product.stock === "tickets" ? 400 : product.stock === "seats" ? 120 : 18;
    const horizon = product.stock === "tickets" ? 90 : product.stock === "seats" ? 7 : 60;
    const sold = Math.min(1, Math.max(0, 1 - daysLeft / horizon));
    stockCount = Math.max(2, Math.round(capacity * (1 - 0.9 * sold)) - (hash(`${product.id}:${day}`) % 5));
  }
  return { price, regular, onSale, inStock, stockCount };
}

/** Un precio por día (a las 15:00 UTC) de los últimos `days` días, incluido hoy. */
export function sandboxHistory(product: SandboxProduct, at: Date, days = 30): { at: Date; price: number; inStock: boolean }[] {
  const out: { at: Date; price: number; inStock: boolean }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const point = new Date(at.getTime() - i * DAY);
    point.setUTCHours(15, 0, 0, 0);
    if (point.getTime() > at.getTime()) point.setUTCDate(point.getUTCDate() - 1);
    const quote = sandboxQuote(product, point);
    out.push({ at: point, price: quote.price, inStock: quote.inStock });
  }
  return out;
}

// ─── Catálogo, búsqueda y URLs ───────────────────────────────────────────

export function storeOf(product: SandboxProduct): SandboxStore {
  const store = SANDBOX_STORES.find((s) => s.id === product.storeId);
  if (!store) throw new Error(`Tienda de prueba desconocida: ${product.storeId}`);
  return store;
}

export function sandboxUrl(product: SandboxProduct): string {
  return `https://${storeOf(product).host}${product.path}`;
}

export function findSandboxProduct(url: string | URL): SandboxProduct | null {
  let parsed: URL;
  try {
    parsed = typeof url === "string" ? new URL(url) : url;
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase();
  const path = parsed.pathname.replace(/\/$/, "");
  return SANDBOX_PRODUCTS.find((p) => storeOf(p).host === host && p.path === path) ?? null;
}

export function findSandboxStore(host: string): SandboxStore | null {
  return SANDBOX_STORES.find((s) => s.host === host.toLowerCase()) ?? null;
}

const fold = (text: string) =>
  text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]+/g, " ");

const STOP = new Set(["de", "del", "la", "el", "los", "las", "un", "una", "unos", "unas", "para", "en", "y", "a", "que", "me", "mi", "quiero", "busca", "buscar", "precio", "precios", "comprar", "barato", "baratos", "baratas"]);

/** Busca en el catálogo de prueba por palabras ("audífonos", "cine sábado", "vuelo bogotá"). */
export function searchSandbox(query: string, limit = 6): SandboxProduct[] {
  const words = fold(query)
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOP.has(w));
  if (words.length === 0) return SANDBOX_PRODUCTS.filter((p) => !storeOf(p).blocksBots).slice(0, limit);
  const scored = SANDBOX_PRODUCTS.map((product) => {
    const haystack = fold([product.title, product.category, storeOf(product).name, ...product.keywords].join(" "));
    const tokens = new Set(haystack.split(/\s+/));
    let score = 0;
    for (const word of words) {
      if (tokens.has(word)) score += 2;
      else if ([...tokens].some((t) => t.startsWith(word) || (word.length > 4 && word.startsWith(t) && t.length > 3))) score += 1;
    }
    return { product, score };
  });
  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.product);
}

// ─── Páginas HTML y robots.txt ───────────────────────────────────────────

const esc = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const usd = (n: number) => `$${n.toFixed(2)}`;

export function sandboxRobots(store: SandboxStore): string {
  return store.blocksBots
    ? "User-agent: OmniAgentBot\nDisallow: /\n\nUser-agent: *\nDisallow: /checkout\n"
    : "User-agent: *\nDisallow: /carrito\nDisallow: /cuenta\nCrawl-delay: 1\n";
}

function stockText(product: SandboxProduct, quote: SandboxQuote): string {
  if (!quote.inStock) return "Agotado por ahora";
  if (quote.stockCount === null) return "Disponible";
  const unit = product.stock === "tickets" ? "entradas" : product.stock === "seats" ? "asientos" : product.stock === "rooms" ? "habitaciones" : "unidades";
  return `Quedan ${quote.stockCount} ${unit}`;
}

function shell(store: SandboxStore, title: string, head: string, body: string): string {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>${esc(title)} | ${esc(store.name)}</title>
<meta property="og:site_name" content="${esc(store.name)}">
<meta property="og:title" content="${esc(title)}">
${head}
</head>
<body>
<header><a href="/">${esc(store.name)}</a> · Tienda de prueba de OmniAgent (demo)</header>
<main>
${body}
</main>
<footer>Sitio ficticio para pruebas: ningún producto, boleto, vuelo ni hotel es real.</footer>
</body>
</html>`;
}

function ld(data: unknown): string {
  return `<script type="application/ld+json">${JSON.stringify(data)}</script>`;
}

export type SandboxResponse = { status: number; contentType: string; body: string };

/** Respuesta de la "red" de prueba para una URL .test (página, robots.txt o 404). */
export function sandboxFetch(url: URL, at: Date, flash: SandboxFlashSale | null = null): SandboxResponse {
  const store = findSandboxStore(url.hostname);
  if (!store) return { status: 404, contentType: "text/html", body: "<h1>Sitio no encontrado</h1>" };
  if (url.pathname === "/robots.txt") return { status: 200, contentType: "text/plain", body: sandboxRobots(store) };
  const product = findSandboxProduct(url);
  if (!product) return { status: 404, contentType: "text/html; charset=utf-8", body: shell(store, "Página no encontrada", "", "<h1>Esta página no existe</h1>") };
  return { status: 200, contentType: "text/html; charset=utf-8", body: renderSandboxPage(product, at, flash) };
}

export function renderSandboxPage(product: SandboxProduct, at: Date, flash: SandboxFlashSale | null = null): string {
  const store = storeOf(product);
  const quote = sandboxQuote(product, at, flash);
  const url = sandboxUrl(product);
  const availability = quote.inStock ? "https://schema.org/InStock" : "https://schema.org/OutOfStock";
  const when = product.eventDate ? product.eventDate(at).toISOString() : null;
  const visible = [
    `<h1>${esc(product.title)}</h1>`,
    `<p>${esc(product.description)}</p>`,
    quote.onSale ? `<p class="antes">Antes <s>${usd(quote.regular)}</s></p>` : "",
    `<p class="precio">${usd(quote.price)}</p>`,
    `<p>${esc(stockText(product, quote))}</p>`,
    store.deliveryDays ? `<p>Envío ${store.shipping ? usd(store.shipping) : "gratis"}${store.freeShippingOver ? ` (gratis desde ${usd(store.freeShippingOver)})` : ""}</p>` : "",
  ].join("\n");

  switch (store.style) {
    case "jsonld": {
      const data = {
        "@context": "https://schema.org",
        "@type": "Product",
        name: product.title,
        sku: product.id.toUpperCase(),
        description: product.description,
        offers: {
          "@type": "Offer",
          url,
          price: quote.price.toFixed(2),
          priceCurrency: product.currency,
          availability,
          inventoryLevel: { "@type": "QuantitativeValue", value: quote.stockCount ?? 0 },
          seller: { "@type": "Organization", name: store.name },
          shippingDetails: { "@type": "OfferShippingDetails", shippingRate: { "@type": "MonetaryAmount", value: store.shipping, currency: product.currency } },
        },
      };
      return shell(store, product.title, ld(data), visible);
    }
    case "meta": {
      const head = [
        `<meta property="og:type" content="product">`,
        `<meta property="product:price:amount" content="${quote.price.toFixed(2)}">`,
        `<meta property="product:price:currency" content="${product.currency}">`,
        `<meta property="product:availability" content="${quote.inStock ? "in stock" : "out of stock"}">`,
      ].join("\n");
      return shell(store, product.title, head, visible);
    }
    case "microdata": {
      const body = `<div itemscope itemtype="https://schema.org/Product">
<h1 itemprop="name">${esc(product.title)}</h1>
<p itemprop="description">${esc(product.description)}</p>
${quote.onSale ? `<p class="antes">Antes <s>${usd(quote.regular)}</s></p>` : ""}
<div itemprop="offers" itemscope itemtype="https://schema.org/Offer">
<meta itemprop="priceCurrency" content="${product.currency}">
<span itemprop="price" content="${quote.price.toFixed(2)}">${usd(quote.price)}</span>
<link itemprop="availability" href="${availability}">
</div>
<p>${esc(stockText(product, quote))}</p>
<p>Envío ${usd(store.shipping)} (gratis desde ${usd(store.freeShippingOver ?? 0)})</p>
</div>`;
      return shell(store, product.title, "", body);
    }
    case "event":
    case "screening": {
      const data = {
        "@context": "https://schema.org",
        "@type": store.style === "screening" ? "ScreeningEvent" : "MusicEvent",
        name: product.title,
        startDate: when,
        eventStatus: "https://schema.org/EventScheduled",
        location: { "@type": "Place", name: product.detail ?? store.name },
        ...(store.style === "screening" ? { workPresented: { "@type": "Movie", name: product.title.split(" · ")[0] } } : {}),
        offers: {
          "@type": "Offer",
          url,
          price: quote.price.toFixed(2),
          priceCurrency: product.currency,
          availability: quote.inStock ? "https://schema.org/InStock" : "https://schema.org/SoldOut",
          inventoryLevel: { "@type": "QuantitativeValue", value: quote.stockCount ?? 0 },
          validFrom: new Date(at.getTime() - 30 * DAY).toISOString(),
        },
      };
      return shell(store, product.title, ld(data), visible);
    }
    case "flight": {
      const data = {
        "@context": "https://schema.org",
        "@type": "Offer",
        url,
        name: product.title,
        price: quote.price.toFixed(2),
        priceCurrency: product.currency,
        availability,
        inventoryLevel: { "@type": "QuantitativeValue", value: quote.stockCount ?? 0 },
        itemOffered: {
          "@type": "Flight",
          name: product.title,
          flightNumber: "VY 412",
          departureAirport: { "@type": "Airport", iataCode: "MIA", name: "Aeropuerto Internacional de Miami" },
          arrivalAirport: { "@type": "Airport", iataCode: "BOG", name: "Aeropuerto El Dorado" },
          departureTime: when,
        },
      };
      return shell(store, product.title, ld(data), visible);
    }
    case "hotel": {
      const data = {
        "@context": "https://schema.org",
        "@type": "Hotel",
        name: product.title,
        checkinTime: when,
        address: { "@type": "PostalAddress", addressLocality: product.detail ?? "Cartagena", addressCountry: "CO" },
        makesOffer: {
          "@type": "Offer",
          url,
          price: quote.price.toFixed(2),
          priceCurrency: product.currency,
          availability,
          inventoryLevel: { "@type": "QuantitativeValue", value: quote.stockCount ?? 0 },
        },
      };
      return shell(store, product.title, ld(data), visible);
    }
    case "plain": {
      // Sin datos estructurados: el precio solo aparece en el texto, entre otros montos (antes, envío, cuotas).
      const installment = (quote.price / 12).toFixed(2).replace(".", ",");
      const body = `<h1>${esc(product.title)}</h1>
<p>${esc(product.description)} Modelo 2025.</p>
${quote.onSale ? `<p>Antes US$ ${quote.regular.toFixed(0)}</p>` : ""}
<p><strong>Precio: US$ ${quote.price.toFixed(0)}</strong></p>
<p>Hasta 12 cuotas de US$ ${installment}</p>
<p>Envío a todo el país: US$ ${store.shipping}</p>
<p>${esc(stockText(product, quote))}</p>`;
      return shell(store, product.title, "", body);
    }
  }
}
