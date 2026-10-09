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

/** Quién responde en automático: el primero del orden que está configurado. */
export function autoProviderOf(view: AIModelsView): AIProviderId | null {
  const configured = new Set(view.providers.filter((provider) => provider.configured).map((provider) => provider.id));
  return view.order.find((id) => configured.has(id)) ?? null;
}
