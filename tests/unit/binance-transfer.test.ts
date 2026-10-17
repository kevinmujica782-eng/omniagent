import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  MAX_TRANSFER_MONTHS,
  binanceErrorCode,
  formatAmount,
  isGeoBlocked,
  judgeTransfer,
  keyPermissionProblems,
  matchesPaymentCode,
  monthsForAmount,
  normalizePaymentCode,
  parsePayHistory,
  readRelayEnvelope,
  signQuery,
  signedQuery,
  transferProblemMessage,
  type PayTransfer,
} from "@/modules/billing/binance-transfer-rules";

// Binance Pay a una cuenta personal: firmas de la API de Binance, el historial de Binance Pay, el ID de la orden que
// pega la persona, los meses de Pro por monto y los permisos de la llave de solo lectura.

const NOW = Date.parse("2026-10-17T12:00:00Z");

function transfer(partial: Partial<PayTransfer> = {}): PayTransfer {
  return {
    transactionId: "P_A1B2C3D4E5F6G7",
    orderId: "284567891234567890",
    time: NOW - 60_000,
    amount: 19.99,
    currency: "USDT",
    orderType: "C2C",
    payerName: "Ana",
    note: null,
    ...partial,
  };
}

describe("Binance Pay personal: firma", () => {
  it("firma con HMAC-SHA256 en hexadecimal (el ejemplo de la documentación de Binance)", () => {
    expect(
      signQuery(
        "NhqPtmdSJYdKjVHjA7PZj4Mge3R5YNiP1e3UZjInClVN65XAbvqqM6A7H5fATj0j",
        "symbol=LTCBTC&side=BUY&type=LIMIT&timeInForce=GTC&quantity=1&price=0.1&recvWindow=5000&timestamp=1499827319559",
      ),
    ).toBe("c8db56825ae71d6d79447849e617115f4a920fa2acdcab2b053c4b2838bd6b71");
  });

  it("arma la query con recvWindow, timestamp y la firma al final", () => {
    const query = signedQuery("secreto", { startTime: 1000, endTime: 2000, limit: 100 }, 1_792_197_200_000.4);
    const [unsigned, signature] = query.split("&signature=");
    expect(unsigned).toBe("startTime=1000&endTime=2000&limit=100&recvWindow=10000&timestamp=1792197200000");
    expect(signature).toBe(createHmac("sha256", "secreto").update(unsigned).digest("hex"));
    // El relevo solo deja pasar estos caracteres.
    expect(query).toMatch(/^[A-Za-z0-9=&%._-]*$/);
  });
});

describe("Binance Pay personal: historial", () => {
  it("lee los movimientos y aparta los que no tienen la forma esperada", () => {
    const body = {
      code: "000000",
      message: "success",
      success: true,
      data: [
        {
          orderType: "C2C",
          transactionId: "P_A1B2C3D4E5F6G7",
          orderId: "284567891234567890",
          transactionTime: 1792195200000,
          amount: "19.99000000",
          currency: "usdt",
          walletType: 1,
          payerInfo: { name: "  Ana  ", type: "USER" },
          receiverInfo: { binanceId: "39999999" },
        },
        { orderType: "C2C", transactionId: "P_SALIDA", transactionTime: "1792195300000", amount: "-5", currency: "USDT" },
        { orderType: "C2C", transactionId: "", transactionTime: 1, amount: "1", currency: "USDT" },
        { orderType: "C2C", transactionId: "P_X", transactionTime: 1, amount: "no es un número", currency: "USDT" },
      ],
    };
    const { items, raw, malformed } = parsePayHistory(body);
    expect(raw).toBe(4);
    expect(malformed).toBe(2);
    expect(items).toEqual([
      {
        transactionId: "P_A1B2C3D4E5F6G7",
        orderId: "284567891234567890",
        time: 1792195200000,
        amount: 19.99,
        currency: "USDT",
        orderType: "C2C",
        payerName: "Ana",
        note: null,
      },
      {
        transactionId: "P_SALIDA",
        orderId: null,
        time: 1792195300000,
        amount: -5,
        currency: "USDT",
        orderType: "C2C",
        payerName: null,
        note: null,
      },
    ]);
  });

  it("una respuesta sin data es un error (no una lista vacía)", () => {
    expect(() => parsePayHistory({ code: "-1", msg: "error" })).toThrow();
  });
});

describe("Binance Pay personal: el ID de la orden", () => {
  it("limpia lo que pega la persona", () => {
    expect(normalizePaymentCode(" 2845 6789 1234 5678 90 ")).toBe("284567891234567890");
    expect(normalizePaymentCode("p_a1b2c3d4e5f6g7")).toBe("P_A1B2C3D4E5F6G7");
    expect(normalizePaymentCode("ID de la orden: 284567891234567890")).toBe("284567891234567890");
    expect(normalizePaymentCode("Order ID 284567891234567890 (copiado)")).toBe("284567891234567890");
    expect(normalizePaymentCode("ID de la orden: 2845 6789 1234 5678 90")).toBe("284567891234567890");
    expect(normalizePaymentCode("abc")).toBeNull();
    expect(normalizePaymentCode("¿?¡!")).toBeNull();
    expect(normalizePaymentCode("")).toBeNull();
  });

  it("encuentra el pago por su transactionId, por el ID de la orden o por los números del ID", () => {
    const item = transfer({ transactionId: "C_P_284567891234567890", orderId: null });
    expect(matchesPaymentCode(item, "C_P_284567891234567890")).toBe(true);
    expect(matchesPaymentCode(item, "284567891234567890")).toBe(true);
    expect(matchesPaymentCode(transfer(), "284567891234567890")).toBe(true);
    expect(matchesPaymentCode(transfer(), "P_A1B2C3D4E5F6G7")).toBe(true);
    // Pocos números no alcanzan para comparar solo los dígitos.
    expect(matchesPaymentCode(transfer({ transactionId: "P_A123456", orderId: null }), "123456")).toBe(false);
    expect(matchesPaymentCode(transfer(), "999999999999999999")).toBe(false);
  });
});

describe("Binance Pay personal: meses de Pro", () => {
  it("cuenta los meses por monto, con tope", () => {
    expect(monthsForAmount(19.99)).toBe(1);
    expect(monthsForAmount(20)).toBe(1);
    expect(monthsForAmount(19.98)).toBe(0);
    expect(monthsForAmount(39.98)).toBe(2);
    expect(monthsForAmount(39.97)).toBe(1);
    expect(monthsForAmount(59.97)).toBe(3);
    expect(monthsForAmount(1000)).toBe(MAX_TRANSFER_MONTHS);
    expect(monthsForAmount(Number.NaN)).toBe(0);
    expect(monthsForAmount(-19.99)).toBe(0);
  });

  it("solo sirve un envío recibido, en USDT o USDC, reciente y de al menos 19.99", () => {
    const notBefore = NOW - 3_600_000;
    expect(judgeTransfer(transfer(), { notBefore })).toEqual({ ok: true, months: 1 });
    expect(judgeTransfer(transfer({ currency: "USDC", amount: 39.98 }), { notBefore })).toEqual({ ok: true, months: 2 });
    expect(judgeTransfer(transfer({ amount: -19.99 }), { notBefore })).toEqual({ ok: false, problem: "outgoing" });
    expect(judgeTransfer(transfer({ orderType: "PAY_REFUND" }), { notBefore })).toEqual({ ok: false, problem: "not_transfer" });
    expect(judgeTransfer(transfer({ currency: "BTC" }), { notBefore })).toEqual({ ok: false, problem: "currency" });
    expect(judgeTransfer(transfer({ time: notBefore - 1 }), { notBefore })).toEqual({ ok: false, problem: "too_old" });
    expect(judgeTransfer(transfer({ amount: 15 }), { notBefore })).toEqual({ ok: false, problem: "underpaid" });
  });

  it("explica por qué un pago no sirve", () => {
    expect(transferProblemMessage("underpaid", { amount: 15, currency: "USDT" })).toBe(
      "Recibimos 15 USDT, y un mes de Pro cuesta 19.99 USDT. Escríbenos para completar el pago.",
    );
    expect(transferProblemMessage("currency", { amount: 0.001, currency: "BTC" })).toMatch(/llegó en BTC/);
    expect(formatAmount(15.5)).toBe("15.50");
    expect(formatAmount(19.99)).toBe("19.99");
    expect(formatAmount(20)).toBe("20");
  });
});

describe("Binance Pay personal: la llave de solo lectura", () => {
  const readOnly = {
    ipRestrict: false,
    createTime: 1792190000000,
    enableReading: true,
    enableWithdrawals: false,
    enableInternalTransfer: false,
    enableMargin: false,
    enableFutures: false,
    permitsUniversalTransfer: false,
    enableVanillaOptions: false,
    enableFixApiTrade: false,
    enableFixReadOnly: true,
    enableSpotAndMarginTrading: false,
    enablePortfolioMarginTrading: false,
  };

  it("acepta una llave que solo lee", () => {
    expect(keyPermissionProblems(readOnly)).toEqual([]);
  });

  it("rechaza una llave que puede mover dinero o que no lee", () => {
    expect(keyPermissionProblems({ ...readOnly, enableWithdrawals: true })).toEqual(["enableWithdrawals encendido"]);
    expect(keyPermissionProblems({ ...readOnly, permitsUniversalTransfer: true, enableSpotAndMarginTrading: true })).toEqual([
      "permitsUniversalTransfer encendido",
      "enableSpotAndMarginTrading encendido",
    ]);
    expect(keyPermissionProblems({ ...readOnly, enableReading: false })).toEqual(["enableReading apagado"]);
    // Un permiso nuevo que Binance agregue y mueva dinero también cuenta.
    expect(keyPermissionProblems({ ...readOnly, enableNuevoProducto: true })).toEqual(["enableNuevoProducto encendido"]);
    expect(keyPermissionProblems(null)).toEqual(["respuesta de permisos inválida"]);
  });
});

describe("Binance Pay personal: el relevo", () => {
  it("lee lo que devuelve el relevo y los errores de Binance", () => {
    expect(readRelayEnvelope({ status: 200, body: '{"serverTime":1}' })).toEqual({ status: 200, body: '{"serverTime":1}' });
    expect(readRelayEnvelope({ error: "unauthorized" })).toBeNull();
    expect(binanceErrorCode({ code: -1021, msg: "Timestamp for this request is outside of the recvWindow." })).toBe(-1021);
    expect(binanceErrorCode({ code: "-2008" })).toBe(-2008);
    expect(binanceErrorCode({ code: "000000" })).toBe(0);
    expect(binanceErrorCode(null)).toBeNull();
    expect(isGeoBlocked(451)).toBe(true);
    expect(isGeoBlocked(400)).toBe(false);
  });
});
