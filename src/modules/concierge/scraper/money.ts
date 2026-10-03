// Lectura de precios y monedas en texto de páginas web ("$1,299.90", "1.299,90 €", "COP 1.250.000", "US$ 248").
// Sin dependencias de servidor: lo usan el rastreador, la validación de la IA y las pruebas.

/** Monedas aceptadas (ISO 4217). Un código fuera de la lista se descarta en vez de adivinar. */
export const CURRENCIES = new Set([
  "USD", "EUR", "GBP", "CAD", "AUD", "NZD", "CHF", "JPY", "CNY", "INR", "BRL", "MXN", "COP", "ARS", "CLP",
  "PEN", "UYU", "PYG", "BOB", "VES", "CRC", "GTQ", "HNL", "NIO", "PAB", "DOP", "SEK", "NOK", "DKK", "PLN",
  "CZK", "HUF", "ZAR", "KRW", "SGD", "HKD", "TWD", "ILS", "TRY", "AED",
]);

/** Monedas sin centavos en la práctica (el punto o la coma son separadores de miles). */
const ZERO_DECIMAL = new Set(["JPY", "KRW", "CLP", "PYG", "COP"]);

// Códigos en mayúsculas como palabra completa ("USD 248", "248 COP"): no ambiguos.
const CODE_RE = new RegExp(`(?:^|[^A-Za-z])(${[...CURRENCIES].join("|")})(?![A-Za-z])`);

// Símbolos, del más específico al más general. "$" solo es ambiguo (USD, MXN, COP, ARS...): lo resuelve la pista.
const SYMBOLS: [RegExp, string][] = [
  [/(?:^|[^A-Za-z])(?:US\$|U\$S)/, "USD"],
  [/(?:^|[^A-Za-z])AR\$/, "ARS"],
  [/(?:^|[^A-Za-z])COL?\$/, "COP"],
  [/(?:^|[^A-Za-z])MX\$/, "MXN"],
  [/(?:^|[^A-Za-z])CA?\$/, "CAD"],
  [/(?:^|[^A-Za-z])A\$/, "AUD"],
  [/(?:^|[^A-Za-z])R\$/, "BRL"],
  [/(?:^|[^A-Za-z])S\/\.?/, "PEN"],
  [/(?:^|[^A-Za-z])Bs\.?\s?S?(?![A-Za-z])/, "VES"],
  [/€/, "EUR"],
  [/£/, "GBP"],
  [/¥/, "JPY"],
  [/₹/, "INR"],
];

/** Detecta la moneda por su código o símbolo en un texto de precio. `null` si no hay pistas o solo hay "$". */
export function currencyFromText(text: string): string | null {
  const code = CODE_RE.exec(text);
  if (code) return code[1];
  for (const [pattern, currency] of SYMBOLS) {
    if (pattern.test(text)) return currency;
  }
  return null;
}

/** priceCurrency de datos estructurados: debería ser ISO 4217, pero hay sitios que ponen "US$" o "€". */
export function normalizeCurrency(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 8) return null;
  const upper = trimmed.toUpperCase();
  if (CURRENCIES.has(upper)) return upper;
  return currencyFromText(trimmed);
}

/**
 * Convierte los dígitos de un precio a número, decidiendo cuál es el separador decimal:
 * - con punto y coma, el último que aparece es el decimal ("1.299,90" y "1,299.90");
 * - un separador repetido es de miles ("1.250.000");
 * - un solo separador seguido de 3 dígitos es de miles ("1.299"); seguido de 1 o 2 dígitos, es decimal ("248,5").
 */
export function parseAmount(raw: string, currency: string | null = null): number | null {
  const cleaned = raw.replace(/[\s  ']/g, "");
  const match = /\d[\d.,]*/.exec(cleaned);
  if (!match) return null;
  if (cleaned[match.index - 1] === "-") return null; // un precio negativo no es un precio
  let digits = match[0].replace(/[.,]+$/, "");
  const lastDot = digits.lastIndexOf(".");
  const lastComma = digits.lastIndexOf(",");
  let decimalSep: "." | "," | null = null;
  if (lastDot >= 0 && lastComma >= 0) {
    decimalSep = lastDot > lastComma ? "." : ",";
  } else {
    const sep = lastDot >= 0 ? "." : lastComma >= 0 ? "," : null;
    if (sep) {
      const count = digits.split(sep).length - 1;
      const after = digits.length - digits.lastIndexOf(sep) - 1;
      const noCents = currency !== null && ZERO_DECIMAL.has(currency);
      if (count === 1 && after !== 3 && !noCents) decimalSep = sep;
    }
  }
  if (decimalSep) {
    const thousands = decimalSep === "." ? "," : ".";
    digits = digits.split(thousands).join("");
    if (decimalSep === ",") digits = digits.replace(",", ".");
  } else {
    digits = digits.replace(/[.,]/g, "");
  }
  const value = Number(digits);
  if (!Number.isFinite(value) || value <= 0 || value > 10_000_000) return null;
  return Math.round(value * 100) / 100;
}

/** Precio de datos estructurados (schema.org pide punto decimal y sin separador de miles, pero no siempre se cumple). */
export function parseStructuredPrice(value: unknown, currency: string | null = null): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0 && value <= 10_000_000 ? Math.round(value * 100) / 100 : null;
  }
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (/^\d+(\.\d+)?$/.test(trimmed)) return parseStructuredPrice(Number(trimmed));
  return parseAmount(trimmed, currency);
}

/** "$1,299.90" → { amount: 1299.9, currency: "USD" } (con "$" solo, la moneda sale de `hint`). */
export function parseMoney(text: string, hint: string | null = null): { amount: number; currency: string | null } | null {
  if (!/\d/.test(text)) return null;
  const currency = currencyFromText(text) ?? hint;
  const amount = parseAmount(text, currency);
  return amount === null ? null : { amount, currency };
}

export const round2 = (n: number) => Math.round(n * 100) / 100;
