// Datos del seguimiento que viven en watchlist_items.metadata (JSON), con lectura tolerante a versiones viejas.
import type { PriceMethodId } from "@/types/cards";
import type { SandboxFlashSale } from "./sandbox/stores";

export type ItemMeta = {
  method: PriceMethodId | null;
  host: string | null;
  detail: string | null;
  eventDate: string | null;
  stockCount: number | null;
  /** Unidades que el usuario quiere comprar (boletos, noches...). */
  quantity: number;
  shipping: number | null;
  multipleOffers: boolean;
  /** Última alerta enviada (para no repetir la misma bajada). */
  lastAlert: { price: number; at: string; alertId: string } | null;
  /** Oferta relámpago de prueba ("Probar una bajada"), solo en tiendas .test. */
  flash: SandboxFlashSale | null;
  /** La tienda prohíbe revisiones automáticas (robots.txt). */
  blocked: boolean;
  /** Lo pausó el cambio al plan Gratis (se reanuda solo si vuelve a Pro). */
  pausedByPlan: boolean;
};

const METHODS: PriceMethodId[] = ["jsonld", "microdata", "meta", "ai", "manual"];

export function readItemMeta(value: unknown): ItemMeta {
  const raw = (value && typeof value === "object" && !Array.isArray(value) ? value : {}) as Record<string, unknown>;
  const str = (k: string) => (typeof raw[k] === "string" ? (raw[k] as string) : null);
  const num = (k: string) => (typeof raw[k] === "number" && Number.isFinite(raw[k]) ? (raw[k] as number) : null);
  const lastAlert = raw.lastAlert as ItemMeta["lastAlert"] | undefined;
  const flash = raw.flash as SandboxFlashSale | undefined;
  return {
    method: METHODS.includes(raw.method as PriceMethodId) ? (raw.method as PriceMethodId) : null,
    host: str("host"),
    detail: str("detail"),
    eventDate: str("eventDate"),
    stockCount: num("stockCount"),
    quantity: Math.max(1, Math.min(10, Math.floor(num("quantity") ?? 1))),
    shipping: num("shipping"),
    multipleOffers: raw.multipleOffers === true,
    lastAlert:
      lastAlert && typeof lastAlert.price === "number" && typeof lastAlert.at === "string" && typeof lastAlert.alertId === "string"
        ? lastAlert
        : null,
    flash: flash && typeof flash.pct === "number" && typeof flash.until === "string" ? flash : null,
    blocked: raw.blocked === true,
    pausedByPlan: raw.pausedByPlan === true,
  };
}

export function hostOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}
