// Sin "server-only": lo usan la página de metas y el agente.
export type GoalCategoryId = "SAVINGS" | "HEALTH" | "FAMILY" | "HOME" | "TRAVEL" | "CAREER" | "OTHER";

export const GOAL_CATEGORY_LABEL: Record<GoalCategoryId, string> = {
  SAVINGS: "Ahorro",
  HEALTH: "Salud",
  FAMILY: "Familia",
  HOME: "Hogar",
  TRAVEL: "Viajes",
  CAREER: "Trabajo y estudios",
  OTHER: "Otra",
};

/** Atajos de "Crear una meta": abren el chat con una instrucción inicial. */
export const GOAL_STARTERS: { category: GoalCategoryId; prompt: string }[] = [
  { category: "SAVINGS", prompt: "Quiero crear una meta de ahorro. Pregúntame lo necesario y propón cuánto apartar al mes." },
  { category: "TRAVEL", prompt: "Quiero ahorrar para un viaje. Ayúdame a armar el plan." },
  { category: "HOME", prompt: "Quiero crear una meta para mi casa." },
  { category: "HEALTH", prompt: "Quiero crear una meta de salud con pasos concretos." },
  { category: "FAMILY", prompt: "Quiero crear una meta familiar." },
];
