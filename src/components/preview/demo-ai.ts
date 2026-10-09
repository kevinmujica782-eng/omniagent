// Modelos de IA de ejemplo (Cuenta → Modelo de IA y la pantalla chat-modelos de la vista previa). Sin API.
import { DEFAULT_MODELS } from "@/modules/ai/ai.catalog";
import { AI_PROVIDER_IDS, AI_PROVIDER_LABEL, type AIModelsView, type AIProviderId } from "@/types/ai";
import type { ChatMessageView } from "@/types/cards";

const DEMO_ORDER: AIProviderId[] = ["anthropic", "openai", "gemini", "xai"];

/** Claude, ChatGPT y Gemini configurados; Grok todavía no. */
export function demoAIModels(plan: "FREE" | "PRO", preference: AIProviderId | null = null): AIModelsView {
  const configured: Record<AIProviderId, boolean> = { anthropic: true, openai: true, gemini: true, xai: false };
  return {
    plan,
    preference,
    order: DEMO_ORDER,
    limits: plan === "PRO" ? { maxOutputTokens: 4_096, maxImages: 4, tiers: ["fast", "smart"] } : { maxOutputTokens: 1_024, maxImages: 2, tiers: ["fast"] },
    providers: AI_PROVIDER_IDS.map((id) => ({
      id,
      company: AI_PROVIDER_LABEL[id].company,
      assistant: AI_PROVIDER_LABEL[id].assistant,
      configured: configured[id],
      available: configured[id],
      models: [
        { tier: "fast" as const, model: DEFAULT_MODELS[id].fast, allowed: true },
        { tier: "smart" as const, model: DEFAULT_MODELS[id].smart, allowed: plan === "PRO" },
      ],
      capabilities: { images: true, pdf: id !== "xai", tools: true, json: true },
    })),
  };
}

/** Laura eligió ChatGPT en Cuenta: responde ChatGPT y, cuando no está disponible, contesta Gemini. */
export function demoModelConversation(): ChatMessageView[] {
  const createdAt = new Date().toISOString();
  const user = (id: string, text: string): ChatMessageView => ({ id, role: "user", text, cards: [], createdAt });
  return [
    user("demo-ai-1", "¿Cuánto llevo gastado en Restaurantes este mes?"),
    {
      id: "demo-ai-2",
      role: "assistant",
      text: "Llevas **$486** en Restaurantes este mes, $134 más que tu promedio. Casi la mitad fueron 4 pedidos a domicilio de fin de semana.",
      cards: [],
      ai: { provider: "openai", model: DEFAULT_MODELS.openai.smart, fallbackFrom: null },
      createdAt,
    },
    user("demo-ai-3", "¿Y en el súper?"),
    {
      id: "demo-ai-4",
      role: "assistant",
      text: "En el súper llevas **$612**, casi igual que tu promedio ($598). Ahí no hay nada raro.",
      cards: [],
      ai: { provider: "gemini", model: DEFAULT_MODELS.gemini.smart, fallbackFrom: "openai" },
      createdAt,
    },
  ];
}
