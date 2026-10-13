import "server-only";
import { prisma } from "@/lib/db";
import {
  KNOWLEDGE_CATEGORIES,
  KNOWLEDGE_HINT,
  KNOWLEDGE_LABEL,
  itemsOf,
  type KnowledgeCategory,
  type KnowledgeView,
} from "./knowledge.types";

// Conocimiento base de cada persona: una fila por categoría en user_knowledge. Solo el servidor la escribe; la
// persona lee lo suyo con RLS. El agente lo usa en cada turno (ver knowledgeForPrompt).

/** Las cinco categorías, con lo que la persona escribió en cada una (vacías si no hay nada). */
export async function listKnowledge(userId: string): Promise<KnowledgeView[]> {
  const rows = await prisma.userKnowledge.findMany({ where: { userId } });
  const byCategory = new Map(rows.map((row) => [row.category as KnowledgeCategory, row]));
  return KNOWLEDGE_CATEGORIES.map((category) => {
    const row = byCategory.get(category);
    return {
      category,
      label: KNOWLEDGE_LABEL[category],
      hint: KNOWLEDGE_HINT[category],
      items: row ? itemsOf(row.content) : [],
      version: row?.version ?? 0,
    };
  });
}

/** Reemplaza las líneas de una categoría. Una lista vacía deja la categoría sin nada (pero conserva la fila). */
export async function setKnowledge(userId: string, category: KnowledgeCategory, items: string[]): Promise<KnowledgeView> {
  const content = { items };
  const row = await prisma.userKnowledge.upsert({
    where: { userId_category: { userId, category } },
    create: { userId, category, content },
    update: { content, version: { increment: 1 } },
  });
  return {
    category,
    label: KNOWLEDGE_LABEL[category],
    hint: KNOWLEDGE_HINT[category],
    items: itemsOf(row.content),
    version: row.version,
  };
}

/**
 * El conocimiento base en texto para el prompt del agente (parte dinámica). Compacto y acotado: ajusta prioridades y
 * da contexto, pero no cambia las reglas de seguridad. Devuelve null si la persona no escribió nada.
 */
export async function knowledgeForPrompt(userId: string, maxChars = 1500): Promise<string | null> {
  const rows = await prisma.userKnowledge.findMany({ where: { userId } });
  const byCategory = new Map(rows.map((row) => [row.category as KnowledgeCategory, itemsOf(row.content)]));
  const blocks: string[] = [];
  for (const category of KNOWLEDGE_CATEGORIES) {
    const items = byCategory.get(category);
    if (items && items.length) blocks.push(`${KNOWLEDGE_LABEL[category]}: ${items.join("; ")}`);
  }
  if (blocks.length === 0) return null;
  let text = blocks.join("\n");
  if (text.length > maxChars) text = `${text.slice(0, maxChars - 1)}…`;
  return text;
}
