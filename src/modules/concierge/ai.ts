import "server-only";
import { aiConfigured as routerConfigured, generateStructured } from "@/modules/ai/ai.service";
import { ALERT_SYSTEM_PROMPT, ALERT_TOOL_NAME, alertSchema, buildAlertPrompt, validateAlertText } from "./rules/alert-ai";
import type { AlertFacts, AlertText } from "./rules/alert-copy";
import type { PageFacts, PageOffer } from "./scraper/extract";
import { buildPagePrompt, PAGE_SYSTEM_PROMPT, PAGE_TOOL_NAME, pageReadSchema, validatePageRead } from "./scraper/page-ai";

// La IA en el módulo de compras, siempre con salida estructurada y validación posterior, por el router de IA (Claude
// primero y otro proveedor si falla): 1) leer el precio de una página sin datos de producto, 2) redactar la alerta de
// una bajada. Son tareas cortas y automáticas: usan el modelo rápido, razonan poco y no gastan la cuota del chat.

export function aiConfigured(): boolean {
  return routerConfigured();
}

/** Precio leído por la IA del texto de la página. null si no lo encontró o si su respuesta no pasa la validación. */
export async function readPageWithAI(input: {
  userId: string;
  url: string;
  text: string;
  facts: PageFacts;
  fallbackCurrency: string | null;
}): Promise<PageOffer | null> {
  if (!aiConfigured() || input.text.length < 20) return null;
  try {
    const result = await generateStructured({
      schema: pageReadSchema,
      name: PAGE_TOOL_NAME,
      system: PAGE_SYSTEM_PROMPT,
      prompt: buildPagePrompt(input.url, input.text, input.facts),
      tier: "fast",
      maxOutputTokens: 600,
      reasoning: "low",
      usage: { userId: input.userId, module: "CONCIERGE", kind: "page_read" },
    });
    return validatePageRead(result.value, { text: input.text, url: input.url, facts: input.facts, fallbackCurrency: input.fallbackCurrency });
  } catch (error) {
    console.error("[concierge] no se pudo leer la página con IA", error);
    return null;
  }
}

/** Titular y resumen de la alerta escritos por la IA; null si falla o si alguna cifra no cuadra con los datos. */
export async function writeAlertWithAI(userId: string, facts: AlertFacts): Promise<AlertText | null> {
  if (!aiConfigured()) return null;
  try {
    const result = await generateStructured({
      schema: alertSchema,
      name: ALERT_TOOL_NAME,
      system: ALERT_SYSTEM_PROMPT,
      prompt: buildAlertPrompt(facts),
      tier: "fast",
      maxOutputTokens: 500,
      reasoning: "low",
      usage: { userId, module: "CONCIERGE", kind: "price_alert" },
    });
    return validateAlertText(result.value, facts);
  } catch (error) {
    console.error("[concierge] no se pudo redactar la alerta con IA", error);
    return null;
  }
}
