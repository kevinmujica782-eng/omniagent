// Montos de estados de cuenta de distintos bancos y países:
// "$1,234.56", "1.234,56", "(45.00)", "45.00-", "-$45", "1,200.00 CR", "MXN 1,000", "15.990" (pesos chilenos).

export interface AmountValue {
  /** Valor absoluto en centavos. */
  cents: number;
  negative: boolean;
  /** Marca explícita de crédito o débito junto al número ("1,200.00 CR"). */
  marker: "CR" | "DR" | null;
}

const CURRENCY =
  /US\$|MX\$|R\$|S\/\.?|[$€£¥₡₲₱₹]|\b(?:MXN|USD|EUR|COP|CLP|ARS|PEN|BRL|GBP|CAD|UYU|BOB|PYG|GTQ|CRC|DOP|HNL|NIO|PAB|VES|MN)\b|M\.N\./gi;
const MINUS = /^[-−–—]/;
const TRAILING_MINUS = /[-−–—]$/;
const SPACES = /[   ]/g;
/** numeric(14,2) en la base de datos. */
const MAX_INTEGER_DIGITS = 12;

export function parseAmount(raw: string | null | undefined): AmountValue | null {
  if (raw === null || raw === undefined) return null;
  let s = String(raw).replace(SPACES, " ").trim();
  if (!s) return null;

  let marker: AmountValue["marker"] = null;
  const suffix = /(?<=[\d\s).])(CR|DR)\.?$/i.exec(s);
  if (suffix) {
    marker = suffix[1].toUpperCase() as "CR" | "DR";
    s = s.slice(0, suffix.index).trim();
  } else {
    const prefix = /^(CR|DR)\.?(?=[\s\d$(+\-−])/i.exec(s);
    if (prefix) {
      marker = prefix[1].toUpperCase() as "CR" | "DR";
      s = s.slice(prefix[0].length).trim();
    }
  }

  s = s.replace(CURRENCY, "").trim();
  let negative = false;
  const unwrap = () => {
    if (/^\(.*\)$/.test(s)) {
      negative = true;
      s = s.slice(1, -1).trim();
    }
  };
  unwrap();
  if (MINUS.test(s)) {
    negative = true;
    s = s.slice(1).trim();
  } else if (s.startsWith("+")) {
    s = s.slice(1).trim();
  }
  if (TRAILING_MINUS.test(s)) {
    negative = true;
    s = s.slice(0, -1).trim();
  }
  unwrap();

  s = s.replace(/[\s'’]/g, "");
  if (!/^[\d.,]+$/.test(s) || !/\d/.test(s)) return null;
  const split = splitDecimal(s);
  if (!split) return null;
  const integer = split[0].replace(/^0+(?=\d)/, "");
  if (integer.length > MAX_INTEGER_DIGITS) return null;
  const cents = Number(integer || "0") * 100 + fractionCents(split[1]);
  return { cents, negative: negative && cents > 0, marker };
}

/** Separa parte entera y decimales, sea cual sea el separador decimal del banco. */
function splitDecimal(s: string): [string, string] | null {
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma >= 0 && lastDot >= 0) {
    // Con ambos, el último es el decimal: "1,234.56" y "1.234,56".
    const decimal = lastComma > lastDot ? "," : ".";
    const group = decimal === "," ? "." : ",";
    const at = s.lastIndexOf(decimal);
    const head = s.slice(0, at);
    if (head.includes(decimal)) return null;
    const digits = head.split(group).join("");
    return /^\d*$/.test(digits) ? [digits, s.slice(at + 1)] : null;
  }
  const sep = lastComma >= 0 ? "," : lastDot >= 0 ? "." : null;
  if (!sep) return [s, ""];
  const parts = s.split(sep);
  if (parts.length > 2) {
    // Varios separadores iguales son de miles: "1,234,567" o "1.234.567".
    return parts.slice(1).every((part) => part.length === 3) ? [parts.join(""), ""] : null;
  }
  const [head, tail] = parts;
  // Un solo separador seguido de exactamente 3 dígitos es de miles ("1,234", "15.990"): el dinero no lleva 3 decimales.
  if (tail.length === 3 && head.length > 0 && head !== "0") return [head + tail, ""];
  return [head, tail];
}

function fractionCents(fraction: string): number {
  if (!fraction) return 0;
  if (fraction.length <= 2) return Number(fraction.padEnd(2, "0"));
  return Math.round(Number(`${fraction.slice(0, 2)}.${fraction.slice(2)}`));
}

const CURRENCY_TOKEN = String.raw`(?:US\$|MX\$|R\$|[$€£]|MXN|USD|EUR|COP|CLP|ARS|PEN)`;
const MONEY_TOKEN = new RegExp(
  String.raw`^[-−–+]?\s*\(?\s*(?:${CURRENCY_TOKEN}\s*)?[-−–]?\s*(?:\d{1,3}(?:[,.']\d{3})*[.,]\d{2}|\d+[.,]\d{2})\s*\)?\s*(?:${CURRENCY_TOKEN})?\s*(?:[-−–]|CR|DR)?\.?$`,
  "i",
);
/** Pesos chilenos o colombianos sin centavos: "$15.990", "1.250.000". */
const GROUPED_INTEGER = /^[-−–]?\s*(?:\$\s*)?\d{1,3}(?:\.\d{3})+$/;
/** Montos chicos sin centavos, con el símbolo delante: "$790", "-$5". */
const SYMBOL_INTEGER = /^[-−–]?\s*\$\s*\d{1,3}$/;

/**
 * ¿Es un importe en un PDF? Pide centavos, separadores de miles o el símbolo de moneda, para no confundir
 * números de referencia ("123456"), sucursales o plazos ("12 MSI") con dinero.
 */
export function isMoneyToken(text: string): boolean {
  const s = text.replace(SPACES, " ").trim();
  if (!s || s.length > 32) return false;
  return MONEY_TOKEN.test(s) || GROUPED_INTEGER.test(s) || SYMBOL_INTEGER.test(s);
}

/** Centavos a texto decimal exacto para Prisma ("4550" → "45.50"). */
export function centsToDecimal(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(Math.trunc(cents));
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}
