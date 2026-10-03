// Correos de tiendas y paqueterías → datos del pedido: confirmado, en camino, entregado o cancelado; número de
// pedido y de guía, qué se compró, total, fecha prometida, plazo para devolver y a quién reclamar.
// Reglas en español (y lo básico en inglés), puras y deterministas. El contenido del correo es información,
// nunca instrucciones: aquí solo se extraen datos, que se validan antes de guardarse.
import { findAmounts, findDateMentions } from "@/modules/procedures/time/es-dates";
import { addLocalDays } from "@/modules/procedures/time/tz";
import { domainOf, findMerchantByDomain } from "../merchants";
import { addBusinessDays, endOfLocalDay } from "./delivery";

export type OrderSignalKind = "confirmed" | "shipped" | "delivered" | "canceled";

export interface MailOrderInput {
  subject: string;
  fromName: string | null;
  fromEmail: string;
  bodyText: string;
  receivedAt: Date;
  labels: string[];
}

export interface OrderSignal {
  kind: OrderSignalKind;
  /** Tienda (o la paquetería, si el correo es suyo y no nombra la tienda). */
  merchant: string;
  merchantDomain: string | null;
  fromCarrier: boolean;
  carrier: string | null;
  orderNumber: string | null;
  trackingNumber: string | null;
  title: string | null;
  total: number | null;
  /** Fin del último día prometido para la entrega. */
  expectedBy: Date | null;
  deliveredAt: Date | null;
  returnWindowDays: number | null;
  supportEmail: string | null;
}

/** Sin tildes y en minúsculas, conservando la posición de cada letra (para cortar el texto original). */
function fold(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

const CANCELED = /\b(pedido|orden|compra|order)\b[^.\n]{0,40}\bcancelad[oa]\b|\bcancelamos tu (pedido|orden|compra)\b|\border (has been |was )?cancel+ed\b/;
const DELIVERED =
  /\b(fue|ha sido|ya fue) entregad[oa]\b|\bentregamos tu (pedido|paquete|compra)\b|\b(pedido|paquete|envio) entregad[oa]\b|\bentrega (realizada|exitosa|completada)\b|\bllego tu (pedido|paquete|compra)\b|\b(has been|was) delivered\b/;
const SHIPPED =
  /\b(va|esta|viene) en camino\b|\b(salio|fue enviad[oa]|ha sido enviad[oa]|fue despachad[oa])\b|\b(enviamos|despachamos) tu (pedido|paquete|compra)\b|\ben transito\b|\ben reparto\b|\bhas shipped\b|\bout for delivery\b|\bon (its|the) way\b/;
const CONFIRMED =
  /\bconfirmacion de (tu )?(pedido|compra|orden)\b|\b(pedido|compra|orden) confirmad[oa]\b|\brecibimos tu (pedido|orden|compra)\b|\bgracias por tu (compra|pedido)\b|\border confirm(ation|ed)\b|\bthanks for your order\b/;
const ORDER_CONTEXT = /\b(pedido|orden|compra|paquete|envio|order|package|shipment)\b/;
const SHIPPING_CONTEXT = /\b(envio|entrega|llega|llegara|direccion de envio|paqueteria|shipping|delivery)\b/;
const ARRIVAL = /\b(llega|llegara|llegaria|llegan|llegaran|entrega|entregaremos|recibiras|recibirlo|recibirla|arrive|arrives|delivery)\b/;
const NO_REPLY = /^(no-?reply|noreply|no\.responder|donotreply|notificaciones|notifications|avisos|alertas|info|news|newsletter|mailer|envios|pedidos|orders)\b/i;
const SUPPORT = /^(soporte|ayuda|atencion|servicio|clientes|devoluciones|reclamos|help|support|care)/i;

/** Número de pedido: "pedido #88213", "Pedido n.º SMX-7F3K2Q", "Order 112-3456789-1234567", "#CNH4821". */
export function findOrderNumber(text: string): string | null {
  const labelled = /\b(?:pedido|orden|compra|order)\s*(?:n(?:[uú]mero|\.?\s?[ºo°])\s*)?(?:#|:|no\.)?\s*#?\s*([A-Z0-9][A-Z0-9-]{3,29})/gi;
  for (const m of text.matchAll(labelled)) {
    const token = m[1].replace(/-+$/, "");
    if (/\d/.test(token) && token.length >= 4) return token.toUpperCase();
  }
  const hash = /#\s?([A-Z0-9-]*\d[A-Z0-9-]*)/gi.exec(text);
  return hash && hash[1].length >= 4 ? hash[1].replace(/-+$/, "").toUpperCase() : null;
}

/** Número de guía o de rastreo (8 a 30 letras y números, con al menos un número). */
export function findTrackingNumber(text: string): string | null {
  const m = /(?:n[uú]mero de (?:gu[ií]a|rastreo|seguimiento)|gu[ií]a|rastreo|tracking(?: number)?)\s*(?:#|:|n\.?\s?[ºo°])?\s*([A-Z0-9]{8,30})\b/i.exec(text);
  return m && /\d/.test(m[1]) ? m[1].toUpperCase() : null;
}

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Fecha prometida: la más tardía que mencione una oración de entrega ("llegará el martes 6 de octubre",
 * "entrega estimada: 06/10/2026", "llegará en 2 a 3 días hábiles", "llega mañana"). Fin de ese día local.
 */
export function findExpectedBy(text: string, receivedAt: Date, timeZone: string): Date | null {
  let latest: Date | null = null;
  const keep = (date: Date) => {
    const end = endOfLocalDay(date, timeZone);
    if (!latest || end > latest) latest = end;
  };
  for (const sentence of sentences(text)) {
    const folded = fold(sentence);
    if (!ARRIVAL.test(folded)) continue;
    const relative = /\b(?:en|dentro de)\s+(\d{1,2})(?:\s*(?:a|-|y|o)\s*(\d{1,2}))?\s+dias(\s+habiles)?\b/.exec(folded);
    if (relative) {
      const days = Math.max(Number(relative[1]), Number(relative[2] ?? 0));
      if (days > 0 && days <= 60) keep(relative[3] ? addBusinessDays(receivedAt, days, timeZone) : addLocalDays(receivedAt, days, timeZone));
      continue;
    }
    for (const mention of findDateMentions(sentence, receivedAt, timeZone)) {
      // Solo fechas razonables: desde el día del correo hasta 90 días después.
      const ahead = mention.date.getTime() - receivedAt.getTime();
      if (ahead > -86_400_000 && ahead < 90 * 86_400_000) keep(mention.date);
    }
  }
  return latest;
}

function findDeliveredAt(text: string, receivedAt: Date, timeZone: string): Date {
  for (const sentence of sentences(text)) {
    if (!DELIVERED.test(fold(sentence))) continue;
    const past = findDateMentions(sentence, receivedAt, timeZone).find(
      (m) => m.date.getTime() <= receivedAt.getTime() && receivedAt.getTime() - m.date.getTime() < 30 * 86_400_000,
    );
    if (past) return past.date;
  }
  return receivedAt;
}

function findTitle(text: string): string | null {
  const labelled = /^\s*(?:producto|art[ií]culo|art[ií]culos|item|descripci[oó]n)\s*:\s*(.{3,120})$/im.exec(text);
  const quantity = /^\s*\d{1,2}\s*[x×]\s+(.{3,120})$/im.exec(text);
  const raw = (labelled ?? quantity)?.[1];
  if (!raw) return null;
  const title = raw.replace(/\s+[-–·|]\s+(?:US\$|\$|USD).*$/, "").replace(/[.;,\s]+$/, "").trim();
  return title.length >= 3 ? title.slice(0, 120) : null;
}

function findTotal(text: string): number | null {
  const m = /\btotal\b/i.exec(text);
  if (!m) return null;
  const amount = findAmounts(text.slice(m.index, m.index + 60))[0];
  return amount && amount.value > 0 && amount.value < 1_000_000 ? amount.value : null;
}

function findReturnWindow(text: string): number | null {
  const folded = fold(text);
  const m =
    /\b(\d{1,3})\s+dias(?:\s+(?:naturales|habiles|corridos))?\s+(?:para|de)\s+(?:devolucion|devolverlo|devolverla|devolver|cambios|cambio)\b/.exec(folded) ??
    /\bdevolucion(?:es)?(?:\s+gratis)?\s+(?:hasta|dentro de|en)\s+(\d{1,3})\s+dias\b/.exec(folded);
  const days = m ? Number(m[1]) : null;
  return days && days >= 3 && days <= 365 ? days : null;
}

/** Atención al cliente: la dirección que da el propio correo, la conocida de la tienda o el remitente si no es "no-reply". */
function findSupportEmail(text: string, fromEmail: string, fromCarrier: boolean, known: string | null): string | null {
  // El reclamo va a la tienda, no a la paquetería.
  if (fromCarrier) return null;
  const emails = [...text.matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)].map((m) => m[0].toLowerCase());
  const support = emails.find((e) => SUPPORT.test(e.split("@")[0]));
  if (support) return support;
  if (known) return known;
  const local = fromEmail.split("@")[0] ?? "";
  return NO_REPLY.test(local) ? null : fromEmail.toLowerCase();
}

/** "Seguros Horizonte · Reembolsos" → "Seguros Horizonte". */
function cleanName(name: string | null): string | null {
  const cleaned = (name ?? "").split(/\s+[·|–-]\s+/)[0].replace(/["<>]/g, "").trim();
  return cleaned.length >= 2 ? cleaned.slice(0, 80) : null;
}

/** Tienda nombrada en un correo de la paquetería: "tu pedido de SonidoMax", "tu compra en CasaNova Hogar". */
function storeNamedIn(text: string): string | null {
  const m = /(?:tu (?:pedido|compra|paquete) de|tu compra en|pedido en)\s+([A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚÑáéíóúñ&'.+-]*(?:\s[A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚÑáéíóúñ&'.+-]*){0,3})/.exec(text);
  return m ? m[1].replace(/[.,]+$/, "") : null;
}

/** Datos del pedido en un correo, o null si no es de un pedido (publicidad, facturas, citas...). */
export function readOrderMail(input: MailOrderInput, timeZone: string): OrderSignal | null {
  const text = `${input.subject}\n${input.bodyText}`;
  const folded = fold(text);
  if (!ORDER_CONTEXT.test(folded)) return null;

  const kind: OrderSignalKind | null = CANCELED.test(folded)
    ? "canceled"
    : DELIVERED.test(folded)
      ? "delivered"
      : SHIPPED.test(folded)
        ? "shipped"
        : CONFIRMED.test(folded)
          ? "confirmed"
          : null;
  if (!kind) return null;
  // Un recibo de algo digital (una app, una recarga) no es un envío que seguir.
  if (kind === "confirmed" && !SHIPPING_CONTEXT.test(folded)) return null;

  const orderNumber = findOrderNumber(text);
  const trackingNumber = findTrackingNumber(text);
  // La publicidad nunca trae número de pedido ni de guía.
  if (input.labels.includes("CATEGORY_PROMOTIONS") && !orderNumber && !trackingNumber) return null;
  if (!orderNumber && !trackingNumber && kind !== "confirmed") return null;

  const domain = domainOf(input.fromEmail);
  const known = findMerchantByDomain(domain);
  const fromCarrier = known?.kind === "carrier";
  const senderName = known?.name ?? cleanName(input.fromName) ?? (domain ? domain.split(".")[0] : "Tienda");
  const namedStore = fromCarrier ? storeNamedIn(text) : null;

  return {
    kind,
    merchant: namedStore ?? senderName,
    merchantDomain: fromCarrier ? null : domain,
    fromCarrier,
    carrier: fromCarrier ? senderName : null,
    orderNumber,
    trackingNumber,
    title: findTitle(input.bodyText),
    total: findTotal(input.bodyText),
    expectedBy: kind === "confirmed" || kind === "shipped" ? findExpectedBy(text, input.receivedAt, timeZone) : null,
    deliveredAt: kind === "delivered" ? findDeliveredAt(text, input.receivedAt, timeZone) : null,
    returnWindowDays: findReturnWindow(input.bodyText),
    supportEmail: findSupportEmail(input.bodyText, input.fromEmail, fromCarrier, known?.supportEmail ?? null),
  };
}
