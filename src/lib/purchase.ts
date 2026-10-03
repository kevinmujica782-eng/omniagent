// Comprar Omni Pro desde la app. Un solo punto para las dos pasarelas:
// - Web: Stripe Checkout. El servidor crea la sesión y la persona paga en la página de Stripe (Omni nunca ve la
//   tarjeta). Al volver, /cuenta sincroniza la suscripción y el webhook hace lo mismo.
// - App de Android: Google Play Billing con RevenueCat, como exige la política de pagos de Google Play (dentro de la
//   app no se ofrece otro medio). El webhook de RevenueCat activa Pro en el servidor.
//
// Para activar Google Play: `npm i @revenuecat/purchases-capacitor`, `npx cap sync android` y la llave pública del
// SDK en NEXT_PUBLIC_REVENUECAT_ANDROID_KEY. Sin eso, la app nativa explica que el pago llega en otra versión.
import { registerPlugin } from "@capacitor/core";
import { apiFetch } from "@/lib/api-client";
import { isNativeApp } from "@/lib/native";

export type PurchaseChannel = "stripe" | "google_play";

export type PurchaseResult =
  /** Stripe Checkout: hay que abrir esta URL. */
  | { status: "redirect"; url: string }
  /** Google Play cobró; el servidor activa Pro cuando llega el aviso de RevenueCat. */
  | { status: "purchased" }
  /** La persona cerró la hoja de pago de Google Play. */
  | { status: "cancelled" }
  /** Esta instalación no puede cobrar (falta el plugin o la llave). */
  | { status: "unavailable"; message: string };

/** Un problema de la pasarela con un mensaje que sí se le puede mostrar a la persona. */
export class PurchaseError extends Error {}

export function purchaseChannel(): PurchaseChannel {
  return isNativeApp() ? "google_play" : "stripe";
}

// ─── RevenueCat (plugin nativo "Purchases" de @revenuecat/purchases-capacitor) ───

interface RcPackage {
  identifier: string;
  product: { priceString: string };
}
interface RcOffering {
  monthly?: RcPackage | null;
  availablePackages: RcPackage[];
}
interface PurchasesPlugin {
  configure(options: { apiKey: string; appUserID?: string | null }): Promise<void>;
  getOfferings(): Promise<{ current: RcOffering | null }>;
  purchasePackage(options: { aPackage: RcPackage }): Promise<unknown>;
}

const PLAY_NOT_READY = "En la app de Android, Pro se compra con Google Play. Esta versión todavía no tiene el pago activado.";

let plugin: PurchasesPlugin | null = null;
let configured: Promise<void> | null = null;

/** RevenueCat configurado con el id de la persona (así el webhook sabe a quién activar Pro), o null si no se puede. */
async function revenueCat(userId: string | null): Promise<PurchasesPlugin | null> {
  const apiKey = process.env.NEXT_PUBLIC_REVENUECAT_ANDROID_KEY;
  if (!apiKey || !userId) return null;
  plugin ??= registerPlugin<PurchasesPlugin>("Purchases");
  configured ??= plugin.configure({ apiKey, appUserID: userId });
  try {
    await configured;
    return plugin;
  } catch {
    // Sin el plugin nativo (UNIMPLEMENTED) o sin conexión con Google Play: se reintenta la próxima vez.
    configured = null;
    return null;
  }
}

async function monthlyPackage(rc: PurchasesPlugin): Promise<RcPackage | null> {
  const { current } = await rc.getOfferings();
  return current?.monthly ?? current?.availablePackages[0] ?? null;
}

function wasCancelled(error: unknown): boolean {
  const e = error as { userCancelled?: boolean | null; code?: string | number; message?: string } | null;
  return Boolean(e && (e.userCancelled === true || String(e.code) === "1" || /cancel/i.test(e.message ?? "")));
}

/** El precio que cobra Google Play en la moneda de la persona ("US$19.99", "$ 79.900"), o null en la web. */
export async function storePrice(userId: string | null): Promise<string | null> {
  if (purchaseChannel() !== "google_play") return null;
  try {
    const rc = await revenueCat(userId);
    return rc ? ((await monthlyPackage(rc))?.product.priceString ?? null) : null;
  } catch {
    return null;
  }
}

/** Empieza la compra de Pro con la pasarela que corresponde. */
export async function purchasePro(userId: string | null): Promise<PurchaseResult> {
  if (purchaseChannel() === "stripe") {
    const { url } = await apiFetch<{ url: string }>("/api/v1/billing/checkout", { method: "POST" });
    return { status: "redirect", url };
  }
  const rc = await revenueCat(userId);
  if (!rc) return { status: "unavailable", message: PLAY_NOT_READY };
  const monthly = await monthlyPackage(rc).catch(() => null);
  if (!monthly) return { status: "unavailable", message: "Google Play no tiene el plan Pro disponible ahora. Prueba de nuevo en un rato." };
  try {
    await rc.purchasePackage({ aPackage: monthly });
    return { status: "purchased" };
  } catch (error) {
    if (wasCancelled(error)) return { status: "cancelled" };
    throw new PurchaseError("Google Play no pudo completar la compra. Revisa tu forma de pago en Google Play e inténtalo de nuevo.");
  }
}

/** Después de pagar en Google Play: espera a que el servidor active Pro (llega por el webhook en segundos). */
export async function waitForPro({ tries = 8, everyMs = 1500 }: { tries?: number; everyMs?: number } = {}): Promise<boolean> {
  for (let attempt = 0; attempt < tries; attempt++) {
    const billing = await apiFetch<{ plan: "FREE" | "PRO" }>("/api/v1/billing").catch(() => null);
    if (billing?.plan === "PRO") return true;
    await new Promise((resolve) => setTimeout(resolve, everyMs));
  }
  return false;
}
