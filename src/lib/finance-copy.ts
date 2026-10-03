// Textos del módulo financiero compartidos por servidor y UI.
import type { RecommendationKindId } from "@/types/cards";

export const RECOMMENDATION_ACTION: Record<RecommendationKindId, string> = {
  CANCEL_SUBSCRIPTION: "Preparar la baja",
  REDUCE_ANT_EXPENSES: "Crear el tope",
  CATEGORY_BUDGET: "Crear presupuesto",
  AVOID_FEES: "Recordármelo",
  NEGOTIATE_BILL: "Recordármelo",
  SAVINGS_GOAL: "Crear la meta",
  OTHER: "Lo haré",
};

export const DIFFICULTY_LABEL = { EASY: "Esfuerzo bajo", MEDIUM: "Esfuerzo medio", HARD: "Esfuerzo alto" } as const;

export const HEALTH_LABEL = {
  buena: "Salud buena",
  estable: "Salud estable",
  en_riesgo: "Necesita atención",
} as const;

export const ACCOUNT_TYPE_LABEL: Record<string, string> = {
  CHECKING: "Cuenta corriente",
  SAVINGS: "Ahorros",
  CREDIT_CARD: "Tarjeta de crédito",
  WALLET: "Billetera",
  OTHER: "Cuenta",
};

export const INSTITUTION_KIND_LABEL: Record<string, string> = {
  bank: "Banco",
  card: "Tarjeta de crédito",
  wallet: "Billetera digital",
  coop: "Cooperativa",
};

/** "video" → "Video" (etiquetas de tipo de suscripción). */
export function capitalize(text: string | null | undefined): string {
  if (!text) return "";
  return text.charAt(0).toUpperCase() + text.slice(1);
}
