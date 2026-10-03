// Extracción del precio de una página de producto, boleto, vuelo u hotel a partir de sus datos públicos:
// 1) JSON-LD de schema.org (Product, Offer, AggregateOffer, Event, Flight, Hotel...),
// 2) microdatos (itemprop="price"), 3) metaetiquetas (product:price:amount, og:price:amount).
// Sin DOM ni dependencias de servidor: expresiones acotadas sobre el HTML, probadas con páginas reales y de prueba.
import type { PriceMethodId, WatchKindId } from "@/types/cards";
import { normalizeCurrency, parseMoney, parseStructuredPrice } from "./money";

export type PriceMethod = PriceMethodId;

export interface PageOffer {
  title: string;
  price: number;
  currency: string | null;
  inStock: boolean | null;
  stockCount: number | null;
  merchant: string | null;
  kind: WatchKindId;
  method: PriceMethod;
  /** Costo de envío publicado en la oferta (schema.org shippingDetails), si lo hay. */
  shipping: number | null;
  /** La página tiene varias ofertas con precios distintos (tallas, colores, zonas). */
  multipleOffers: boolean;
  /** Fecha del evento, la función o el vuelo (ISO), si aplica. */
  eventDate: string | null;
  /** Lugar o ruta ("Teatro Colón", "MIA → BOG"). */
  detail: string | null;
}

export interface PageFacts {
  title: string | null;
  siteName: string | null;
  lang: string | null;
  currencyHint: string | null;
}

// ─── HTML básico ─────────────────────────────────────────────────────────

const NAMED: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", hellip: "…", laquo: "«", raquo: "»",
  aacute: "á", eacute: "é", iacute: "í", oacute: "ó", uacute: "ú", Aacute: "Á", Eacute: "É", Iacute: "Í", Oacute: "Ó", Uacute: "Ú",
  ntilde: "ñ", Ntilde: "Ñ", uuml: "ü", Uuml: "Ü", ccedil: "ç", iexcl: "¡", iquest: "¿", euro: "€", pound: "£", yen: "¥",
  cent: "¢", copy: "©", reg: "®", trade: "™", deg: "°", ordm: "º", ordf: "ª", middot: "·", times: "×", rarr: "→", bull: "•",
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === "#") {
      const n = code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : whole;
    }
    return NAMED[code] ?? NAMED[code.toLowerCase()] ?? whole;
  });
}

function parseAttributes(source: string): Map<string, string> {
  const attrs = new Map<string, string>();
  const re = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) {
    attrs.set(m[1].toLowerCase(), decodeEntities(m[2] ?? m[3] ?? m[4] ?? ""));
  }
  return attrs;
}

/** Quita scripts, estilos y comentarios (lo que no es contenido visible ni metadatos). */
function stripNonContent(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|template|svg|iframe)\b[\s\S]*?<\/\1\s*>/gi, " ");
}

function tagsNamed(markup: string, name: string): Map<string, string>[] {
  const out: Map<string, string>[] = [];
  const re = new RegExp(`<${name}\\b([^>]*)>`, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(markup))) out.push(parseAttributes(m[1]));
  return out;
}

const clean = (value: string | null | undefined, max = 200) => {
  if (!value) return null;
  const text = decodeEntities(value).replace(/\s+/g, " ").trim();
  return text ? text.slice(0, max) : null;
};

/** Texto visible de la página (para la lectura con IA cuando no hay datos estructurados). */
export function pageText(html: string, max = 12_000): string {
  const body = /<body\b[^>]*>([\s\S]*)<\/body>/i.exec(html)?.[1] ?? html;
  return decodeEntities(
    stripNonContent(body)
      .replace(/<(br|\/p|\/div|\/li|\/h\d|\/tr|\/section|\/article)\b[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t ]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim()
    .slice(0, max);
}

// ─── JSON-LD ─────────────────────────────────────────────────────────────

type Node = Record<string, unknown>;
const isNode = (v: unknown): v is Node => typeof v === "object" && v !== null && !Array.isArray(v);
const asArray = <T,>(v: T | T[] | undefined | null): T[] => (v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]);

function typesOf(node: Node): string[] {
  return asArray(node["@type"] as string | string[] | undefined)
    .filter((t): t is string => typeof t === "string")
    .map((t) => t.replace(/^https?:\/\/schema\.org\//i, "").toLowerCase());
}

function jsonLdBlocks(html: string): unknown[] {
  const out: unknown[] = [];
  const re = /<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script\s*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const text = m[1]
      .trim()
      .replace(/^<!--/, "")
      .replace(/-->$/, "")
      .replace(/^\/\/<!\[CDATA\[|\/\/\]\]>$/g, "")
      .trim();
    try {
      out.push(JSON.parse(text));
    } catch {
      try {
        out.push(JSON.parse(text.replace(/[\u0000-\u001f]+/g, " ")));
      } catch {
        // bloque inválido: se ignora
      }
    }
  }
  return out;
}

/** Todos los nodos con @type, recorriendo @graph, arreglos y objetos anidados (con tope de profundidad). */
function collectNodes(value: unknown, out: Node[] = [], depth = 0): Node[] {
  if (depth > 8 || out.length > 400) return out;
  if (Array.isArray(value)) {
    for (const item of value) collectNodes(item, out, depth + 1);
    return out;
  }
  if (!isNode(value)) return out;
  if (value["@type"]) out.push(value);
  for (const [key, child] of Object.entries(value)) {
    if (key === "@context") continue;
    if (typeof child === "object" && child !== null) collectNodes(child, out, depth + 1);
  }
  return out;
}

const PRODUCT_TYPES = ["product", "productgroup", "individualproduct", "productmodel", "vehicle", "car", "book", "softwareapplication"];
const EVENT_TYPES = ["event", "musicevent", "theaterevent", "screeningevent", "sportsevent", "comedyevent", "festival", "danceevent", "exhibitionevent", "socialevent", "childrensevent", "educationevent"];
const FLIGHT_TYPES = ["flight", "flightreservation", "bustrip", "trip", "touristtrip", "traintrip"];
const HOTEL_TYPES = ["hotel", "lodgingbusiness", "hotelroom", "accommodation", "resort", "hostel", "motel", "bedandbreakfast", "vacationrental", "lodgingreservation"];

function kindOf(types: string[]): WatchKindId | null {
  if (types.some((t) => EVENT_TYPES.includes(t))) return "EVENT_TICKET";
  if (types.some((t) => FLIGHT_TYPES.includes(t))) return "FLIGHT";
  if (types.some((t) => HOTEL_TYPES.includes(t))) return "HOTEL";
  if (types.some((t) => PRODUCT_TYPES.includes(t))) return "PRODUCT";
  return null;
}

function nameOf(node: Node | null | undefined): string | null {
  if (!node) return null;
  const name = node.name;
  if (typeof name === "string") return clean(name, 160);
  if (isNode(name) && typeof name["@value"] === "string") return clean(name["@value"], 160);
  return null;
}

function availabilityOf(value: unknown): boolean | null {
  if (typeof value !== "string") return null;
  const v = value.toLowerCase();
  if (/outofstock|soldout|discontinued|out of stock|agotado/.test(v)) return false;
  if (/instock|limitedavailability|instoreonly|onlineonly|preorder|presale|backorder|in stock/.test(v)) return true;
  return null;
}

type Candidate = {
  item: Node | null;
  itemTypes: string[];
  offer: Node;
  price: number;
  currency: string | null;
  inStock: boolean | null;
  stockCount: number | null;
  shipping: number | null;
  seller: string | null;
  url: string | null;
  aggregate: boolean;
};

function offerPrice(offer: Node, hint: string | null): { price: number | null; currency: string | null } {
  let currency = normalizeCurrency(offer.priceCurrency) ?? null;
  let price = parseStructuredPrice(offer.price, currency ?? hint) ?? parseStructuredPrice(offer.lowPrice, currency ?? hint);
  if (price === null) {
    for (const spec of asArray(offer.priceSpecification as Node | Node[])) {
      if (!isNode(spec)) continue;
      const specPrice = parseStructuredPrice(spec.price, currency ?? hint) ?? parseStructuredPrice(spec.minPrice, currency ?? hint);
      if (specPrice !== null) {
        price = specPrice;
        currency = normalizeCurrency(spec.priceCurrency) ?? currency;
        break;
      }
    }
  }
  return { price, currency };
}

function shippingOf(offer: Node, currency: string | null): number | null {
  for (const detail of asArray(offer.shippingDetails as Node | Node[])) {
    if (!isNode(detail)) continue;
    const rate = detail.shippingRate;
    if (!isNode(rate)) continue;
    const rateCurrency = normalizeCurrency(rate.currency) ?? currency;
    const value = typeof rate.value === "number" ? rate.value : typeof rate.value === "string" ? Number(rate.value) : NaN;
    if (Number.isFinite(value) && value >= 0 && value < 10_000 && rateCurrency === currency) return Math.round(value * 100) / 100;
  }
  return null;
}

function stockOf(offer: Node): number | null {
  const level = offer.inventoryLevel;
  const value = isNode(level) ? level.value : level;
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isInteger(n) && n >= 0 && n < 1_000_000 ? n : null;
}

function candidatesFrom(nodes: Node[], hint: string | null): Candidate[] {
  const out: Candidate[] = [];
  const seen = new Set<Node>();
  const push = (item: Node | null, offer: Node) => {
    if (seen.has(offer)) return;
    const types = typesOf(offer);
    if (!types.some((t) => t === "offer" || t === "aggregateoffer")) return;
    seen.add(offer);
    // Una AggregateOffer puede traer sus ofertas individuales: se prefieren esas si tienen precio.
    const inner = asArray(offer.offers as Node | Node[]).filter(isNode);
    if (types.includes("aggregateoffer") && inner.length > 0) {
      const before = out.length;
      for (const child of inner) push(item, child);
      if (out.length > before) return;
    }
    const { price, currency } = offerPrice(offer, hint);
    if (price === null) return;
    const seller = isNode(offer.seller) ? nameOf(offer.seller) : null;
    out.push({
      item,
      itemTypes: item ? typesOf(item) : [],
      offer,
      price,
      currency: currency ?? hint,
      inStock: availabilityOf(offer.availability),
      stockCount: stockOf(offer),
      shipping: shippingOf(offer, currency ?? hint),
      seller,
      url: typeof offer.url === "string" ? offer.url : null,
      aggregate: types.includes("aggregateoffer"),
    });
  };

  for (const node of nodes) {
    const types = typesOf(node);
    if (kindOf(types)) {
      for (const offer of [...asArray(node.offers as Node | Node[]), ...asArray(node.makesOffer as Node | Node[])]) {
        if (isNode(offer)) push(node, offer);
      }
      for (const variant of asArray(node.hasVariant as Node | Node[])) {
        if (!isNode(variant)) continue;
        for (const offer of asArray(variant.offers as Node | Node[])) if (isNode(offer)) push(variant, offer);
      }
    }
  }
  // Ofertas sueltas con itemOffered (vuelos, paquetes).
  for (const node of nodes) {
    const types = typesOf(node);
    if ((types.includes("offer") || types.includes("aggregateoffer")) && !seen.has(node)) {
      push(isNode(node.itemOffered) ? node.itemOffered : null, node);
    }
  }
  return out;
}

function tokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 2),
  );
}

function similarity(a: string | null, b: string | null): number {
  if (!a || !b) return 0;
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let common = 0;
  for (const t of ta) if (tb.has(t)) common++;
  return common / Math.min(ta.size, tb.size);
}

function sameResource(offerUrl: string | null, pageUrl: string): boolean {
  if (!offerUrl) return false;
  try {
    const a = new URL(offerUrl, pageUrl);
    const b = new URL(pageUrl);
    return a.host === b.host && a.pathname.replace(/\/$/, "") === b.pathname.replace(/\/$/, "") && a.search === b.search;
  } catch {
    return false;
  }
}

function eventFacts(item: Node | null): { eventDate: string | null; detail: string | null } {
  if (!item) return { eventDate: null, detail: null };
  const types = typesOf(item);
  const iso = (v: unknown) => (typeof v === "string" && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : null);
  if (types.some((t) => FLIGHT_TYPES.includes(t))) {
    const code = (airport: unknown) => (isNode(airport) && typeof airport.iataCode === "string" ? airport.iataCode.toUpperCase().slice(0, 4) : null);
    const from = code(item.departureAirport);
    const to = code(item.arrivalAirport);
    const number = typeof item.flightNumber === "string" ? item.flightNumber.slice(0, 12) : null;
    const route = from && to ? `${from} → ${to}` : null;
    return { eventDate: iso(item.departureTime), detail: [route, number].filter(Boolean).join(" · ") || null };
  }
  if (types.some((t) => EVENT_TYPES.includes(t))) {
    const location = isNode(item.location) ? nameOf(item.location) : typeof item.location === "string" ? clean(item.location, 80) : null;
    return { eventDate: iso(item.startDate), detail: location };
  }
  if (types.some((t) => HOTEL_TYPES.includes(t))) {
    const address = isNode(item.address) && typeof item.address.addressLocality === "string" ? clean(item.address.addressLocality, 60) : null;
    return { eventDate: iso(item.checkinTime), detail: address };
  }
  return { eventDate: null, detail: null };
}

// ─── Metaetiquetas y microdatos ─────────────────────────────────────────

function metaMap(markup: string): Map<string, string> {
  const meta = new Map<string, string>();
  for (const attrs of tagsNamed(markup, "meta")) {
    const key = (attrs.get("property") ?? attrs.get("name") ?? attrs.get("itemprop") ?? "").toLowerCase();
    const content = attrs.get("content");
    if (key && content !== undefined && !meta.has(key)) meta.set(key, content);
  }
  return meta;
}

function fromMeta(meta: Map<string, string>, hint: string | null): { price: number; currency: string | null; inStock: boolean | null } | null {
  const currency =
    normalizeCurrency(meta.get("product:price:currency")) ?? normalizeCurrency(meta.get("og:price:currency")) ?? hint;
  const raw = meta.get("product:price:amount") ?? meta.get("og:price:amount") ?? meta.get("product:price") ?? null;
  let price = raw ? parseStructuredPrice(raw, currency) : null;
  let found = currency;
  if (price === null) {
    // Twitter Cards: twitter:label1 = "Precio", twitter:data1 = "$248.00"
    for (const n of ["1", "2"]) {
      const label = meta.get(`twitter:label${n}`)?.toLowerCase() ?? "";
      const data = meta.get(`twitter:data${n}`);
      if (data && /price|precio|preço/.test(label)) {
        const money = parseMoney(data, currency);
        if (money) {
          price = money.amount;
          found = money.currency;
          break;
        }
      }
    }
  }
  if (price === null) return null;
  const availability = meta.get("product:availability") ?? meta.get("og:availability") ?? null;
  return { price, currency: found, inStock: availability ? availabilityOf(availability.replace(/\s+/g, "")) : null };
}

function fromMicrodata(markup: string, hint: string | null): { price: number; currency: string | null; inStock: boolean | null; name: string | null } | null {
  let priceText: string | null = null;
  const re = /<([a-z][a-z0-9]*)\b([^>]*\bitemprop\s*=\s*["']?price["']?[^>]*)>([^<]{0,80})/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(markup))) {
    const attrs = parseAttributes(m[2]);
    if (attrs.get("itemprop")?.toLowerCase() !== "price") continue;
    priceText = attrs.get("content") ?? decodeEntities(m[3]).trim();
    if (priceText) break;
  }
  if (!priceText) return null;
  let currency: string | null = hint;
  let inStock: boolean | null = null;
  let name: string | null = null;
  for (const tag of ["meta", "link", "span", "div", "h1", "h2"]) {
    for (const attrs of tagsNamed(markup, tag)) {
      const prop = attrs.get("itemprop")?.toLowerCase();
      if (prop === "pricecurrency") currency = normalizeCurrency(attrs.get("content")) ?? currency;
      if (prop === "availability") inStock = availabilityOf(attrs.get("href") ?? attrs.get("content") ?? "") ?? inStock;
    }
  }
  const nameMatch = /<[a-z0-9]+\b[^>]*\bitemprop\s*=\s*["']?name["']?[^>]*>([^<]{1,200})</i.exec(markup);
  if (nameMatch) name = clean(nameMatch[1], 160);
  const structured = parseStructuredPrice(priceText, currency);
  const money = structured === null ? parseMoney(priceText, currency) : { amount: structured, currency };
  if (!money) return null;
  return { price: money.amount, currency: money.currency ?? currency, inStock, name };
}

function titleOf(markup: string, meta: Map<string, string>, siteName: string | null): string | null {
  const og = clean(meta.get("og:title") ?? meta.get("twitter:title"), 160);
  if (og) return og;
  const raw = clean(/<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(markup)?.[1], 200);
  if (!raw) return null;
  const parts = raw.split(/\s+[|–—-]\s+/);
  if (parts.length > 1 && siteName && similarity(parts[parts.length - 1], siteName) >= 0.5) return parts.slice(0, -1).join(" - ");
  return parts.length > 1 ? parts[0] : raw;
}

function hostLabel(pageUrl: string): string | null {
  try {
    return new URL(pageUrl).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

// ─── Punto de entrada ────────────────────────────────────────────────────

export function extractOffer(html: string, pageUrl: string): { offer: PageOffer | null; facts: PageFacts } {
  const markup = stripNonContent(html);
  const meta = metaMap(markup);
  const siteName = clean(meta.get("og:site_name") ?? meta.get("application-name"), 80);
  const lang = /<html\b[^>]*\blang\s*=\s*["']?([a-z-]{2,10})/i.exec(html)?.[1]?.toLowerCase() ?? null;
  const currencyHint = normalizeCurrency(meta.get("product:price:currency") ?? meta.get("og:price:currency") ?? null);
  const pageTitle = titleOf(markup, meta, siteName);
  const facts: PageFacts = { title: pageTitle, siteName, lang, currencyHint };

  // 1) JSON-LD
  const nodes = collectNodes(jsonLdBlocks(html));
  const candidates = candidatesFrom(nodes, currencyHint);
  if (candidates.length > 0) {
    const scored = candidates.map((c) => {
      let score = 0;
      if (kindOf(c.itemTypes)) score += 3;
      // La variante del enlace manda (aunque esté agotada: así se avisa cuando vuelva y baje).
      if (sameResource(c.url, pageUrl)) score += 4;
      if (c.inStock === true) score += 1;
      if (c.inStock === false) score -= 1;
      if (!c.aggregate) score += 0.5;
      score += similarity(nameOf(c.item), pageTitle);
      return { c, score };
    });
    scored.sort((a, b) => b.score - a.score || a.c.price - b.c.price);
    const best = scored[0].c;
    const sameItem = candidates.filter((c) => c.item === best.item || (c.item && best.item && nameOf(c.item) === nameOf(best.item)));
    const prices = new Set(sameItem.map((c) => c.price));
    const { eventDate, detail } = eventFacts(best.item);
    return {
      facts,
      offer: {
        title: nameOf(best.item) ?? pageTitle ?? hostLabel(pageUrl) ?? "Producto",
        price: best.price,
        currency: best.currency,
        inStock: best.inStock,
        stockCount: best.stockCount,
        merchant: best.seller ?? siteName ?? hostLabel(pageUrl),
        kind: kindOf(best.itemTypes) ?? "PRODUCT",
        method: "jsonld",
        shipping: best.shipping,
        multipleOffers: prices.size > 1,
        eventDate,
        detail,
      },
    };
  }

  // 2) Microdatos
  const micro = fromMicrodata(markup, currencyHint);
  if (micro) {
    return {
      facts,
      offer: {
        title: micro.name ?? pageTitle ?? hostLabel(pageUrl) ?? "Producto",
        price: micro.price,
        currency: micro.currency,
        inStock: micro.inStock,
        stockCount: null,
        merchant: siteName ?? hostLabel(pageUrl),
        kind: "PRODUCT",
        method: "microdata",
        shipping: null,
        multipleOffers: false,
        eventDate: null,
        detail: null,
      },
    };
  }

  // 3) Metaetiquetas
  const fromTags = fromMeta(meta, currencyHint);
  if (fromTags) {
    return {
      facts,
      offer: {
        title: pageTitle ?? hostLabel(pageUrl) ?? "Producto",
        price: fromTags.price,
        currency: fromTags.currency,
        inStock: fromTags.inStock,
        stockCount: null,
        merchant: siteName ?? hostLabel(pageUrl),
        kind: "PRODUCT",
        method: "meta",
        shipping: null,
        multipleOffers: false,
        eventDate: null,
        detail: null,
      },
    };
  }
  return { facts, offer: null };
}
