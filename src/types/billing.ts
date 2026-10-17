// Contrato del plan y la facturación entre la API, la cuenta, el panel de Inicio y la hoja de mejora.
import type { AgentFeatureId, PlanId } from "@/modules/billing/plans";

export type UsageMeterView = { used: number; limit: number };

export interface AgentFeatureView {
  id: AgentFeatureId;
  title: string;
  enabled: boolean;
  /** Qué hace con el plan actual ("Una revisión al día." en Gratis; la descripción completa en Pro). */
  detail: string;
}

export interface BillingOverview {
  plan: PlanId;
  planName: string;
  priceLabel: string;
  source: "STRIPE" | "REVENUECAT" | "BINANCE" | null;
  status: string | null;
  renewsAt: string | null;
  cancelAtPeriodEnd: boolean;
  /** "past_due": el último cobro falló (Pro sigue mientras Stripe reintenta); "canceling": termina al final del periodo. */
  notice: "past_due" | "canceling" | null;
  features: AgentFeatureView[];
  usage: {
    messages: UsageMeterView;
    formReads: UsageMeterView;
    pageReads: UsageMeterView;
    /** Páginas de estados de cuenta en foto (o PDF escaneados) leídas con IA. */
    statementPages: UsageMeterView;
    watching: UsageMeterView;
    goals: UsageMeterView;
  };
  /** El pago de la web está configurado (STRIPE_SECRET_KEY y el precio de Pro). */
  checkoutAvailable: boolean;
  /** Binance Pay está configurado: es la forma de pago en la web y en la app (sin Google Play). */
  binanceAvailable: boolean;
  /**
   * Cómo se paga con Binance Pay: "merchant" abre la página de pago de Binance (cuenta de comercio); "transfer" pide
   * enviar al Pay ID de la cuenta y pegar el ID de la orden (cuenta personal).
   */
  binanceMode: BinanceMode | null;
}

export type BinanceMode = "merchant" | "transfer";

/** POST /api/v1/billing/binance/transfer: a dónde y cuánto pagar. */
export interface BinanceTransferStartView {
  payId: string;
  payName: string | null;
  amount: number;
  currency: "USDT";
  currencies: string[];
  startedAt: string;
}

/** POST /api/v1/billing/binance/transfer/claim: el pago encontrado y hasta cuándo queda Pro. */
export interface BinanceTransferClaimView {
  paid: true;
  months: number;
  amount: number;
  currency: string;
  paidUntil: string | null;
  alreadyClaimed: boolean;
  plan: "FREE" | "PRO";
}
