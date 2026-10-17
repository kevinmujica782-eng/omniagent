import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { claimTransfer, startTransfer, type IncomingTransfers } from "@/modules/billing/binance-transfer";
import type { PayTransfer } from "@/modules/billing/binance-transfer-rules";
import { getEntitlements } from "@/modules/billing/entitlements";

// Binance Pay a una cuenta personal contra un Postgres de verdad (job «Base de datos (Postgres)» de CI): la solicitud de
// pago, el reclamo con el ID de la orden, los meses de Pro, el mismo pago usado dos veces y los reclamos simultáneos.
// El historial de Binance se reemplaza por una lista de prueba (nunca se llama a la red).

const ana = randomUUID();
const beto = randomUUID();
const carla = randomUUID();
const T0 = new Date("2026-10-17T12:00:00Z");
const MIN = 60_000;
const DAY = 86_400_000;

function payment(partial: Partial<PayTransfer> & Pick<PayTransfer, "transactionId">): PayTransfer {
  return { orderId: null, time: T0.getTime() + 5 * MIN, amount: 19.99, currency: "USDT", orderType: "C2C", payerName: "Cliente", note: null, ...partial };
}

/** Historial de prueba: guarda las ventanas que se pidieron. */
function history(items: PayTransfer[]) {
  const windows: [number, number][] = [];
  const fetcher: IncomingTransfers = async (since, until) => {
    windows.push([since, until]);
    return items.filter((item) => item.time >= since && item.time <= until && item.amount > 0);
  };
  return { fetcher, windows };
}

async function expectError(promise: Promise<unknown>, code: string) {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(AppError);
  expect((error as AppError).code).toBe(code);
  return error as AppError;
}

const binanceEnd = async (userId: string) =>
  (await prisma.subscription.findUnique({
    where: { provider_providerSubscriptionId: { provider: "BINANCE", providerSubscriptionId: `binance:${userId}` } },
  }))?.currentPeriodEnd?.toISOString() ?? null;

beforeAll(async () => {
  for (const id of [ana, beto, carla]) await prisma.profile.create({ data: { id, email: `binance-${id}@test.local` } });
});

afterAll(async () => {
  await prisma.profile.deleteMany({ where: { id: { in: [ana, beto, carla] } } });
  await prisma.$disconnect();
});

describe("Binance Pay a la cuenta personal", () => {
  it("abre la solicitud de pago una vez y dice a dónde pagar", async () => {
    const first = await startTransfer(ana, T0);
    expect(first).toMatchObject({ payId: "123456789", payName: "Omni Pruebas", amount: 19.99, currency: "USDT", currencies: ["USDT", "USDC"] });
    expect(first.startedAt).toBe(T0.toISOString());
    // Volver a abrir la pantalla no corre la fecha (los pagos desde la primera vez siguen sirviendo).
    const again = await startTransfer(ana, new Date(T0.getTime() + DAY));
    expect(again.startedAt).toBe(T0.toISOString());
    expect(await prisma.binanceOrder.count({ where: { userId: ana, kind: "TRANSFER", status: "PENDING" } })).toBe(1);
  });

  it("con el ID de la orden activa un mes de Pro, una sola vez", async () => {
    const { fetcher, windows } = history([payment({ transactionId: "P_ANA0000001", orderId: "284567891234567890" })]);
    const now = new Date(T0.getTime() + 10 * MIN);
    const result = await claimTransfer(ana, "ID de la orden: 2845 6789 1234 5678 90", { now, incoming: fetcher });
    expect(result).toMatchObject({ paid: true, months: 1, amount: 19.99, currency: "USDT", alreadyClaimed: false });
    expect(result.paidUntil).toBe("2026-11-17T12:10:00.000Z");
    expect((await getEntitlements(ana, now)).plan).toBe("PRO");
    // Solo se pidió a Binance desde 48 h antes de la solicitud (más una semana de margen para avisar "muy viejo").
    expect(windows[0][0]).toBe(T0.getTime() - 2 * DAY - 7 * DAY);
    expect(windows[0][1]).toBe(now.getTime());

    const order = await prisma.binanceOrder.findUnique({ where: { transactionId: "P_ANA0000001" } });
    expect(order).toMatchObject({ userId: ana, kind: "TRANSFER", status: "PAID", months: 1, claimCode: "284567891234567890", payerName: "Cliente" });
    const notice = await prisma.appNotification.findFirst({ where: { userId: ana, title: "Pago recibido: ya tienes Omni Pro" } });
    expect(notice?.body).toMatch(/^Pagaste 19\.99 USDT con Binance Pay\. Pro sigue hasta el 17 nov/);

    // Repetir (doble toque, o con el otro ID del mismo pago) no suma meses.
    const repeated = await claimTransfer(ana, "284567891234567890", { now, incoming: fetcher });
    expect(repeated).toMatchObject({ alreadyClaimed: true, months: 1 });
    const viaTransactionId = await claimTransfer(ana, "p_ana0000001", { now, incoming: fetcher });
    expect(viaTransactionId).toMatchObject({ alreadyClaimed: true });
    expect(await binanceEnd(ana)).toBe("2026-11-17T12:10:00.000Z");
  });

  it("el mismo pago no sirve en otra cuenta", async () => {
    const { fetcher } = history([payment({ transactionId: "P_ANA0000001", orderId: "284567891234567890" })]);
    await startTransfer(beto, T0);
    const error = await expectError(claimTransfer(beto, "284567891234567890", { now: new Date(T0.getTime() + 20 * MIN), incoming: fetcher }), "payment_already_used");
    expect(error.status).toBe(409);
    expect((await getEntitlements(beto, new Date(T0.getTime() + 20 * MIN))).plan).toBe("FREE");
  });

  it("explica los pagos que no sirven: no encontrado, viejo, incompleto o en otra moneda", async () => {
    const now = new Date(T0.getTime() + 30 * MIN);
    const { fetcher } = history([
      payment({ transactionId: "P_VIEJO00001", time: T0.getTime() - 3 * DAY }),
      payment({ transactionId: "P_CORTO00001", amount: 15 }),
      payment({ transactionId: "P_BTC0000001", amount: 0.0003, currency: "BTC" }),
    ]);
    const missing = await expectError(claimTransfer(beto, "P_NOEXISTE01", { now, incoming: fetcher }), "payment_not_found");
    expect(missing.status).toBe(404);
    await expectError(claimTransfer(beto, "P_VIEJO00001", { now, incoming: fetcher }), "payment_too_old");
    const short = await expectError(claimTransfer(beto, "P_CORTO00001", { now, incoming: fetcher }), "payment_underpaid");
    expect(short.message).toMatch(/Recibimos 15 USDT/);
    await expectError(claimTransfer(beto, "P_BTC0000001", { now, incoming: fetcher }), "payment_currency");
    await expectError(claimTransfer(beto, "???", { now, incoming: fetcher }), "bad_request");
    // Nada de eso dejó a Beto con Pro ni gastó su solicitud de pago.
    expect((await getEntitlements(beto, now)).plan).toBe("FREE");
    expect(await prisma.binanceOrder.count({ where: { userId: beto, status: "PENDING" } })).toBe(1);
  });

  it("renovar suma desde el fin vigente, y 39.98 son dos meses", async () => {
    const now = new Date(T0.getTime() + 2 * DAY);
    await startTransfer(ana, now);
    const { fetcher } = history([payment({ transactionId: "P_ANA0000002", time: now.getTime() - MIN, amount: 39.98, currency: "USDC" })]);
    const result = await claimTransfer(ana, "P_ANA0000002", { now, incoming: fetcher });
    expect(result).toMatchObject({ months: 2, currency: "USDC", alreadyClaimed: false });
    expect(result.paidUntil).toBe("2027-01-17T12:10:00.000Z");
  });

  it("dos reclamos del mismo pago a la vez activan Pro una sola vez", async () => {
    await startTransfer(carla, T0);
    const { fetcher } = history([payment({ transactionId: "P_CARLA00001" })]);
    const now = new Date(T0.getTime() + 15 * MIN);
    const results = await Promise.allSettled([
      claimTransfer(carla, "P_CARLA00001", { now, incoming: fetcher }),
      claimTransfer(carla, "P_CARLA00001", { now, incoming: fetcher }),
      claimTransfer(carla, "P_CARLA00001", { now, incoming: fetcher }),
    ]);
    expect(results.every((result) => result.status === "fulfilled")).toBe(true);
    const fresh = results.filter((result) => result.status === "fulfilled" && !result.value.alreadyClaimed);
    expect(fresh).toHaveLength(1);
    expect(await binanceEnd(carla)).toBe("2026-11-17T12:15:00.000Z");
    expect(await prisma.binanceOrder.count({ where: { userId: carla, status: "PAID" } })).toBe(1);
  });
});
