// Tiendas, marketplaces y paqueterías conocidas: cómo reconocer sus correos, dónde se reclama y a quién pedir
// ayuda si no responden. Las tiendas de prueba (.test) atienden por correo y su respuesta se puede simular.
// De las tiendas reales no se inventan correos ni plazos: se reclama en su portal y el plazo sale de sus correos.
// Sin dependencias de servidor: lo usan el servicio, las reglas, la vista previa y las pruebas.
import { SANDBOX_STORES } from "@/modules/concierge/sandbox/stores";

export type MerchantKind = "store" | "marketplace" | "carrier";

export interface MerchantInfo {
  name: string;
  domains: string[];
  kind: MerchantKind;
  /** A dónde reclamar por correo (solo si la tienda atiende así). */
  supportEmail: string | null;
  /** Días para devolver desde la entrega, cuando es una regla general de la tienda. */
  returnWindowDays: number | null;
  /** Cómo reclamar en su portal o app, cuando no es por correo. */
  howToClaim: string | null;
  /** Qué hacer si el vendedor no responde o no lo resuelve. */
  escalation: string | null;
  sandbox: boolean;
}

/** Plazo de devolución de las tiendas de prueba que envían productos. */
export const SANDBOX_RETURN_DAYS = 30;

const SANDBOX: MerchantInfo[] = [
  ...SANDBOX_STORES.map(
    (store): MerchantInfo => ({
      name: store.name,
      domains: [store.host],
      kind: "store",
      supportEmail: `soporte@${store.host}`,
      returnWindowDays: store.deliveryDays !== null ? SANDBOX_RETURN_DAYS : null,
      howToClaim: null,
      escalation: null,
      sandbox: true,
    }),
  ),
  {
    name: "EnvíosYa",
    domains: ["enviosya.test"],
    kind: "carrier",
    supportEmail: null,
    returnWindowDays: null,
    howToClaim: null,
    escalation: null,
    sandbox: true,
  },
];

const store = (
  name: string,
  domains: string[],
  kind: MerchantKind,
  howToClaim: string | null,
  escalation: string | null = null,
): MerchantInfo => ({ name, domains, kind, supportEmail: null, returnWindowDays: null, howToClaim, escalation, sandbox: false });

const KNOWN: MerchantInfo[] = [
  store(
    "Amazon",
    ["amazon.com", "amazon.com.mx", "amazon.es", "amazon.com.br", "amazon.ca", "amazon.co.uk"],
    "marketplace",
    "En Amazon, abre tus pedidos, elige este pedido y usa la opción de problema con el pedido o de devolución.",
    "Si el vendedor no responde o no lo resuelve, puedes pedir la Garantía de la A a la z desde el mismo pedido.",
  ),
  store(
    "Mercado Libre",
    [
      "mercadolibre.com",
      "mercadolibre.com.mx",
      "mercadolibre.com.ar",
      "mercadolibre.com.co",
      "mercadolibre.cl",
      "mercadolibre.com.pe",
      "mercadolibre.com.uy",
      "mercadolibre.com.ve",
      "mercadolivre.com.br",
    ],
    "marketplace",
    "En Mercado Libre, entra a Mis compras, abre esta compra y elige la opción de ayuda o de devolución.",
    "Si el vendedor no responde, pide que Mercado Libre intervenga en el mismo reclamo.",
  ),
  store(
    "AliExpress",
    ["aliexpress.com", "aliexpress.us"],
    "marketplace",
    "En AliExpress, abre tus pedidos, elige este pedido y abre una disputa.",
    "Si la disputa no avanza, AliExpress puede intervenir desde el mismo pedido.",
  ),
  store("eBay", ["ebay.com", "ebay.es"], "marketplace", "En eBay, abre tus compras, elige este pedido y usa la opción de devolución o de artículo no recibido."),
  store("Shein", ["shein.com"], "store", "En Shein, abre tus pedidos, elige este pedido y pide la devolución o escribe a atención al cliente."),
  store("Temu", ["temu.com"], "store", "En Temu, abre tus pedidos, elige este pedido y pide la devolución o el reembolso."),
  store("Walmart", ["walmart.com", "walmart.com.mx"], "store", "En Walmart, abre tus pedidos, elige este pedido e inicia la devolución."),
  // Paqueterías: sus correos dicen dónde va un pedido, pero el reclamo va a la tienda.
  store("DHL", ["dhl.com"], "carrier", null),
  store("FedEx", ["fedex.com"], "carrier", null),
  store("UPS", ["ups.com"], "carrier", null),
  store("Estafeta", ["estafeta.com"], "carrier", null),
  store("Servientrega", ["servientrega.com"], "carrier", null),
  store("Coordinadora", ["coordinadora.com"], "carrier", null),
  store("Correos", ["correos.es"], "carrier", null),
  store("Andreani", ["andreani.com"], "carrier", null),
  store("Chilexpress", ["chilexpress.cl"], "carrier", null),
  store("99minutos", ["99minutos.com"], "carrier", null),
];

const ALL = [...SANDBOX, ...KNOWN];

/** Dominios de segundo nivel por país ("com.mx", "co.uk"): el dominio registrable lleva una etiqueta más. */
const SECOND_LEVEL = new Set(["com", "co", "org", "net", "gob", "gov", "edu", "ac"]);

/** "notificaciones@envios.sonidomax.test" → "sonidomax.test"; "pedidos@amazon.com.mx" → "amazon.com.mx". */
export function domainOf(email: string | null | undefined): string | null {
  if (!email) return null;
  const host = email.trim().toLowerCase().split("@").pop() ?? "";
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(host)) return null;
  const labels = host.split(".");
  if (labels.length <= 2) return host;
  const tld = labels[labels.length - 1];
  const second = labels[labels.length - 2];
  const keep = tld.length === 2 && SECOND_LEVEL.has(second) ? 3 : 2;
  return labels.slice(-keep).join(".");
}

export function findMerchantByDomain(domain: string | null | undefined): MerchantInfo | null {
  if (!domain) return null;
  const d = domain.toLowerCase();
  return ALL.find((m) => m.domains.some((known) => d === known || d.endsWith(`.${known}`))) ?? null;
}

/** Texto sin tildes ni signos, en minúsculas: "CasaNova Hogar" → "casanova hogar". */
export function foldName(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function findMerchantByName(name: string | null | undefined): MerchantInfo | null {
  if (!name) return null;
  const folded = foldName(name);
  if (!folded) return null;
  return ALL.find((m) => foldName(m.name) === folded) ?? null;
}

export function isSandboxDomain(domain: string | null | undefined): boolean {
  return Boolean(domain && /\.test$/i.test(domain));
}

/** Si pagaste con tarjeta y nadie responde: la disputa con el banco, sin prometer el resultado. */
export const CARD_DISPUTE_STEP =
  "Si pagaste con tarjeta y la tienda no lo resuelve, tu banco puede abrir una disputa (contracargo) por un pedido no recibido o distinto al que compraste. Omni te deja el resumen del caso para pedirla.";
