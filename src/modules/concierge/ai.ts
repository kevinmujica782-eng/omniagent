import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { anthropic } from "@/modules/agent/anthropic";
import { ALERT_SYSTEM_PROMPT, ALERT_TOOL_NAME, alertSchema, buildAlertPrompt, validateAlertText } from "./rules/alert-ai";
import type { AlertFacts, AlertText } from "./rules/alert-copy";
import type { PageFacts, PageOffer } from "./scraper/extract";
import { buildPagePrompt, PAGE_SYSTEM_PROMPT, PAGE_TOOL_NAME, pageReadSchema, validatePageRead } from "./scraper/page-ai";

// Claude en el módulo de compras, siempre con salida estructurada (tool use forzado) y validación posterior:
// 1) leer el precio de una página sin datos de producto, 2) redactar la alerta de una bajada.
// Son tareas cortas y automáticas: usan el modelo rápido y no gastan la cuota del chat.

function toolFor(name: string, description: string, schema: z.ZodType): Anthropic.Tool {
  const json = z.toJSONSchema(schema, { io: "input" }) as Record<string, unknown>;
  delete json.$schema;
  return { name, description, input_schema: json as unknown as Anthropic.Tool["input_schema"] };
}

export function aiConfigured(): boolean {
  return Boolean(env().ANTHROPIC_API_KEY);
}

/** Precio leído por Claude del texto de la página. null si no lo encontró o si su respuesta no pasa la validación. */
export async function readPageWithClaude(input: {
  userId: string;
  url: string;
  text: string;
  facts: PageFacts;
  fallbackCurrency: string | null;
}): Promise<PageOffer | null> {
  if (!aiConfigured() || input.text.length < 20) return null;
  const model = env().ANTHROPIC_MODEL_FREE;
  try {
    const tool = toolFor(PAGE_TOOL_NAME, "Registra el precio del artículo principal de la página.", pageReadSchema);
    const response = await anthropic().messages.create({
      model,
      max_tokens: 600,
      system: PAGE_SYSTEM_PROMPT,
      tools: [tool],
      tool_choice: { type: "tool", name: PAGE_TOOL_NAME },
      messages: [{ role: "user", content: buildPagePrompt(input.url, input.text, input.facts) }],
    });
    await prisma.aiUsageLog.create({
      data: {
        userId: input.userId,
        module: "CONCIERGE",
        kind: "page_read",
        model,
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
    });
    const block = response.content.find((b) => b.type === "tool_use");
    if (!block || block.type !== "tool_use") return null;
    const parsed = pageReadSchema.safeParse(block.input);
    if (!parsed.success) return null;
    return validatePageRead(parsed.data, { text: input.text, url: input.url, facts: input.facts, fallbackCurrency: input.fallbackCurrency });
  } catch (error) {
    console.error("[concierge] no se pudo leer la página con IA", error);
    return null;
  }
}

/** Titular y resumen de la alerta escritos por Claude; null si falla o si alguna cifra no cuadra con los datos. */
export async function writeAlertWithClaude(userId: string, facts: AlertFacts): Promise<AlertText | null> {
  if (!aiConfigured()) return null;
  const model = env().ANTHROPIC_MODEL_FREE;
  try {
    const tool = toolFor(ALERT_TOOL_NAME, "Registra el aviso de bajada de precio.", alertSchema);
    const response = await anthropic().messages.create({
      model,
      max_tokens: 500,
      system: ALERT_SYSTEM_PROMPT,
      tools: [tool],
      tool_choice: { type: "tool", name: ALERT_TOOL_NAME },
      messages: [{ role: "user", content: buildAlertPrompt(facts) }],
    });
    await prisma.aiUsageLog.create({
      data: {
        userId,
        module: "CONCIERGE",
        kind: "price_alert",
        model,
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
    });
    const block = response.content.find((b) => b.type === "tool_use");
    if (!block || block.type !== "tool_use") return null;
    const parsed = alertSchema.safeParse(block.input);
    if (!parsed.success) return null;
    return validateAlertText(parsed.data, facts);
  } catch (error) {
    console.error("[concierge] no se pudo redactar la alerta con IA", error);
    return null;
  }
}
