// Reglas puras de Binance Pay (sin red ni base de datos): firmas, órdenes, webhooks y periodos de Pro.
// API: https://developers.binance.com/docs/binance-pay (crear orden v3, consultar orden v2, webhooks).
import { createHmac, createVerify, randomInt } from "node:crypto";
import { z } from "zod";
import { PLANS } from "./plans";

export const BINANCE_API = "https://bpay.binanceapi.com";
export const BINANCE_CURRENCY = "USDT";

/** Un mes de Pro en USDT: el mismo número que el plan en dólares ("$19.99" → 19.99). */
export const PRO_MONTH_USDT = Number(PLANS.PRO.price.replace(/[^\d.]/g, ""));

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const LETTERS_AND_DIGITS = `${LETTERS}0123456789`;

function randomFrom(chars: string, length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) out += chars[randomInt(chars.length)];
  return out;
}

/** BinancePay-Nonce: 32 letras al azar. */
export function binanceNonce(): string {
  return randomFrom(LETTERS, 32);
}

/** merchantTradeNo: solo letras y números, máximo 32 caracteres, único por orden. */
export function newMerchantTradeNo(now = new Date()): string {
  return `OMNI${now.getTime()}${randomFrom(LETTERS_AND_DIGITS, 8)}`;
}

export function isMerchantTradeNo(value: string): boolean {
  return /^[A-Za-z0-9]{1,32}$/.test(value);
}

/** Lo que se firma, igual en las solicitudes y en los webhooks: timestamp, nonce y cuerpo, cada uno con salto de línea. */
export function signaturePayload(timestamp: string, nonce: string, body: string): string {
  return `${timestamp}\n${nonce}\n${body}\n`;
}

/** Firma de las solicitudes a Binance Pay: HMAC-SHA512 con la llave secreta, en hexadecimal mayúsculas. */
export function signRequest(secretKey: string, timestamp: string, nonce: string, body: string): string {
  return createHmac("sha512", secretKey).update(signaturePayload(timestamp, nonce, body)).digest("hex").toUpperCase();
}

/** Binance entrega la llave pública del certificado en PEM o solo en base64: la deja en PEM. */
export function toPem(publicKey: string): string {
  const trimmed = publicKey.trim();
  if (trimmed.startsWith("-----BEGIN")) return trimmed;
  const lines = trimmed.replace(/\s+/g, "").match(/.{1,64}/g) ?? [];
  return `-----BEGIN PUBLIC KEY-----\n${lines.join("\n")}\n-----END PUBLIC KEY-----`;
}

/** Firma de un webhook: SHA256 con RSA sobre el mismo payload, en base64, con la llave pública del certificado. */
export function verifyWebhookSignature(publicKey: string, timestamp: string, nonce: string, body: string, signature: string): boolean {
  try {
    const verifier = createVerify("RSA-SHA256");
    verifier.update(signaturePayload(timestamp, nonce, body));
    return verifier.verify(toPem(publicKey), Buffer.from(signature, "base64"));
  } catch {
    return false;
  }
}

/** Suma meses de calendario en UTC; si el día no existe en el mes de llegada (31 de enero → febrero), queda el último. */
export function addMonths(date: Date, months: number): Date {
  const day = date.getUTCDate();
  const result = new Date(date.getTime());
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate();
  result.setUTCDate(Math.min(day, lastDay));
  return result;
}

/** Hasta cuándo queda pagado Pro: se suma desde el fin vigente (renovar antes no pierde días) o desde ahora. */
export function nextPeriodEnd(currentEnd: Date | null, now: Date, months: number): Date {
  const base = currentEnd && currentEnd.getTime() > now.getTime() ? currentEnd : now;
  return addMonths(base, months);
}

const webhookSchema = z.object({
  bizType: z.string(),
  bizStatus: z.string(),
  // La documentación dice que llega como texto JSON; si llegara como objeto, también sirve.
  data: z.union([z.string(), z.record(z.string(), z.unknown())]),
});

/** El merchantTradeNo de un webhook de pago exitoso, o null si es otro aviso (cierre, reembolso...). */
export function paidOrderFromWebhook(body: unknown): string | null {
  const parsed = webhookSchema.safeParse(body);
  if (!parsed.success || parsed.data.bizType !== "PAY" || parsed.data.bizStatus !== "PAY_SUCCESS") return null;
  let data: unknown = parsed.data.data;
  if (typeof data === "string") {
    try {
      data = JSON.parse(data);
    } catch {
      return null;
    }
  }
  const tradeNo = (data as { merchantTradeNo?: unknown } | null)?.merchantTradeNo;
  return typeof tradeNo === "string" && isMerchantTradeNo(tradeNo) ? tradeNo : null;
}

/** ¿Lo que cobró Binance coincide con la orden? Mismo monto (al centavo) y en USDT. */
export function amountMatches(expected: number, paid: string | number, currency: string): boolean {
  return currency === BINANCE_CURRENCY && Math.abs(Number(paid) - expected) < 0.005;
}
