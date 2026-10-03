// Devoluciones de prueba: pedidos de ejemplo en las tiendas de prueba (.test) y la respuesta simulada de esas
// tiendas a un reclamo. Sirven para probar el ciclo completo (retraso → reclamo → respuesta → reembolso) sin
// tiendas reales, igual que "Probar una bajada" en Compras. Puro: el servicio decide dónde guardarlo.
import { money } from "@/lib/format";
import { SANDBOX_PRODUCTS, SANDBOX_STORES } from "@/modules/concierge/sandbox/stores";
import { longDate } from "@/modules/procedures/time/es-dates";
import { addLocalDays, atLocalTime } from "@/modules/procedures/time/tz";
import type { ReturnOutcomeId, ReturnReasonId, ShipmentStatusId } from "@/types/cards";
import { SANDBOX_RETURN_DAYS } from "./merchants";
import { addBusinessDays, endOfLocalDay } from "./rules/delivery";

export interface ExampleOrder {
  key: string;
  merchant: string;
  merchantDomain: string;
  supportEmail: string;
  orderNumber: string;
  title: string;
  total: number;
  status: ShipmentStatusId;
  orderedAt: Date;
  expectedBy: Date;
  deliveredAt: Date | null;
  carrier: string | null;
  trackingNumber: string | null;
  returnWindowDays: number;
}

function product(id: string) {
  const item = SANDBOX_PRODUCTS.find((p) => p.id === id);
  const store = SANDBOX_STORES.find((s) => s.id === item?.storeId);
  if (!item || !store) throw new Error(`Producto de prueba desconocido: ${id}`);
  return { item, store };
}

/** Tres pedidos que cuentan la historia: uno retrasado, uno entregado (se puede devolver) y uno en camino. */
export function exampleOrders(now: Date, timeZone: string): ExampleOrder[] {
  const day = (offset: number, hour = 10) => atLocalTime(addLocalDays(now, offset, timeZone), hour, 0, timeZone);
  const make = (
    id: string,
    order: Omit<ExampleOrder, "key" | "merchant" | "merchantDomain" | "supportEmail" | "title" | "total" | "returnWindowDays">,
  ): ExampleOrder => {
    const { item, store } = product(id);
    return {
      key: `example:${id}`,
      merchant: store.name,
      merchantDomain: store.host,
      supportEmail: `soporte@${store.host}`,
      title: item.title,
      total: Math.round((item.base + (store.freeShippingOver !== null && item.base >= store.freeShippingOver ? 0 : store.shipping)) * 100) / 100,
      returnWindowDays: SANDBOX_RETURN_DAYS,
      ...order,
    };
  };
  return [
    make("andes-2", {
      orderNumber: "CUM-48213",
      status: "SHIPPED",
      orderedAt: day(-9),
      expectedBy: endOfLocalDay(day(-3), timeZone),
      deliveredAt: null,
      carrier: "EnvíosYa",
      trackingNumber: "EY4821300MX",
    }),
    make("crisp-5l", {
      orderNumber: "CNH-77104",
      status: "DELIVERED",
      orderedAt: day(-12),
      expectedBy: endOfLocalDay(day(-5), timeZone),
      deliveredAt: day(-4, 15),
      carrier: "EnvíosYa",
      trackingNumber: "EY7710400MX",
    }),
    make("aura-x2", {
      orderNumber: "SMX-30958",
      status: "SHIPPED",
      orderedAt: day(-2),
      expectedBy: endOfLocalDay(day(2), timeZone),
      deliveredAt: null,
      carrier: "EnvíosYa",
      trackingNumber: "EY3095800MX",
    }),
  ];
}

export interface SimulatedReply {
  fromName: string;
  fromEmail: string;
  subject: string;
  body: string;
}

/**
 * Lo que respondería la tienda de prueba. `stage` 0 es la primera respuesta; 1, la que llega después de que el
 * usuario devolvió el paquete (reembolso o saldo a favor).
 */
export function sandboxStoreReply(ctx: {
  merchant: string;
  merchantDomain: string;
  orderNumber: string | null;
  subject: string;
  reason: ReturnReasonId;
  desired: ReturnOutcomeId;
  amount: number | null;
  currency: string;
  stage: 0 | 1;
  now: Date;
  timeZone: string;
}): SimulatedReply {
  const amount = ctx.amount ? money(ctx.amount, ctx.currency, { cents: true }) : null;
  const refundLine = `Emitimos el reembolso${amount ? ` de ${amount}` : ""} a tu medio de pago; lo verás en 5 a 10 días hábiles.`;
  const which = ctx.orderNumber ? `tu pedido ${ctx.orderNumber}` : "tu pedido";
  let body: string;
  if (ctx.stage === 1) {
    body =
      ctx.desired === "STORE_CREDIT"
        ? `Recibimos el producto de ${which}. Te dimos saldo a favor${amount ? ` por ${amount}` : ""} en tu cuenta de ${ctx.merchant}.`
        : `Recibimos el producto de ${which}. ${refundLine}`;
  } else if (ctx.reason === "LATE" && ctx.desired === "ARRIVED") {
    const eta = endOfLocalDay(addBusinessDays(ctx.now, 2, ctx.timeZone), ctx.timeZone);
    body = `Lamentamos el retraso de ${which}: la paquetería tuvo un problema en la ruta. Tu pedido llegará el ${longDate(eta, ctx.timeZone)}. Si no te llega ese día, escríbenos y lo resolvemos.`;
  } else if (ctx.reason === "LATE" || ctx.reason === "NOT_RECEIVED") {
    body = `Lamentamos que ${which} no te haya llegado. ${refundLine}`;
  } else if (ctx.desired === "REPLACEMENT") {
    body = `Lamentamos lo ocurrido con ${which}. Te enviamos uno nuevo sin costo en los próximos días. No necesitas devolver el producto.`;
  } else {
    const by = endOfLocalDay(addLocalDays(ctx.now, 7, ctx.timeZone), ctx.timeZone);
    body = `Aprobamos la devolución de ${which}. Te enviamos la etiqueta de envío prepagada: imprímela y deja el paquete en cualquier oficina de EnvíosYa antes del ${longDate(by, ctx.timeZone)}. Al recibirlo, te ${ctx.desired === "STORE_CREDIT" ? "damos saldo a favor" : "reembolsamos"}${amount ? ` ${amount}` : ""}.`;
  }
  return {
    fromName: `${ctx.merchant} · Atención al cliente`,
    fromEmail: `soporte@${ctx.merchantDomain}`,
    subject: `Re: ${ctx.subject}`,
    body: `Hola:\n\n${body}\n\nEquipo de ${ctx.merchant} (tienda de prueba)`,
  };
}
