// Conocimiento base: lo que la persona le escribe a Omni para que lo tenga siempre presente, por categoría.
// A diferencia de agent_memories (lo que Omni deduce en el chat), esto lo escribe la persona a propósito.
// Puro (solo zod y tipos): lo usan el servidor, la API, la pantalla y la vista previa.
import { z } from "zod";

export const KNOWLEDGE_CATEGORIES = ["GOALS", "RULES", "FINANCES", "PROFILE", "PREFERENCES"] as const;
export type KnowledgeCategory = (typeof KNOWLEDGE_CATEGORIES)[number];

export const KNOWLEDGE_LABEL: Record<KnowledgeCategory, string> = {
  GOALS: "Metas",
  RULES: "Reglas",
  FINANCES: "Finanzas",
  PROFILE: "Sobre mí",
  PREFERENCES: "Preferencias",
};

/** Una línea de ayuda por categoría, para que la persona sepa qué escribir. */
export const KNOWLEDGE_HINT: Record<KnowledgeCategory, string> = {
  GOALS: "Qué quieres lograr y para cuándo.",
  RULES: "Lo que Omni siempre debe o nunca debe hacer.",
  FINANCES: "Ingresos, deudas o compromisos que tu banco no muestra.",
  PROFILE: "Quién eres: trabajo, familia, ciudad.",
  PREFERENCES: "Tus gustos: marcas, horarios, formas de pago.",
};

export const KNOWLEDGE_LIMITS = { item: 200, itemsPerCategory: 20 } as const;

export const categorySchema = z.enum(KNOWLEDGE_CATEGORIES);

const item = z.string().trim().min(1).max(KNOWLEDGE_LIMITS.item);

/** Lo que se guarda en content: una lista de líneas cortas. */
export const knowledgeContentSchema = z.object({
  items: z.array(item).max(KNOWLEDGE_LIMITS.itemsPerCategory).default([]),
});
export type KnowledgeContent = z.output<typeof knowledgeContentSchema>;

/** Cuerpo del PUT: la lista completa de líneas de una categoría (reemplaza lo anterior). */
export const knowledgeUpdateSchema = z.object({
  items: z.array(item).max(KNOWLEDGE_LIMITS.itemsPerCategory),
});
export type KnowledgeUpdateInput = z.output<typeof knowledgeUpdateSchema>;

/** Lo que ve la pantalla: todas las categorías, con sus líneas (vacías si no hay nada). */
export type KnowledgeView = {
  category: KnowledgeCategory;
  label: string;
  hint: string;
  items: string[];
  version: number;
};

/** Lee content (JSON libre) como la lista de líneas, descartando lo que no encaje. */
export function itemsOf(content: unknown): string[] {
  const parsed = knowledgeContentSchema.safeParse(content);
  return parsed.success ? parsed.data.items : [];
}
