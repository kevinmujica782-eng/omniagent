import "server-only";
import { getEntitlements, monthlyPageReads } from "@/modules/billing/entitlements";
import { PLANS } from "@/modules/billing/plans";
import { aiConfigured, readPageWithAI } from "./ai";
import type { SandboxFlashSale } from "./sandbox/stores";
import { extractOffer, pageText, type PageFacts, type PageOffer } from "./scraper/extract";
import { fetchPage, type FetchFailure, type FetchOptions } from "./scraper/fetcher";

// Lectura del precio de un enlace: visitar la página (o la tienda de prueba), buscar la oferta en sus datos
// estructurados y, solo si hace falta y el usuario lo pidió o el producto ya se leía así, pedirle a Claude
// que lea el texto (con el cupo del plan y validación estricta).

export type ReadFailureCode = FetchFailure | "no_price" | "ai_quota";

export type PriceReading = {
  offer: PageOffer & { currency: string };
  url: string;
  source: "sandbox" | "web";
  facts: PageFacts;
  aiUsed: boolean;
};

export type ReadOutcome =
  | { ok: true; reading: PriceReading }
  | {
      ok: false;
      code: ReadFailureCode;
      message: string;
      source: "sandbox" | "web";
      /** La página se leyó pero no publica el precio en datos: la IA podría intentarlo. */
      canReadWithAI: boolean;
      /** No tiene sentido reintentar pronto (robots.txt, red privada, no es HTML...). */
      permanent: boolean;
      facts: PageFacts | null;
    };

const PERMANENT: ReadFailureCode[] = ["invalid_url", "blocked_address", "robots", "not_html", "disabled"];

export async function readPrice(
  rawUrl: string,
  ctx: {
    userId: string;
    now?: Date;
    flash?: SandboxFlashSale | null;
    /** never: solo datos estructurados. if_needed: si no los hay, lectura con IA (cuenta en el cupo del plan). */
    ai: "never" | "if_needed";
    fallbackCurrency: string | null;
    fetchOptions?: Partial<FetchOptions>;
  },
): Promise<ReadOutcome> {
  const page = await fetchPage(rawUrl, { now: ctx.now, flash: ctx.flash ?? null, ...ctx.fetchOptions });
  if (!page.ok) {
    return {
      ok: false,
      code: page.code,
      message: page.message,
      source: page.sandbox ? "sandbox" : "web",
      canReadWithAI: false,
      permanent: PERMANENT.includes(page.code),
      facts: null,
    };
  }
  const source = page.sandbox ? "sandbox" : "web";
  const { offer, facts } = extractOffer(page.html, page.url);
  if (offer) {
    const currency = offer.currency ?? facts.currencyHint ?? ctx.fallbackCurrency;
    if (currency) return { ok: true, reading: { offer: { ...offer, currency }, url: page.url, source, facts, aiUsed: false } };
  }

  const text = pageText(page.html);
  const aiPossible = aiConfigured() && text.length >= 40;
  if (ctx.ai === "if_needed" && aiPossible) {
    const entitlements = await getEntitlements(ctx.userId);
    const used = await monthlyPageReads(ctx.userId, ctx.now);
    if (used >= entitlements.limits.monthlyPageReads) {
      return {
        ok: false,
        code: "ai_quota",
        message:
          entitlements.plan === "FREE"
            ? `Usaste tus ${entitlements.limits.monthlyPageReads} lecturas con IA de este mes. Con Pro tienes ${PLANS.PRO.monthlyPageReads}.`
            : "Usaste las lecturas con IA de este mes; se renuevan el día 1.",
        source,
        canReadWithAI: false,
        permanent: false,
        facts,
      };
    }
    const read = await readPageWithAI({ userId: ctx.userId, url: page.url, text, facts, fallbackCurrency: ctx.fallbackCurrency });
    if (read && read.currency) {
      return { ok: true, reading: { offer: { ...read, currency: read.currency }, url: page.url, source, facts, aiUsed: true } };
    }
    return {
      ok: false,
      code: "no_price",
      message: "Leí la página con IA y no encontré un precio claro del artículo.",
      source,
      canReadWithAI: false,
      permanent: false,
      facts,
    };
  }
  return {
    ok: false,
    code: "no_price",
    message: aiPossible
      ? "La página no publica el precio en sus datos de producto. Puedo leerla con IA."
      : "La página no publica el precio en sus datos de producto.",
    source,
    canReadWithAI: aiPossible,
    permanent: false,
    facts,
  };
}
