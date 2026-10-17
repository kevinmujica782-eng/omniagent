// Reglas puras del cobro con Binance Pay a una cuenta personal (sin cuenta de comercio): la persona envía USDT al Pay
// ID de la cuenta y pega en Omni el ID de la orden que le muestra Binance; el servidor lo busca en el historial de
// Binance Pay de esa cuenta (GET /sapi/v1/pay/transactions) con una llave de API de solo lectura. Sin red ni base de
// datos: firmas, lectura del historial, el código que pega la persona, meses de Pro y permisos de la llave.
// API: https://developers.binance.com/docs/pay/rest-api/Get-Pay-Trade-History
import { createHmac } from "node:crypto";
import { z } from "zod";
import { PRO_MONTH_USDT } from "./binance-rules";

/** Lo único que el servidor le pide a Binance (el relevo de Supabase no deja pasar otra cosa). */
export const BINANCE_PATHS = {
  payHistory: "/sapi/v1/pay/transactions",
  restrictions: "/sapi/v1/account/apiRestrictions",
  time: "/api/v3/time",
} as const;
export type BinancePath = (typeof BINANCE_PATHS)[keyof typeof BINANCE_PATHS];

/** Dólares digitales que se aceptan 1 a 1 (el precio se muestra en USDT). */
export const TRANSFER_CURRENCIES = ["USDT", "USDC"] as const;
/** Envíos entre personas de Binance Pay (al Pay ID, al correo o al teléfono). */
export const TRANSFER_ORDER_TYPES = ["C2C"] as const;
/** Con un solo pago se pueden comprar hasta 12 meses (39.98 USDT = 2 meses). */
export const MAX_TRANSFER_MONTHS = 12;
/**
 * Un pago cuenta si llegó después de que la persona empezó a pagar en Omni, con 48 horas de margen por si pagó antes de
 * abrir la pantalla. Así un pago viejo que la cuenta recibió por otra cosa no sirve para activar Pro.
 */
export const TRANSFER_LOOKBACK_MS = 48 * 3_600_000;
/** La solicitud de pago (la fila PENDING) sirve 30 días; después se arma otra. */
export const TRANSFER_INTENT_TTL_MS = 30 * 24 * 3_600_000;
/** Binance responde hasta 90 días entre startTime y endTime. */
export const MAX_HISTORY_WINDOW_MS = 89 * 24 * 3_600_000;
/** Tamaño de página del historial (el máximo de la API). */
export const HISTORY_PAGE_SIZE = 100;
const RECV_WINDOW_MS = 10_000;

// ─── Firma ────────────────────────────────────────────────────────────────

/** Firma de los endpoints SIGNED de Binance: HMAC-SHA256 de la query con la llave secreta, en hexadecimal. */
export function signQuery(secret: string, query: string): string {
  return createHmac("sha256", secret).update(query).digest("hex");
}

/** La query firmada: los parámetros, recvWindow y timestamp, y la firma al final (como pide Binance). */
export function signedQuery(secret: string, params: Record<string, string | number>, nowMs: number): string {
  const entries: [string, string][] = Object.entries(params).map(([key, value]) => [key, String(value)]);
  entries.push(["recvWindow", String(RECV_WINDOW_MS)], ["timestamp", String(Math.round(nowMs))]);
  const query = new URLSearchParams(entries).toString();
  return `${query}&signature=${signQuery(secret, query)}`;
}

// ─── Historial de Binance Pay ─────────────────────────────────────────────

const idSchema = z.union([z.string(), z.number()]).transform((value) => String(value).trim());

const itemSchema = z.object({
  orderType: z.string(),
  transactionId: idSchema,
  transactionTime: z.coerce.number(),
  /** Positivo si entra, negativo si sale (hasta 8 decimales). */
  amount: z.union([z.string(), z.number()]).transform((value) => Number(value)),
  currency: z.string(),
  /** El «Order ID» que ve quien paga en su app, si Binance lo incluye. */
  orderId: idSchema.nullish(),
  payerInfo: z.object({ name: z.string().nullish() }).passthrough().nullish(),
  note: z.string().nullish(),
});

export interface PayTransfer {
  transactionId: string;
  orderId: string | null;
  time: number;
  amount: number;
  currency: string;
  orderType: string;
  payerName: string | null;
  note: string | null;
}

/** Los movimientos de una página del historial; los que no tienen la forma esperada se cuentan aparte. */
export function parsePayHistory(body: unknown): { items: PayTransfer[]; raw: number; malformed: number } {
  const data = (body as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) throw new Error("Respuesta del historial de Binance Pay sin data");
  const items: PayTransfer[] = [];
  let malformed = 0;
  for (const entry of data) {
    const parsed = itemSchema.safeParse(entry);
    if (!parsed.success || !parsed.data.transactionId || !Number.isFinite(parsed.data.amount) || !Number.isFinite(parsed.data.transactionTime)) {
      malformed++;
      continue;
    }
    const item = parsed.data;
    items.push({
      transactionId: item.transactionId,
      orderId: item.orderId ? item.orderId : null,
      time: item.transactionTime,
      amount: item.amount,
      currency: item.currency.trim().toUpperCase(),
      orderType: item.orderType.trim().toUpperCase(),
      payerName: item.payerInfo?.name?.trim().slice(0, 80) || null,
      note: item.note?.trim().slice(0, 120) || null,
    });
  }
  return { items, raw: data.length, malformed };
}

// ─── El ID de la orden que pega la persona ────────────────────────────────

/**
 * El ID sin espacios y en mayúsculas (letras, números, guion bajo y guion, de 6 a 64). Si la persona pegó también la
 * etiqueta («ID de la orden: 2845…»), se queda con la parte más larga que parece un ID. null si no hay ninguna.
 */
export function normalizePaymentCode(raw: string): string | null {
  const compact = raw.replace(/\s+/g, "").toUpperCase();
  if (/^[A-Z0-9_-]{6,64}$/.test(compact)) return compact;
  // Números copiados en grupos («2845 6789 1234») se juntan antes de buscar el ID dentro del texto.
  const tokens = raw
    .replace(/(\d)\s+(?=\d)/g, "$1")
    .toUpperCase()
    .split(/[^A-Z0-9_-]+/)
    .filter((token) => token.length >= 6 && token.length <= 64);
  if (tokens.length === 0) return null;
  return tokens.reduce((best, token) => (token.length > best.length ? token : best));
}

const digitsOf = (value: string) => value.replace(/\D/g, "");

/**
 * ¿Es este el pago del código? Vale el transactionId del historial o el orderId (el «ID de la orden» de la app). Si la
 * persona pegó solo números (12 o más), también vale que sean los números del ID de Binance (P_123… → 123…).
 */
export function matchesPaymentCode(transfer: Pick<PayTransfer, "transactionId" | "orderId">, code: string): boolean {
  const candidates = [transfer.transactionId, transfer.orderId]
    .filter((value): value is string => Boolean(value))
    .map((value) => value.replace(/\s+/g, "").toUpperCase());
  if (candidates.includes(code)) return true;
  if (/^\d{12,}$/.test(code)) return candidates.some((candidate) => digitsOf(candidate) === code);
  return false;
}

// ─── Meses de Pro ──────────────────────────────────────────────────────────

/** Cuántos meses paga un monto: 19.99 → 1, 20 → 1, 39.98 → 2; menos de 19.99 → 0. Hasta 12. */
export function monthsForAmount(amount: number): number {
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  return Math.min(MAX_TRANSFER_MONTHS, Math.floor((amount + 0.005) / PRO_MONTH_USDT));
}

export type TransferProblem = "outgoing" | "not_transfer" | "currency" | "too_old" | "underpaid";
export type TransferVerdict = { ok: true; months: number } | { ok: false; problem: TransferProblem };

/** ¿Este pago activa Pro? Tiene que ser un envío recibido, en USDT o USDC, reciente y de al menos 19.99. */
export function judgeTransfer(transfer: PayTransfer, opts: { notBefore: number }): TransferVerdict {
  if (!(transfer.amount > 0)) return { ok: false, problem: "outgoing" };
  if (!(TRANSFER_ORDER_TYPES as readonly string[]).includes(transfer.orderType)) return { ok: false, problem: "not_transfer" };
  if (!(TRANSFER_CURRENCIES as readonly string[]).includes(transfer.currency)) return { ok: false, problem: "currency" };
  if (transfer.time < opts.notBefore) return { ok: false, problem: "too_old" };
  const months = monthsForAmount(transfer.amount);
  return months > 0 ? { ok: true, months } : { ok: false, problem: "underpaid" };
}

/** Lo que se le dice a la persona cuando el pago no sirve (en su idioma y con qué hacer). */
export function transferProblemMessage(problem: TransferProblem, transfer: Pick<PayTransfer, "amount" | "currency">): string {
  const paid = `${formatAmount(transfer.amount)} ${transfer.currency}`;
  switch (problem) {
    case "outgoing":
      return "Ese ID es de un pago que salió de la cuenta, no de uno recibido. Revisa que sea el ID de tu envío.";
    case "not_transfer":
      return "Ese ID no es de un envío con Binance Pay. Envía el pago desde Pay → Enviar y pega el ID de esa orden.";
    case "currency":
      return `Ese pago llegó en ${transfer.currency}. Pro se paga en USDT o USDC: escríbenos y lo resolvemos.`;
    case "too_old":
      return "Ese pago es anterior a tu solicitud de Pro, así que no se puede usar aquí. Si es tuyo, escríbenos.";
    case "underpaid":
      return `Recibimos ${paid}, y un mes de Pro cuesta ${formatAmount(PRO_MONTH_USDT)} USDT. Escríbenos para completar el pago.`;
  }
}

/** 19.99 → "19.99", 20 → "20", 15.5 → "15.50". */
export function formatAmount(amount: number): string {
  const fixed = amount.toFixed(2);
  return fixed.endsWith(".00") ? fixed.slice(0, -3) : fixed;
}

// ─── Permisos de la llave ──────────────────────────────────────────────────

/** Permisos que no mueven dinero: leer (y leer por FIX). Cualquier otro encendido es un problema. */
const SAFE_PERMISSIONS = new Set(["enableReading", "enableFixReadOnly"]);

/**
 * Qué está mal en la llave según GET /sapi/v1/account/apiRestrictions: tiene que poder leer y nada más (sin retiros,
 * transferencias ni trading). Lista vacía = llave segura.
 */
export function keyPermissionProblems(body: unknown): string[] {
  if (!body || typeof body !== "object") return ["respuesta de permisos inválida"];
  const record = body as Record<string, unknown>;
  const problems: string[] = [];
  if (record.enableReading !== true) problems.push("enableReading apagado");
  for (const [key, value] of Object.entries(record)) {
    if (value === true && /^(enable|permits)/.test(key) && !SAFE_PERMISSIONS.has(key)) problems.push(`${key} encendido`);
  }
  return problems;
}

// ─── Respuestas del relevo y de Binance ────────────────────────────────────

const envelopeSchema = z.object({ status: z.number().int(), body: z.string() });

/** El relevo responde 200 con { status, body }: el estado y el cuerpo tal como los devolvió Binance. */
export function readRelayEnvelope(value: unknown): { status: number; body: string } | null {
  const parsed = envelopeSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** El código de error de Binance ({"code":-1021,"msg":"..."}), o null. */
export function binanceErrorCode(body: unknown): number | null {
  const code = (body as { code?: unknown } | null)?.code;
  const numeric = typeof code === "number" ? code : typeof code === "string" ? Number(code) : Number.NaN;
  return Number.isFinite(numeric) ? numeric : null;
}

/** Binance responde 451 desde lugares donde no opera (por ejemplo, servidores en EE. UU.): hay que probar otra región. */
export function isGeoBlocked(status: number): boolean {
  return status === 451 || status === 403;
}
