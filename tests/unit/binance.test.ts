import { createSign, generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  PRO_MONTH_USDT,
  addMonths,
  amountMatches,
  binanceNonce,
  isMerchantTradeNo,
  newMerchantTradeNo,
  nextPeriodEnd,
  paidOrderFromWebhook,
  signRequest,
  verifyWebhookSignature,
} from "@/modules/billing/binance-rules";

const TIMESTAMP = "1696500000000";
const NONCE = "abcdefghijABCDEFGHIJabcdefghijAB";
const BODY = '{"merchantTradeNo":"OMNI1"}';

describe("Binance Pay: firmas", () => {
  it("firma las solicitudes con HMAC-SHA512 en hexadecimal mayúsculas", () => {
    // Calculado aparte (Python hmac) sobre "timestamp\nnonce\nbody\n".
    expect(signRequest("test-secret-key", TIMESTAMP, NONCE, BODY)).toBe(
      "1AA29B9E11AE83CC4F13C34F6CE9C8194400C954F80DA3B7612A23C7CBC0C1086BC23B232D581A7E17754922FD6BDFE15681D654F57FE896710EFCE6BF3BFDEB",
    );
  });

  it("verifica la firma RSA de un webhook, con la llave en PEM o solo en base64", () => {
    const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const signer = createSign("RSA-SHA256");
    signer.update(`${TIMESTAMP}\n${NONCE}\n${BODY}\n`);
    const signature = signer.sign(privateKey).toString("base64");
    const pem = publicKey.export({ type: "spki", format: "pem" }).toString();
    const bare = publicKey.export({ type: "spki", format: "der" }).toString("base64");

    expect(verifyWebhookSignature(pem, TIMESTAMP, NONCE, BODY, signature)).toBe(true);
    expect(verifyWebhookSignature(bare, TIMESTAMP, NONCE, BODY, signature)).toBe(true);
    expect(verifyWebhookSignature(pem, TIMESTAMP, NONCE, '{"merchantTradeNo":"OMNI2"}', signature)).toBe(false);
    expect(verifyWebhookSignature("no es una llave", TIMESTAMP, NONCE, BODY, signature)).toBe(false);
  });

  it("arma nonces de 32 letras y órdenes válidas para Binance", () => {
    expect(binanceNonce()).toMatch(/^[A-Za-z]{32}$/);
    const tradeNo = newMerchantTradeNo(new Date("2026-10-06T12:00:00Z"));
    expect(tradeNo.startsWith("OMNI")).toBe(true);
    expect(isMerchantTradeNo(tradeNo)).toBe(true);
    expect(isMerchantTradeNo("OMNI-1")).toBe(false);
    expect(isMerchantTradeNo("A".repeat(33))).toBe(false);
  });
});

describe("Binance Pay: meses de Pro", () => {
  const now = new Date("2026-10-06T12:00:00Z");

  it("un mes de Pro cuesta lo mismo en USDT que en dólares", () => {
    expect(PRO_MONTH_USDT).toBe(19.99);
  });

  it("suma desde hoy si no hay Pro vigente y desde el fin si todavía lo hay", () => {
    expect(nextPeriodEnd(null, now, 1).toISOString()).toBe("2026-11-06T12:00:00.000Z");
    expect(nextPeriodEnd(new Date("2026-09-01T00:00:00Z"), now, 1).toISOString()).toBe("2026-11-06T12:00:00.000Z");
    expect(nextPeriodEnd(new Date("2026-10-20T08:00:00Z"), now, 1).toISOString()).toBe("2026-11-20T08:00:00.000Z");
  });

  it("del 31 de enero pasa al último día de febrero", () => {
    expect(addMonths(new Date("2027-01-31T10:00:00Z"), 1).toISOString()).toBe("2027-02-28T10:00:00.000Z");
    expect(addMonths(new Date("2028-01-31T10:00:00Z"), 1).toISOString()).toBe("2028-02-29T10:00:00.000Z");
  });

  it("acepta el pago solo si el monto y la moneda coinciden", () => {
    expect(amountMatches(19.99, "19.99", "USDT")).toBe(true);
    expect(amountMatches(19.99, "19.98", "USDT")).toBe(false);
    expect(amountMatches(19.99, "19.99", "BNB")).toBe(false);
  });
});

describe("Binance Pay: webhooks", () => {
  it("devuelve la orden de un pago exitoso, con data como texto JSON o como objeto", () => {
    const data = JSON.stringify({ merchantTradeNo: "OMNI1696500000000abcDEF12", totalFee: 19.99, currency: "USDT" });
    expect(paidOrderFromWebhook({ bizType: "PAY", bizId: 1, bizStatus: "PAY_SUCCESS", data })).toBe("OMNI1696500000000abcDEF12");
    expect(paidOrderFromWebhook({ bizType: "PAY", bizStatus: "PAY_SUCCESS", data: { merchantTradeNo: "OMNI2" } })).toBe("OMNI2");
  });

  it("ignora cierres, otros tipos y datos raros", () => {
    const data = JSON.stringify({ merchantTradeNo: "OMNI1" });
    expect(paidOrderFromWebhook({ bizType: "PAY", bizStatus: "PAY_CLOSED", data })).toBeNull();
    expect(paidOrderFromWebhook({ bizType: "PAY_REFUND", bizStatus: "REFUND_SUCCESS", data })).toBeNull();
    expect(paidOrderFromWebhook({ bizType: "PAY", bizStatus: "PAY_SUCCESS", data: "no es json" })).toBeNull();
    expect(paidOrderFromWebhook({ bizType: "PAY", bizStatus: "PAY_SUCCESS", data: JSON.stringify({ merchantTradeNo: "OMNI-1" }) })).toBeNull();
  });
});
