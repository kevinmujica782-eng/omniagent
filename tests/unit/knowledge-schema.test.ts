import { describe, expect, it } from "vitest";
import {
  KNOWLEDGE_CATEGORIES,
  KNOWLEDGE_LIMITS,
  categorySchema,
  itemsOf,
  knowledgeUpdateSchema,
} from "@/modules/knowledge/knowledge.types";

// Conocimiento base: validación de la entrada y lectura tolerante del content guardado.

describe("categorySchema", () => {
  it("acepta las cinco categorías y rechaza otras", () => {
    for (const category of KNOWLEDGE_CATEGORIES) expect(categorySchema.safeParse(category).success).toBe(true);
    expect(categorySchema.safeParse("OTRA").success).toBe(false);
    expect(categorySchema.safeParse("goals").success).toBe(false); // sensible a mayúsculas
  });
});

describe("knowledgeUpdateSchema", () => {
  it("acepta una lista de líneas y recorta espacios", () => {
    const parsed = knowledgeUpdateSchema.parse({ items: ["  cobro el día 30  ", "sin deudas"] });
    expect(parsed.items).toEqual(["cobro el día 30", "sin deudas"]);
  });

  it("acepta una lista vacía (borra la categoría)", () => {
    expect(knowledgeUpdateSchema.parse({ items: [] }).items).toEqual([]);
  });

  it("rechaza líneas vacías y más del máximo", () => {
    expect(knowledgeUpdateSchema.safeParse({ items: [""] }).success).toBe(false);
    const tooMany = Array.from({ length: KNOWLEDGE_LIMITS.itemsPerCategory + 1 }, (_, i) => `l${i}`);
    expect(knowledgeUpdateSchema.safeParse({ items: tooMany }).success).toBe(false);
  });
});

describe("itemsOf", () => {
  it("lee las líneas de un content válido", () => {
    expect(itemsOf({ items: ["a", "b"] })).toEqual(["a", "b"]);
  });

  it("devuelve [] ante content ausente o malformado", () => {
    expect(itemsOf(null)).toEqual([]);
    expect(itemsOf({})).toEqual([]);
    expect(itemsOf("texto")).toEqual([]);
    expect(itemsOf({ items: "no-es-lista" })).toEqual([]);
  });
});
