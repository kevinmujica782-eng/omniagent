// Textos del router de IA para la interfaz (chat y Cuenta). Sin dependencias de servidor.
import { AI_PROVIDER_LABEL, type AIModelsView, type AIProviderId, type AIProviderOption } from "@/types/ai";
import type { AnsweredBy } from "@/types/cards";

/** El proveedor de siempre: con él no se marca quién respondió. */
const USUAL_PROVIDER: AIProviderId = "anthropic";

/** Bajo una respuesta del chat: quién respondió, solo si no es el modelo de siempre o si hubo respaldo. */
export function answeredByLine(ai: AnsweredBy | undefined): string | null {
  if (!ai) return null;
  const who = AI_PROVIDER_LABEL[ai.provider].assistant;
  if (ai.fallbackFrom && ai.fallbackFrom !== ai.provider) {
    return `Respondió ${who} porque ${AI_PROVIDER_LABEL[ai.fallbackFrom].assistant} no estaba disponible`;
  }
  return ai.provider === USUAL_PROVIDER ? null : `Respondió ${who}`;
}

/** El modelo que le toca a la persona en ese proveedor: el más capaz si su plan lo permite, si no el rápido. */
export function planModelOf(provider: AIProviderOption): string | null {
  const allowed = provider.models.filter((model) => model.allowed);
  return (allowed.find((model) => model.tier === "smart") ?? allowed.find((model) => model.tier === "fast"))?.model ?? null;
}

const capitalize = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);

/**
 * El nombre del modelo como lo escribe cada proveedor: «claude-haiku-4-5-20251001» → «Claude Haiku 4.5»,
 * «gpt-6.1-sol» → «GPT-6.1 Sol», «gemini-3.5-flash-lite» → «Gemini 3.5 Flash-Lite», «grok-4.7» → «Grok 4.7». Los
 * modelos se configuran por variables: uno con otra forma se muestra tal cual.
 */
export function modelLabel(id: string): string {
  const claude = /^claude-([a-z]+)-(\d+)-(\d+)(?:-\d{8})?$/.exec(id);
  if (claude) return `Claude ${capitalize(claude[1])} ${claude[2]}.${claude[3]}`;
  const gpt = /^gpt-(\d+(?:\.\d+)?)(?:-([a-z]+))?$/.exec(id);
  if (gpt) return `GPT-${gpt[1]}${gpt[2] ? ` ${capitalize(gpt[2])}` : ""}`;
  const gemini = /^gemini-(\d+(?:\.\d+)?)-([a-z]+(?:-[a-z]+)*)$/.exec(id);
  if (gemini) return `Gemini ${gemini[1]} ${gemini[2].split("-").map(capitalize).join("-")}`;
  const grok = /^grok-(\d+(?:\.\d+)?)$/.exec(id);
  if (grok) return `Grok ${grok[1]}`;
  return id;
}

/** Quién responde en automático: el primero del orden que está configurado. */
export function autoProviderOf(view: AIModelsView): AIProviderId | null {
  const configured = new Set(view.providers.filter((provider) => provider.configured).map((provider) => provider.id));
  return view.order.find((id) => configured.has(id)) ?? null;
}
