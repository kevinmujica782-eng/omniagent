// Pagos. Hoy solo existe el proveedor de prueba: nunca se pide ni se guarda el número de una tarjeta, y ningún
// cobro sale del servidor. Un proveedor real (por ejemplo, Stripe con métodos guardados mediante SetupIntent y
// Elements, que se encargan de los datos de la tarjeta) implementaría el mismo contrato.
import type { PaymentMethodView } from "@/types/cards";

export type ChargeInput = {
  methodId: string;
  amount: number;
  currency: string;
  /** La acción aprobada: un mismo pedido nunca se cobra dos veces. */
  idempotencyKey: string;
  description: string;
};

export type ChargeResult = { status: "succeeded"; reference: string } | { status: "declined"; reason: string };

export interface PaymentProvider {
  id: "sandbox";
  methods(): PaymentMethodView[];
  charge(input: ChargeInput): Promise<ChargeResult>;
}

const METHODS: PaymentMethodView[] = [
  { id: "pm_sbx_visa", brand: "visa", label: "Visa de prueba", last4: "4242", sandbox: true, declines: false },
  { id: "pm_sbx_decline", brand: "mastercard", label: "Tarjeta de prueba que rechaza", last4: "0002", sandbox: true, declines: true },
];

function reference(seed: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `sbx_ch_${h.toString(36)}${seed.length.toString(36)}`;
}

export const sandboxPayments: PaymentProvider = {
  id: "sandbox",
  methods: () => METHODS,
  async charge(input) {
    const method = METHODS.find((m) => m.id === input.methodId);
    if (!method) return { status: "declined", reason: "Ese medio de pago no existe." };
    if (method.declines) return { status: "declined", reason: "La tarjeta de prueba rechazó el pago (fondos insuficientes, simulado)." };
    return { status: "succeeded", reference: reference(`${input.idempotencyKey}:${input.amount}:${input.currency}`) };
  },
};

export function paymentLabel(method: PaymentMethodView): string {
  return `${method.label} •••• ${method.last4}`;
}

export function paymentProvider(): PaymentProvider {
  return sandboxPayments;
}
