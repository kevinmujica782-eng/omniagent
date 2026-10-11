import { describe, expect, it } from "vitest";
import {
  assistantCreateSchema,
  assistantUpdateSchema,
  DOT_LIMITS,
  toDotModules,
} from "@/modules/assistants/assistants.types";
import type { AgentModule } from "@/generated/prisma/enums";

// Dots: validación de lo que entra por la API antes de tocar la base.

describe("assistantCreateSchema", () => {
  it("acepta lo mínimo y rellena los opcionales", () => {
    const parsed = assistantCreateSchema.parse({ name: "  Ahorrista  ", role: "Me cuida el bolsillo" });
    expect(parsed.name).toBe("Ahorrista"); // recorta espacios
    expect(parsed.personality).toBe("");
    expect(parsed.instructions).toBe("");
    expect(parsed.modules).toEqual([]);
    expect(parsed.isDefault).toBe(false);
  });

  it("rechaza un nombre vacío o de solo espacios", () => {
    expect(assistantCreateSchema.safeParse({ name: "   ", role: "x" }).success).toBe(false);
    expect(assistantCreateSchema.safeParse({ name: "", role: "x" }).success).toBe(false);
  });

  it("rechaza un rol vacío", () => {
    expect(assistantCreateSchema.safeParse({ name: "Dot", role: "" }).success).toBe(false);
  });

  it("rechaza textos más largos que el límite", () => {
    const long = "a".repeat(DOT_LIMITS.name + 1);
    expect(assistantCreateSchema.safeParse({ name: long, role: "x" }).success).toBe(false);
    const longInstr = "b".repeat(DOT_LIMITS.instructions + 1);
    expect(assistantCreateSchema.safeParse({ name: "Dot", role: "x", instructions: longInstr }).success).toBe(false);
  });

  it("rechaza áreas desconocidas y acepta las válidas", () => {
    expect(assistantCreateSchema.safeParse({ name: "Dot", role: "x", modules: ["BANANA"] }).success).toBe(false);
    const ok = assistantCreateSchema.parse({ name: "Dot", role: "x", modules: ["FINANCE", "GOALS"] });
    expect(ok.modules).toEqual(["FINANCE", "GOALS"]);
  });
});

describe("assistantUpdateSchema", () => {
  it("exige al menos un campo", () => {
    expect(assistantUpdateSchema.safeParse({}).success).toBe(false);
  });

  it("acepta un cambio parcial", () => {
    expect(assistantUpdateSchema.safeParse({ personality: "Más directo" }).success).toBe(true);
    expect(assistantUpdateSchema.safeParse({ archived: true }).success).toBe(true);
  });

  it("solo deja marcar por defecto, nunca desmarcar suelto", () => {
    expect(assistantUpdateSchema.safeParse({ isDefault: true }).success).toBe(true);
    expect(assistantUpdateSchema.safeParse({ isDefault: false }).success).toBe(false);
  });
});

describe("toDotModules", () => {
  it("descarta los valores que la pantalla no ofrece (como GENERAL)", () => {
    const modules = ["GENERAL", "FINANCE", "CONCIERGE"] as AgentModule[];
    expect(toDotModules(modules)).toEqual(["FINANCE", "CONCIERGE"]);
  });
});
