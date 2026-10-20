import "server-only";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { AppError, Errors } from "@/lib/errors";
import { log } from "@/lib/log";
import { announceBinancePayment, grantBinanceMonths, paidUntil } from "./binance";
import { PRO_MONTH_USDT, newMerchantTradeNo } from "./binance-rules";
import {
  BINANCE_PATHS,
  HISTORY_PAGE_SIZE,
  MAX_HISTORY_WINDOW_MS,
  TRANSFER_CURRENCIES,
  TRANSFER_INTENT_TTL_MS,
  TRANSFER_LOOKBACK_MS,
  binanceErrorCode,
  isGeoBlocked,
  judgeTransfer,
  keyPermissionProblems,
  matchesPaymentCode,
  normalizePaymentCode,
  parsePayHistory,
  readRelayEnvelope,
  signedQuery,
  transferProblemMessage,
  type BinancePath,
  type PayTransfer,
} from "./binance-transfer-rules";
import { getEntitlements } from "./entitlements";

// Omni Pro con Binance Pay a una cuenta personal (sin cuenta de comercio de Binance):
// 1. La persona abre el pago: se guarda cuándo empezó (fila TRANSFER PENDING en binance_orders) y ve el Pay ID.
// 2. Envía 19.99 USDT (o USDC) a ese Pay ID desde su app de Binance.
// 3. Pega el ID de la orden. El servidor busca el pago en el historial de Binance Pay de la cuenta que cobra
//    (llave de API de solo lectura) y, si es un envío recibido, reciente y de al menos 19.99, suma los meses de Pro.
//    El ID del pago en Binance queda guardado como único: el mismo pago no activa Pro dos veces.
// Binance bloquea las consultas desde EE. UU. (donde corre Netlify): pasan por la función binance-relay de Supabase,
// que se invoca en París o São Paulo. La llave secreta nunca sale de este servidor: el relevo solo ve la firma.

const LOOKUP_MARGIN_MS = 7 * 24 * 3_600_000;
const MAX_HISTORY_PAGES = 5;
const KEY_CHECK_TTL_MS = 3_600_000;
const KEY_REJECTED_CODES = new Set([-2008, -2014, -2015, -1022]);
const CLOCK_ERROR = -1021;

export function transferConfigured(): boolean {
  const config = env();
  return Boolean(config.BINANCE_PAY_ID && config.BINANCE_READ_API_KEY && config.BINANCE_READ_API_SECRET && config.BINANCE_RELAY_TOKEN && relayUrl());
}

/** La función binance-relay del mismo proyecto de Supabase, salvo que BINANCE_RELAY_URL diga otra. */
function relayUrl(): string | null {
  const config = env();
  if (config.BINANCE_RELAY_URL) return config.BINANCE_RELAY_URL;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  return supabaseUrl ? `${supabaseUrl.replace(/\/+$/, "")}/functions/v1/binance-relay` : null;
}

function relayRegions(): string[] {
  const regions = env()
    .BINANCE_RELAY_REGIONS.split(",")
    .map((region) => region.trim())
    .filter((region) => /^[a-z]{2}-[a-z]+-\d$/.test(region));
  return regions.length > 0 ? regions : ["eu-west-3", "sa-east-1"];
}

const UNAVAILABLE = "No pudimos consultar Binance en este momento. Prueba otra vez en un minuto.";

// ─── Consultas a Binance por el relevo ───────────────────────────────────────

/** Una consulta a Binance por el relevo: prueba las regiones en orden hasta que una llegue (sin 451). */
async function relay(path: BinancePath, query: string, withKey: boolean): Promise<{ status: number; body: string }> {
  const config = env();
  const url = relayUrl();
  if (!url || !config.BINANCE_RELAY_TOKEN) throw Errors.notConfigured("El pago con Binance Pay");
  const payload = JSON.stringify({ path, query, ...(withKey ? { apiKey: config.BINANCE_READ_API_KEY } : {}) });
  for (const region of relayRegions()) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${config.BINANCE_RELAY_TOKEN}`, "Content-Type": "application/json", "x-region": region },
        body: payload,
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) {
        log.warn("binance.relay_failed", { region, httpStatus: response.status });
        continue;
      }
      const envelope = readRelayEnvelope(await response.json().catch(() => null));
      if (!envelope) {
        log.warn("binance.relay_bad_response", { region });
        continue;
      }
      if (isGeoBlocked(envelope.status)) {
        log.warn("binance.geo_blocked", { region, status: envelope.status });
        continue;
      }
      return envelope;
    } catch (error) {
      log.warn("binance.relay_unreachable", { region, error });
    }
  }
  throw new AppError(502, "binance_unreachable", UNAVAILABLE);
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Diferencia entre el reloj de Binance y el nuestro (se ajusta si Binance responde -1021). */
let clockOffsetMs = 0;

async function syncClock(): Promise<void> {
  const { status, body } = await relay(BINANCE_PATHS.time, "", false);
  const serverTime = Number((parseJson(body) as { serverTime?: unknown } | null)?.serverTime);
  if (status === 200 && Number.isFinite(serverTime)) clockOffsetMs = serverTime - Date.now();
}

/**
 * Lo último que falló con la llave, para la salud con CRON_SECRET: el estado HTTP, el código y el mensaje de Binance,
 * o los permisos de más. Nunca lleva la llave, la firma ni datos del historial.
 */
let lastKeyProblem: string | null = null;

function describeBinanceError(status: number, code: number | null, json: unknown): string {
  const msg = (json as { msg?: unknown } | null)?.msg;
  const parts = [`HTTP ${status}`];
  if (code !== null) parts.push(`código ${code}`);
  if (typeof msg === "string" && msg) parts.push(msg.slice(0, 160));
  return parts.join(", ");
}

/** GET firmado (USER_DATA) con la llave de solo lectura. Los errores salen como un mensaje para la persona. */
async function signedGet(path: BinancePath, params: Record<string, string | number>): Promise<unknown> {
  const config = env();
  const secret = config.BINANCE_READ_API_SECRET;
  if (!secret || !config.BINANCE_READ_API_KEY) throw Errors.notConfigured("El pago con Binance Pay");
  for (let attempt = 0; attempt < 2; attempt++) {
    const { status, body } = await relay(path, signedQuery(secret, params, Date.now() + clockOffsetMs), true);
    const json = parseJson(body);
    if (status === 200) return json;
    const code = binanceErrorCode(json);
    if (code === CLOCK_ERROR && attempt === 0) {
      await syncClock();
      continue;
    }
    if (status === 401 || (code !== null && KEY_REJECTED_CODES.has(code))) {
      lastKeyProblem = `Binance rechazó la llave (${describeBinanceError(status, code, json)})`;
      log.error("binance.transfer.key_rejected", { path, status, code });
      throw new AppError(503, "binance_unavailable", "El pago con Binance Pay no está disponible ahora. Escríbenos y lo revisamos.");
    }
    if (status === 418 || status === 429) {
      lastKeyProblem = `Binance limitó las consultas (HTTP ${status})`;
      log.warn("binance.transfer.rate_limited", { path, status });
      throw new AppError(503, "binance_busy", "Binance está recibiendo demasiadas consultas. Prueba otra vez en un minuto.");
    }
    lastKeyProblem = `Binance respondió con error (${describeBinanceError(status, code, json)})`;
    log.error("binance.transfer.request_failed", { path, status, code });
    throw new AppError(502, "binance_error", UNAVAILABLE);
  }
  throw new AppError(502, "binance_error", UNAVAILABLE);
}

let keyCheckedAt = 0;

/**
 * Antes de usar la llave, comprueba que sea de solo lectura (sin retiros, transferencias ni trading). Si alguien la
 * cambia en Binance, el cobro se detiene en vez de seguir con una llave que puede mover dinero.
 */
async function ensureReadOnlyKey(nowMs: number): Promise<void> {
  if (nowMs - keyCheckedAt < KEY_CHECK_TTL_MS) return;
  const problems = keyPermissionProblems(await signedGet(BINANCE_PATHS.restrictions, {}));
  if (problems.length > 0) {
    keyCheckedAt = 0;
    lastKeyProblem = `La llave no es solo de lectura: ${problems.join(", ")}`;
    log.error("binance.transfer.key_not_read_only", { problems });
    throw new AppError(503, "binance_unavailable", "El pago con Binance Pay está en pausa mientras revisamos la configuración. Escríbenos y lo resolvemos.");
  }
  keyCheckedAt = nowMs;
}

/** Los movimientos recibidos entre dos momentos (ms), del historial de Binance Pay de la cuenta que cobra. */
export type IncomingTransfers = (sinceMs: number, untilMs: number) => Promise<PayTransfer[]>;

export const fetchIncomingTransfers: IncomingTransfers = async (sinceMs, untilMs) => {
  await ensureReadOnlyKey(Date.now());
  const since = Math.max(sinceMs, untilMs - MAX_HISTORY_WINDOW_MS);
  const found = new Map<string, PayTransfer>();
  let end = untilMs;
  for (let page = 0; page < MAX_HISTORY_PAGES; page++) {
    const body = await signedGet(BINANCE_PATHS.payHistory, { startTime: since, endTime: end, limit: HISTORY_PAGE_SIZE });
    let parsed: ReturnType<typeof parsePayHistory>;
    try {
      parsed = parsePayHistory(body);
    } catch (error) {
      log.error("binance.transfer.bad_history", { error });
      throw new AppError(502, "binance_error", UNAVAILABLE);
    }
    if (parsed.malformed > 0) log.warn("binance.transfer.malformed_items", { count: parsed.malformed });
    for (const item of parsed.items) found.set(item.transactionId, item);
    if (parsed.raw < HISTORY_PAGE_SIZE || parsed.items.length === 0) break;
    // Página llena: la siguiente termina en el movimiento más viejo de esta (los repetidos se juntan por ID).
    const oldest = Math.min(...parsed.items.map((item) => item.time));
    if (oldest <= since || oldest >= end) break;
    end = oldest;
  }
  return [...found.values()].filter((item) => item.amount > 0);
};

// ─── Empezar a pagar y reclamar el pago ─────────────────────────────────────

export interface TransferStart {
  /** El Pay ID al que se envía el pago. */
  payId: string;
  /** El nombre que verá la persona al enviar (si se configuró). */
  payName: string | null;
  /** Precio de un mes. */
  amount: number;
  currency: "USDT";
  currencies: string[];
  startedAt: string;
}

/** La solicitud de pago abierta de la persona (la de hace menos de 30 días), o una nueva. */
async function openIntent(userId: string, now: Date) {
  const existing = await prisma.binanceOrder.findFirst({
    where: { userId, kind: "TRANSFER", status: "PENDING", createdAt: { gt: new Date(now.getTime() - TRANSFER_INTENT_TTL_MS) } },
    orderBy: { createdAt: "asc" },
  });
  if (existing) return existing;
  return prisma.binanceOrder.create({
    data: { merchantTradeNo: newMerchantTradeNo(now), userId, kind: "TRANSFER", months: 1, amount: PRO_MONTH_USDT, currency: "USDT", createdAt: now },
  });
}

/**
 * Que la llave responda y sea de solo lectura antes de mostrar el Pay ID: si falla, la persona ve que el pago no está
 * disponible en vez de pagar algo que después no se podría confirmar. Usa la misma revisión en caché (una por hora).
 */
export async function assertTransferKeyWorks(): Promise<void> {
  if (!transferConfigured()) throw Errors.notConfigured("El pago con Binance Pay");
  await ensureReadOnlyKey(Date.now());
}

/** Abre (o reusa) la solicitud de pago y devuelve a dónde pagar. */
export async function startTransfer(userId: string, now = new Date()): Promise<TransferStart> {
  if (!transferConfigured()) throw Errors.notConfigured("El pago con Binance Pay");
  const intent = await openIntent(userId, now);
  const config = env();
  return {
    payId: config.BINANCE_PAY_ID!,
    payName: config.BINANCE_PAY_NAME ?? null,
    amount: PRO_MONTH_USDT,
    currency: "USDT",
    currencies: [...TRANSFER_CURRENCIES],
    startedAt: intent.createdAt.toISOString(),
  };
}

export interface TransferClaim {
  paid: true;
  months: number;
  amount: number;
  currency: string;
  paidUntil: string | null;
  /** El pago ya se había usado para esta misma persona (por ejemplo, un doble toque). */
  alreadyClaimed: boolean;
}

const isUniqueViolation = (error: unknown) => (error as { code?: unknown } | null)?.code === "P2002";

const alreadyUsed = () => new AppError(409, "payment_already_used", "Ese pago ya activó Pro en otra cuenta de Omni. Si es tuyo, escríbenos y lo revisamos.");

/**
 * Busca el pago del ID de la orden en el historial de Binance Pay y, si sirve, suma sus meses de Pro una sola vez.
 * `incoming` reemplaza la consulta a Binance en las pruebas.
 */
export async function claimTransfer(
  userId: string,
  rawCode: string,
  opts: { now?: Date; incoming?: IncomingTransfers } = {},
): Promise<TransferClaim> {
  if (!opts.incoming && !transferConfigured()) throw Errors.notConfigured("El pago con Binance Pay");
  const now = opts.now ?? new Date();
  const code = normalizePaymentCode(rawCode);
  if (!code) throw Errors.badRequest("Pega el ID de la orden tal como aparece en Binance: solo letras y números.");

  // Doble toque o recarga: el mismo código ya activó Pro para esta persona.
  const repeated = await prisma.binanceOrder.findFirst({ where: { userId, kind: "TRANSFER", status: "PAID", claimCode: code } });
  if (repeated) return claimedResult(repeated, userId, true);

  const intent = await openIntent(userId, now);
  const notBefore = intent.createdAt.getTime() - TRANSFER_LOOKBACK_MS;
  const transfers = await (opts.incoming ?? fetchIncomingTransfers)(notBefore - LOOKUP_MARGIN_MS, now.getTime());
  const transfer = transfers.find((item) => matchesPaymentCode(item, code));
  if (!transfer) {
    throw new AppError(
      404,
      "payment_not_found",
      "Todavía no encontramos ese pago. Revisa el ID de la orden; si acabas de pagar, espera unos segundos y vuelve a intentarlo.",
    );
  }
  const verdict = judgeTransfer(transfer, { notBefore });
  if (!verdict.ok) {
    log.warn("binance.transfer.rejected", { userId, problem: verdict.problem, orderType: transfer.orderType, currency: transfer.currency });
    throw new AppError(409, `payment_${verdict.problem}`, transferProblemMessage(verdict.problem, transfer));
  }

  const before = (await getEntitlements(userId, now)).plan;
  const paidAt = new Date(transfer.time);
  let granted: Date | "mine";
  try {
    granted = await prisma.$transaction(async (tx) => {
      const used = await tx.binanceOrder.findUnique({ where: { transactionId: transfer.transactionId } });
      if (used) {
        if (used.userId === userId) return "mine" as const;
        throw alreadyUsed();
      }
      const data = {
        status: "PAID",
        paidAt,
        transactionId: transfer.transactionId,
        claimCode: code,
        payerName: transfer.payerName,
        amount: transfer.amount,
        currency: transfer.currency,
        months: verdict.months,
      };
      const claimed = await tx.binanceOrder.updateMany({ where: { merchantTradeNo: intent.merchantTradeNo, status: "PENDING" }, data });
      // La solicitud ya se usó en otro pago al mismo tiempo: este queda en una fila propia.
      if (claimed.count === 0) await tx.binanceOrder.create({ data: { ...data, merchantTradeNo: newMerchantTradeNo(now), userId, kind: "TRANSFER", createdAt: now } });
      return grantBinanceMonths(tx, userId, verdict.months, now);
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    // Dos reclamos del mismo pago a la vez: el otro ganó.
    const winner = await prisma.binanceOrder.findUnique({ where: { transactionId: transfer.transactionId } });
    if (winner?.userId !== userId) throw alreadyUsed();
    granted = "mine";
  }

  if (granted === "mine") {
    const mine = await prisma.binanceOrder.findUnique({ where: { transactionId: transfer.transactionId } });
    if (mine) return claimedResult(mine, userId, true);
    throw alreadyUsed();
  }

  await audit({
    userId,
    actor: "user",
    action: "billing.binance.transfer_paid",
    entity: "binance_order",
    entityId: transfer.transactionId,
    metadata: { amount: transfer.amount, currency: transfer.currency, months: verdict.months, paidUntil: granted.toISOString() },
  });
  await announceBinancePayment({ userId, amount: transfer.amount, currency: transfer.currency, paidUntil: granted, before, now });
  return {
    paid: true,
    months: verdict.months,
    amount: transfer.amount,
    currency: transfer.currency,
    paidUntil: granted.toISOString(),
    alreadyClaimed: false,
  };
}

async function claimedResult(
  order: { months: number; amount: unknown; currency: string },
  userId: string,
  alreadyClaimed: boolean,
): Promise<TransferClaim> {
  return {
    paid: true,
    months: order.months,
    amount: Number(order.amount),
    currency: order.currency,
    paidUntil: await paidUntil(userId),
    alreadyClaimed,
  };
}

/**
 * Para la salud del sistema (con CRON_SECRET): ¿llega el relevo a Binance y la llave es de solo lectura? Si la llave
 * falla, `detail` dice por qué (estado y código de Binance, o los permisos de más).
 */
export async function transferHealth(): Promise<{
  relay: "ok" | "error";
  key: "ok" | "error" | "not_configured";
  detail?: string;
}> {
  if (!relayUrl() || !env().BINANCE_RELAY_TOKEN) return { relay: "error", key: "not_configured" };
  let relayOk: "ok" | "error" = "error";
  try {
    relayOk = (await relay(BINANCE_PATHS.time, "", false)).status === 200 ? "ok" : "error";
  } catch {
    relayOk = "error";
  }
  if (!transferConfigured()) return { relay: relayOk, key: "not_configured" };
  try {
    keyCheckedAt = 0;
    lastKeyProblem = null;
    await ensureReadOnlyKey(Date.now());
    return { relay: relayOk, key: "ok" };
  } catch (error) {
    const detail = lastKeyProblem ?? (error instanceof AppError ? error.code : "error inesperado");
    return { relay: relayOk, key: "error", detail };
  }
}
