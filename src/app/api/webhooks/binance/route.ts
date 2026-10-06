import { NextResponse } from "next/server";
import { AppError } from "@/lib/errors";
import { log } from "@/lib/log";
import { binanceCertificate, binanceConfigured, syncBinanceOrder } from "@/modules/billing/binance";
import { paidOrderFromWebhook, verifyWebhookSignature } from "@/modules/billing/binance-rules";

export const maxDuration = 30;

// Binance espera { returnCode: "SUCCESS" } con HTTP 200; con "FAIL" reintenta hasta 6 veces.
const success = () => NextResponse.json({ returnCode: "SUCCESS", returnMessage: null });
const failure = (message: string, status: number) => NextResponse.json({ returnCode: "FAIL", returnMessage: message }, { status });

/**
 * Webhook de Binance Pay. Verifica la firma con el certificado de Binance y, en un pago exitoso, vuelve a consultar
 * la orden en la API antes de activar Pro: un aviso falso o repetido no activa nada.
 */
export async function POST(request: Request) {
  if (!binanceConfigured()) return failure("Binance Pay no está configurado", 503);
  const body = await request.text();
  const timestamp = request.headers.get("binancepay-timestamp");
  const nonce = request.headers.get("binancepay-nonce");
  const signature = request.headers.get("binancepay-signature");
  const serial = request.headers.get("binancepay-certificate-sn");
  if (!timestamp || !nonce || !signature || !serial) return failure("Faltan las cabeceras de la firma", 401);

  const publicKey = await binanceCertificate(serial).catch(() => null);
  if (!publicKey || !verifyWebhookSignature(publicKey, timestamp, nonce, body, signature)) {
    log.warn("binance.webhook_bad_signature", { serial });
    return failure("Firma inválida", 401);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return failure("Cuerpo inválido", 400);
  }
  const merchantTradeNo = paidOrderFromWebhook(payload);
  if (!merchantTradeNo) return success(); // cierre, reembolso u otro aviso: nada que activar

  try {
    await syncBinanceOrder(merchantTradeNo);
    return success();
  } catch (error) {
    // Una orden que no es nuestra no se reintenta; lo demás sí.
    if (error instanceof AppError && error.status === 404) return success();
    log.error("binance.webhook_failed", { merchantTradeNo, error });
    return failure("Reintenta", 500);
  }
}
