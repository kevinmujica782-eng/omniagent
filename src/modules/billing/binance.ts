import "server-only";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { env, requireEnv } from "@/lib/env";
import { AppError, Errors } from "@/lib/errors";
import { shortDate } from "@/lib/format";
import { log } from "@/lib/log";
import {
  BINANCE_API,
  BINANCE_CURRENCY,
  PRO_MONTH_USDT,
  amountMatches,
  binanceNonce,
  newMerchantTradeNo,
  nextPeriodEnd,
  signRequest,
} from "./binance-rules";
import { getEntitlements } from "./entitlements";
import { applyPlanChange } from "./plan-change";

// Omni Pro con Binance Pay: la persona paga 19.99 USDT desde su cuenta de Binance y recibe un mes de Pro.
// No hay renovación automática: cada pago suma un mes a la suscripción BINANCE (desde el fin vigente) y unos días
// antes de vencer llega un aviso para renovar. Pro se activa al confirmar la orden en Binance (por el webhook o al
// volver del pago), nunca solo con lo que diga el navegador.

const DAY_MS = 86_400_000;
const REMINDER_DAYS = 3;
const PRODUCT_ID = "omni_pro_1m";

export function binanceConfigured(): boolean {
  const config = env();
  return Boolean(config.BINANCE_PAY_API_KEY && config.BINANCE_PAY_SECRET_KEY);
}

type BinanceResponse<T> = { status?: string; code?: string; data?: T; errorMessage?: string };

/** Solicitud firmada a la API de Binance Pay. Los errores llegan como un mensaje que se le puede mostrar a la persona. */
async function binancePost<T>(path: string, payload: unknown): Promise<T> {
  const apiKey = requireEnv("BINANCE_PAY_API_KEY", "El pago con Binance Pay");
  const secretKey = requireEnv("BINANCE_PAY_SECRET_KEY", "El pago con Binance Pay");
  const body = JSON.stringify(payload);
  const timestamp = String(Date.now());
  const nonce = binanceNonce();
  let response: Response;
  try {
    response = await fetch(`${BINANCE_API}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "BinancePay-Timestamp": timestamp,
        "BinancePay-Nonce": nonce,
        "BinancePay-Certificate-SN": apiKey,
        "BinancePay-Signature": signRequest(secretKey, timestamp, nonce, body),
      },
      body,
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    log.error("binance.unreachable", { path, error });
    throw new AppError(502, "payment_provider_error", "Binance Pay no responde. Inténtalo de nuevo en unos minutos.");
  }
  const json = (await response.json().catch(() => null)) as BinanceResponse<T> | null;
  if (!response.ok || !json || json.status !== "SUCCESS" || json.data === undefined) {
    log.error("binance.request_failed", { path, status: response.status, code: json?.code ?? null, message: json?.errorMessage ?? null });
    throw new AppError(502, "payment_provider_error", "Binance Pay no pudo procesar el pago. Inténtalo de nuevo en unos minutos.");
  }
  return json.data;
}

// Llaves públicas de los certificados de Binance (por número de serie) para verificar los webhooks.
const certificates = new Map<string, string>();

export async function binanceCertificate(serial: string): Promise<string | null> {
  if (!certificates.has(serial)) {
    const list = await binancePost<{ certSerial: string; certPublic: string }[]>("/binancepay/openapi/certificates", {});
    for (const cert of list) certificates.set(cert.certSerial, cert.certPublic);
  }
  return certificates.get(serial) ?? null;
}

export interface BinanceCheckout {
  orderId: string;
  checkoutUrl: string;
  /** Abre la app de Binance en el teléfono (si no está instalada, la página de pago). */
  universalUrl: string | null;
  amount: number;
  currency: string;
}

/** Crea la orden de un mes de Pro y devuelve la página de pago de Binance. */
export async function createProOrder(userId: string, now = new Date()): Promise<BinanceCheckout> {
  if (!binanceConfigured()) throw Errors.notConfigured("El pago con Binance Pay");
  const months = 1;
  const amount = Math.round(PRO_MONTH_USDT * months * 100) / 100;
  const merchantTradeNo = newMerchantTradeNo(now);
  const appUrl = env().NEXT_PUBLIC_APP_URL.replace(/\/+$/, "");

  await prisma.binanceOrder.create({ data: { merchantTradeNo, userId, months, amount, currency: BINANCE_CURRENCY } });
  type CreatedOrder = { prepayId: string; checkoutUrl: string; universalUrl?: string };
  let data: CreatedOrder;
  try {
    data = await binancePost<CreatedOrder>("/binancepay/openapi/v3/order", {
      env: { terminalType: "WEB" },
      merchantTradeNo,
      orderAmount: amount,
      currency: BINANCE_CURRENCY,
      description: "Omni Pro: 1 mes de OmniAgent",
      goodsDetails: [{ goodsType: "02", goodsCategory: "Z000", referenceGoodsId: PRODUCT_ID, goodsName: "Omni Pro (1 mes)" }],
      // Binance admite un solo parámetro en cada URL de vuelta.
      returnUrl: `${appUrl}/cuenta?binance=${merchantTradeNo}`,
      cancelUrl: `${appUrl}/cuenta?binance=cancelado`,
      webhookUrl: `${appUrl}/api/webhooks/binance`,
    });
  } catch (error) {
    await prisma.binanceOrder.update({ where: { merchantTradeNo }, data: { status: "ERROR" } }).catch(() => undefined);
    throw error;
  }

  await prisma.binanceOrder.update({ where: { merchantTradeNo }, data: { prepayId: data.prepayId } });
  await audit({
    userId,
    actor: "user",
    action: "billing.binance.order_created",
    entity: "binance_order",
    entityId: merchantTradeNo,
    metadata: { amount, months, currency: BINANCE_CURRENCY },
  });
  return { orderId: merchantTradeNo, checkoutUrl: data.checkoutUrl, universalUrl: data.universalUrl ?? null, amount, currency: BINANCE_CURRENCY };
}

type QueriedOrder = { status: string; currency: string; orderAmount: string; transactTime?: number };

/**
 * Consulta la orden en Binance y, si está pagada, suma sus meses de Pro una sola vez (la marca PAID se reclama de
 * forma atómica: el webhook y la vuelta del pago pueden llegar a la vez). Con userId, solo para su dueño.
 */
export async function syncBinanceOrder(
  merchantTradeNo: string,
  opts: { userId?: string; now?: Date } = {},
): Promise<{ paid: boolean; status: string; paidUntil: string | null }> {
  const now = opts.now ?? new Date();
  const order = await prisma.binanceOrder.findUnique({ where: { merchantTradeNo } });
  if (!order || (opts.userId && order.userId !== opts.userId)) throw Errors.notFound("La orden de Binance Pay");
  if (order.status === "PAID") return { paid: true, status: "PAID", paidUntil: await paidUntil(order.userId) };

  const remote = await binancePost<QueriedOrder>("/binancepay/openapi/v2/order/query", { merchantTradeNo });
  if (remote.status !== "PAID") {
    if (["CANCELED", "EXPIRED", "ERROR"].includes(remote.status)) {
      await prisma.binanceOrder.updateMany({ where: { merchantTradeNo, status: "PENDING" }, data: { status: remote.status } });
    }
    return { paid: false, status: remote.status, paidUntil: null };
  }
  const expected = Number(order.amount);
  if (!amountMatches(expected, remote.orderAmount, remote.currency)) {
    log.error("binance.amount_mismatch", { merchantTradeNo, expected, paid: remote.orderAmount, currency: remote.currency });
    throw new AppError(409, "payment_mismatch", "El pago no coincide con la orden. Escríbenos y lo revisamos.");
  }

  const before = (await getEntitlements(order.userId, now)).plan;
  const paidAt = remote.transactTime ? new Date(remote.transactTime) : now;
  const providerSubscriptionId = `binance:${order.userId}`;
  const key = { provider_providerSubscriptionId: { provider: "BINANCE" as const, providerSubscriptionId } };
  const granted = await prisma.$transaction(async (tx) => {
    const claim = await tx.binanceOrder.updateMany({ where: { merchantTradeNo, status: { not: "PAID" } }, data: { status: "PAID", paidAt } });
    if (claim.count === 0) return null; // ya lo aplicó el webhook o la vuelta del pago
    const current = await tx.subscription.findUnique({ where: key });
    const currentPeriodEnd = nextPeriodEnd(current?.status === "ACTIVE" ? current.currentPeriodEnd : null, now, order.months);
    await tx.subscription.upsert({
      where: key,
      create: {
        userId: order.userId,
        provider: "BINANCE",
        plan: "PRO",
        status: "ACTIVE",
        productId: PRODUCT_ID,
        providerSubscriptionId,
        currentPeriodEnd,
        cancelAtPeriodEnd: false,
      },
      update: { status: "ACTIVE", currentPeriodEnd, cancelAtPeriodEnd: false },
    });
    return currentPeriodEnd;
  });

  if (granted) {
    await audit({
      userId: order.userId,
      actor: "webhook",
      action: "billing.binance.paid",
      entity: "binance_order",
      entityId: merchantTradeNo,
      metadata: { amount: expected, months: order.months, paidUntil: granted.toISOString() },
    });
    await prisma.appNotification.create({
      data: {
        userId: order.userId,
        type: "SYSTEM",
        title: "Pago recibido: ya tienes Omni Pro",
        body: `Pagaste ${expected} USDT con Binance Pay. Pro sigue hasta el ${shortDate(granted)}.`,
        href: "/cuenta",
      },
    });
    const after = (await getEntitlements(order.userId, now)).plan;
    if (after !== before) await applyPlanChange(order.userId, before, after, now);
  }
  return { paid: true, status: "PAID", paidUntil: granted?.toISOString() ?? (await paidUntil(order.userId)) };
}

async function paidUntil(userId: string): Promise<string | null> {
  const sub = await prisma.subscription.findUnique({
    where: { provider_providerSubscriptionId: { provider: "BINANCE", providerSubscriptionId: `binance:${userId}` } },
    select: { currentPeriodEnd: true },
  });
  return sub?.currentPeriodEnd?.toISOString() ?? null;
}

/**
 * Tarea programada (cada hora): vence los meses pagados con Binance Pay (Pro → Gratis si no queda otra suscripción
 * vigente) y avisa unos días antes de que venzan, una vez por periodo.
 */
export async function runBinanceBillingJobs(now = new Date()): Promise<Record<string, number>> {
  const expired = await prisma.subscription.findMany({
    where: { provider: "BINANCE", status: "ACTIVE", currentPeriodEnd: { lte: now } },
    select: { id: true, userId: true },
  });
  let downgraded = 0;
  for (const sub of expired) {
    await prisma.subscription.update({ where: { id: sub.id }, data: { status: "EXPIRED" } });
    if ((await getEntitlements(sub.userId, now)).plan === "FREE") {
      await applyPlanChange(sub.userId, "PRO", "FREE", now);
      downgraded++;
    }
  }

  const ending = await prisma.subscription.findMany({
    where: { provider: "BINANCE", status: "ACTIVE", currentPeriodEnd: { gt: now, lte: new Date(now.getTime() + REMINDER_DAYS * DAY_MS) } },
    select: { userId: true, currentPeriodEnd: true },
  });
  let reminded = 0;
  for (const sub of ending) {
    if (!sub.currentPeriodEnd) continue;
    const periodEnd = sub.currentPeriodEnd.toISOString();
    const already = await prisma.appNotification.findFirst({
      where: { userId: sub.userId, data: { path: ["binanceRenewal"], equals: periodEnd } },
      select: { id: true },
    });
    if (already) continue;
    await prisma.appNotification.create({
      data: {
        userId: sub.userId,
        type: "REMINDER",
        title: "Tu Omni Pro vence pronto",
        body: `Pro sigue hasta el ${shortDate(sub.currentPeriodEnd)}. Renuévalo con Binance Pay para no perder el piloto automático.`,
        href: "/cuenta#planes",
        data: { binanceRenewal: periodEnd },
      },
    });
    reminded++;
  }
  return { expired: expired.length, downgraded, reminded };
}
