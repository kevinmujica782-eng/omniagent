import { ANT_CATEGORY, FEES_CATEGORY, INCOME_CATEGORY, TRANSFER_CATEGORY } from "../categories";
import { fold, squash } from "./text";
import type { Direction } from "./types";

// Comercio y categoría de cada movimiento importado, con la misma taxonomía que usan Plaid y el sandbox
// (categories.ts). El nombre canónico del comercio ("Netflix" y no "NETFLIX.COM 8472") hace que el mismo cargo
// se agrupe mes a mes: de eso dependen los cargos recurrentes y los gastos hormiga.

export interface Categorized {
  merchantName: string;
  category: string;
  subcategory: string | null;
}

interface Rule {
  /** Sobre el texto sin acentos ni signos, en minúsculas. */
  re: RegExp;
  category: string;
  subcategory?: string;
  merchant?: string;
  /** La regla solo aplica a cargos o a abonos. */
  only?: Direction;
}

// El orden importa: lo específico antes que lo general ("uber eats" antes que "uber", "oxxo gas" antes que "oxxo").
const RULES: Rule[] = [
  // Ingresos
  { re: /\b(nomina|salario|sueldo|payroll|direct deposit|pago de nomina)\b/, category: INCOME_CATEGORY, only: "CREDIT" },
  { re: /\b(intereses? (ganados?|a favor|generados?)|rendimientos?|interest (paid|earned)|cash ?back|bonificacion)\b/, category: INCOME_CATEGORY, only: "CREDIT" },
  // Entre cuentas propias y pagos de tarjeta: no son ingreso ni gasto.
  {
    re: /\b(pago (a |de )?(tu |la |su )?(tarjeta|tdc)|pago tdc|su pago|gracias por su pago|payment thank you|payment received|autopay|pago recibido|traspaso|entre cuentas|cuenta propia|transferencia propia|mismo titular)\b/,
    category: TRANSFER_CATEGORY,
  },
  {
    re: /\b(retiro (en |de )?(cajero|atm|efectivo)|disposicion (de )?efectivo|atm withdrawal|cash withdrawal|retiro sin tarjeta)\b/,
    category: TRANSFER_CATEGORY,
    merchant: "Retiro de efectivo",
    only: "DEBIT",
  },
  // Comisiones e intereses cobrados
  {
    re: /\b(comision(es)?|anualidad|cuota anual|interes(es)?|interest charge|late fee|overdraft|annual fee|service fee|monthly fee|penalizacion|cargo por (mora|pago tardio)|iva)\b/,
    category: FEES_CATEGORY,
    only: "DEBIT",
  },
  // Comida a domicilio y restaurantes (antes que "uber" y "didi")
  { re: /\buber ?eats\b/, merchant: "Uber Eats", category: "Restaurantes" },
  { re: /\bdidi ?food\b/, merchant: "DiDi Food", category: "Restaurantes" },
  { re: /\brappi\b/, merchant: "Rappi", category: "Restaurantes" },
  { re: /\b(doordash|grubhub|just eat|sin delantal|pedidos ?ya|ifood)\b/, category: "Restaurantes" },
  // Suscripciones de video, música y software
  { re: /\bnetflix\b/, merchant: "Netflix", category: "Entretenimiento", subcategory: "video" },
  { re: /\bdisney\b/, merchant: "Disney+", category: "Entretenimiento", subcategory: "video" },
  { re: /\bhbo\b/, merchant: "HBO Max", category: "Entretenimiento", subcategory: "video" },
  { re: /\b(prime ?video|amazon prime|amzn prime|prime membership)\b/, merchant: "Amazon Prime", category: "Entretenimiento", subcategory: "video" },
  { re: /\bparamount\b/, merchant: "Paramount+", category: "Entretenimiento", subcategory: "video" },
  { re: /\bcrunchyroll\b/, merchant: "Crunchyroll", category: "Entretenimiento", subcategory: "video" },
  { re: /\b(vix|mubi|apple ?tv)\b/, category: "Entretenimiento", subcategory: "video" },
  { re: /\byoutube\b/, merchant: "YouTube Premium", category: "Entretenimiento", subcategory: "video" },
  { re: /\bspotify\b/, merchant: "Spotify", category: "Entretenimiento", subcategory: "musica" },
  { re: /\b(apple ?music|deezer|tidal|amazon music)\b/, category: "Entretenimiento", subcategory: "musica" },
  { re: /\b(cinepolis|cinemex|cinemark|cine|ticketmaster|steam|playstation|xbox|nintendo)\b/, category: "Entretenimiento" },
  { re: /\bicloud\b/, merchant: "iCloud", category: "Software", subcategory: "almacenamiento" },
  { re: /\b(google ?one|google storage)\b/, merchant: "Google One", category: "Software", subcategory: "almacenamiento" },
  { re: /\bdropbox\b/, merchant: "Dropbox", category: "Software", subcategory: "almacenamiento" },
  { re: /\b(apple com bill|itunes)\b/, merchant: "Apple", category: "Software" },
  { re: /\b(microsoft|office 365|adobe|openai|chatgpt|notion|canva|github|zoom|1password|duolingo)\b/, category: "Software", subcategory: "software" },
  // Gimnasio y cuidado personal
  { re: /\b(smart ?fit|sport ?city|anytime fitness|planet fitness|gimnasio|gym)\b/, category: "Cuidado personal", subcategory: "gimnasio" },
  { re: /\b(barberia|estetica|salon de belleza|spa|sephora|ulta)\b/, category: "Cuidado personal" },
  // Transporte
  { re: /\boxxo gas\b/, merchant: "OXXO Gas", category: "Transporte" },
  { re: /\b(pemex|gasolinera|gasolina|gas station|shell|mobil|exxon|chevron|texaco|g500|repsol|petro ?7)\b/, category: "Transporte" },
  { re: /\buber\b/, merchant: "Uber", category: "Transporte" },
  { re: /\bdidi\b/, merchant: "DiDi", category: "Transporte" },
  { re: /\b(cabify|lyft|indrive|taxi)\b/, category: "Transporte" },
  { re: /\b(estacionamiento|parking|parquimetro|peaje|caseta|iave|televia|pase urbano|metrobus|metro|autobus|ado|primera plus|etn)\b/, category: "Transporte" },
  // Viajes
  {
    re: /\b(aeromexico|volaris|viva ?aerobus|avianca|latam|copa airlines|american airlines|united airlines|delta air|jetblue|southwest|iberia|airbnb|booking|expedia|despegar|marriott|hilton|hyatt|hotel)\b/,
    category: "Viajes",
  },
  // Café y antojos (gastos hormiga)
  { re: /\boxxo\b/, merchant: "OXXO", category: ANT_CATEGORY },
  { re: /\bstarbucks\b/, merchant: "Starbucks", category: ANT_CATEGORY },
  { re: /\b(7 ?eleven|seven eleven)\b/, merchant: "7-Eleven", category: ANT_CATEGORY },
  { re: /\b(circle k|kiosko)\b/, category: ANT_CATEGORY },
  {
    re: /\b(cafe|cafeteria|coffee|dunkin|tim hortons|punta del cielo|italian coffee|cielito|panaderia|paleteria|neveria|heladeria|dulceria|vending)\b/,
    category: ANT_CATEGORY,
  },
  // Supermercado
  { re: /\b(walmart|wal mart)\b/, merchant: "Walmart", category: "Supermercado" },
  { re: /\bcostco\b/, merchant: "Costco", category: "Supermercado" },
  {
    re: /\b(bodega aurrera|aurrera|sam s club|sams club|soriana|chedraui|la comer|superama|fresko|city market|heb|h e b|alsuper|calimax|casa ley|kroger|safeway|whole foods|trader joe|aldi|lidl|publix|carrefour|mercadona|supermercado|super mercado)\b/,
    category: "Supermercado",
  },
  // Compras
  { re: /\b(mercado ?libre|mercadolibre)\b/, merchant: "Mercado Libre", category: "Compras" },
  { re: /\b(mercado ?pago|mercadopago)\b/, merchant: "Mercado Pago", category: "Compras" },
  { re: /\b(amazon|amzn)\b/, merchant: "Amazon", category: "Compras" },
  {
    re: /\b(liverpool|palacio de hierro|sears|coppel|elektra|suburbia|sanborns|shein|aliexpress|temu|zara|bershka|nike|adidas|best buy|apple store|target|ebay|etsy)\b/,
    category: "Compras",
  },
  // Hogar
  { re: /\b(home depot|ikea|lowes|the home store|comex|sherwin|ferreteria|truper)\b/, category: "Hogar" },
  // Salud
  {
    re: /\b(farmacias?|benavides|similares|cvs|walgreens|pharmacy|hospital|medico|doctor|clinica|laboratorio|chopo|salud digna|dentista|dental|optica)\b/,
    category: "Salud",
  },
  // Servicios del hogar y telefonía
  {
    re: /\b(cfe|telmex|telcel|izzi|totalplay|total play|megacable|sky|dish|bait|at t|movistar|claro|naturgy|gas natural|sacmex|agua potable|comcast|xfinity|spectrum|verizon|t mobile)\b/,
    category: "Servicios",
  },
  // Vivienda
  { re: /\b(renta|alquiler|arrendamiento|rent|hipoteca|mortgage|mantenimiento condominio|cuota de mantenimiento)\b/, category: "Vivienda", only: "DEBIT" },
  // Impuestos y donaciones
  { re: /\b(sat|impuestos?|predial|tenencia|refrendo|tesoreria|irs|donativo|donacion|cruz roja|teleton|unicef)\b/, category: "Impuestos y donaciones", only: "DEBIT" },
  // Restaurantes (genérico, después de las marcas)
  {
    re: /\b(restaurante?s?|taqueria|tacos|pizza|pizzeria|burger|hamburguesas?|mcdonald s?|mc donalds?|kfc|domino s?|little caesars|subway|carl s jr|burger king|wings|sushi|cocina|fonda|bistro|grill|cantina|mariscos|bar|vips|toks|chili s|applebee s|italianni s?)\b/,
    category: "Restaurantes",
  },
  // Transferencias a terceros (después de renta y demás, que también llegan por SPEI)
  { re: /\b(spei|transferencia|transfer|zelle|venmo|paypal|wise|remesa|envio de dinero)\b/, category: TRANSFER_CATEGORY, only: "DEBIT" },
];

// Procesadores de pago que anteponen su nombre al del comercio: "PAYPAL *SPOTIFY", "SQ *CAFE LUNA".
const PROCESSOR = /^(?:sq|tst|paypal|pp|merpago|mp|clip|conekta|stripe|google|dlo|dlocal|payu|ebanx|openpay|netpay|billpocket|sumup|iz|zettle)\s*\*\s*/i;
const PREFIXES =
  /^(?:(?:compra|compras|pago|cargo|consumo|purchase|pos|debit|debito|tdd|tdc|deb|db|visa|mastercard|mc|apple pay|google pay|contactless|recurring|domiciliacion|domiciliado|card|checkcard|online|internet|web|en|con|tarjeta|de|por|a|authorized|on|deposito|abono|spei|enviado|recibido|transferencia|transf|traspaso)\b[\s.:-]*)+/i;
/** Razón social al final: "S.A. DE C.V.", "SA DE CV", "S. DE R.L.", "SAPI DE CV", "INC", "LLC"... */
const CORPORATE =
  /\s+(?:s\.?\s?a\.?\s?(?:p\.?\s?i\.?\s?)?(?:de\s?c\.?\s?v\.?)?|s\.?\s?de\s?r\.?\s?l\.?(?:\s?de\s?c\.?\s?v\.?)?|sapi(?:\s?de\s?c\.?\s?v\.?)?|inc\.?|llc|ltd\.?|corp\.?)$/i;
const CONNECTORS = new Set(["de", "del", "la", "las", "el", "los", "y", "en", "a", "por", "of", "the", "and"]);
const ACRONYMS = new Set(["bbva", "hsbc", "imss", "issste", "cfe", "sat", "heb", "ado", "etn", "iave", "spei", "atm", "cdmx", "ikea", "kfc", "vips", "toks", "usa", "iva"]);

function titleCase(text: string): string {
  return text
    .toLowerCase()
    .split(" ")
    .map((word, i) => {
      if (i > 0 && CONNECTORS.has(word)) return word;
      if (ACRONYMS.has(word) || (word.length <= 4 && !/[aeiouy]/.test(word))) return word.toUpperCase();
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(" ");
}

/** Comercio legible a partir de la descripción del banco (sin prefijos, referencias, tarjetas ni fechas). */
export function merchantFromDescription(description: string): string {
  let text = squash(description);
  const processor = PROCESSOR.exec(text);
  if (processor) text = text.slice(processor[0].length);
  else if (/\*/.test(text)) {
    const [head] = text.split("*");
    if (head.trim().length >= 3) text = head;
  }
  text = text
    .replace(/\b(?:x{2,}|\*{2,})\d{2,4}\b/gi, " ") // tarjetas: XXXX1234
    .replace(/\b(?:tarj(?:eta)?|card)\s*(?:no\.?|#)?\s*\d+/gi, " ")
    .replace(/\b(?:ref(?:erencia)?|aut(?:orizacion)?|folio|no|num(?:ero)?|rastreo|clave|operacion|op|trx|id|rfc)\.?\s*[:#.]?\s*[a-z0-9-]*\d[a-z0-9-]*/gi, " ")
    .replace(/\b\d{1,2}[/.-]\d{1,2}(?:[/.-]\d{2,4})?\b/g, " ") // fechas
    .replace(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g, " ") // horas
    .replace(/\b(?=[a-z0-9]*\d)[a-z0-9]{6,}\b/gi, " ") // códigos con números
    .replace(/\b\d+\b/g, " ")
    .replace(/[#*_|\\]+/g, " ");
  text = squash(text).replace(PREFIXES, "");
  text = text.replace(CORPORATE, "");
  const cut = /\b(suc(?:ursal)?|store|tienda|unidad)\b/i.exec(text);
  if (cut && cut.index >= 3) text = text.slice(0, cut.index);
  text = squash(text).replace(/^[\s\-.,/:]+|[\s\-.,/:]+$/g, "");
  if (text.length < 2) text = squash(description);
  return titleCase(text).slice(0, 60).trim();
}

export function categorize(description: string, direction: Direction): Categorized {
  const text = fold(description);
  for (const rule of RULES) {
    if (rule.only && rule.only !== direction) continue;
    if (!rule.re.test(text)) continue;
    return {
      merchantName: rule.merchant ?? merchantFromDescription(description),
      // Un abono de un comercio es un reembolso: conserva la categoría del comercio.
      category: rule.category,
      subcategory: rule.subcategory ?? null,
    };
  }
  return {
    merchantName: merchantFromDescription(description),
    // Los abonos sin pista son ingresos (nómina por SPEI, clientes, reembolsos); los cargos, "Otros".
    category: direction === "CREDIT" ? INCOME_CATEGORY : "Otros",
    subcategory: null,
  };
}
