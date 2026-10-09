import { describe, expect, it } from "vitest";
import { AIProviderError } from "@/modules/ai/ai.errors";
import {
  cleanSchema,
  isStrictCompatible,
  objectRoot,
  parseJsonText,
  toAnthropicOutputSchema,
  toGeminiSchema,
  unwrapJson,
} from "@/modules/ai/ai.schema";

// Router de IA: el mismo JSON Schema (el que genera zod) adaptado a lo que acepta cada proveedor.

/** Como lo genera z.toJSONSchema(..., { io: "input" }) para una salida estructurada de la app. */
const zodLike = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  properties: {
    titular: { type: "string", minLength: 5, maxLength: 90, description: "Una frase" },
    monto: { anyOf: [{ type: "number", minimum: 0 }, { type: "null" }] },
    importancia: { type: "integer", minimum: -9007199254740991, maximum: 9007199254740991 },
    veredicto: { type: "string", enum: ["comprar", "esperar"] },
    puntos: { type: "array", items: { type: "string", maxLength: 200 }, minItems: 2, maxItems: 5 },
    correo: { type: "string", format: "email", pattern: "^(?!\\.)[^@]+@[^@]+$" },
    nota: { type: "string", default: "" },
  },
  required: ["titular", "monto", "importancia", "veredicto", "puntos", "correo"],
};

/** Una unión discriminada (las secciones de una página web). */
const sections = {
  type: "object",
  properties: {
    secciones: {
      type: "array",
      items: {
        anyOf: [
          { type: "object", properties: { kind: { type: "string", const: "faq" }, title: { type: "string" } }, required: ["kind", "title"] },
          { type: "object", properties: { kind: { type: "string", const: "about" }, text: { type: "string" } }, required: ["kind", "text"] },
        ],
      },
    },
  },
  required: ["secciones"],
};

describe("router de IA: esquemas para cada proveedor", () => {
  it("quita $schema y resuelve las referencias locales", () => {
    const schema = cleanSchema({
      $schema: "x",
      type: "object",
      properties: { a: { $ref: "#/$defs/Texto" }, b: { type: "array", items: { $ref: "#/$defs/Texto" } } },
      $defs: { Texto: { type: "string", maxLength: 10 } },
    });
    expect(schema).toEqual({
      type: "object",
      properties: { a: { type: "string", maxLength: 10 }, b: { type: "array", items: { type: "string", maxLength: 10 } } },
    });
  });

  it("corta las referencias recursivas y rechaza un esquema que crece sin fin", () => {
    const tree = {
      $defs: { Nodo: { type: "object", properties: { nombre: { type: "string" }, hijos: { type: "array", items: { $ref: "#/$defs/Nodo" } } } } },
      $ref: "#/$defs/Nodo",
    };
    expect(cleanSchema(tree)).toEqual({
      type: "object",
      properties: { nombre: { type: "string" }, hijos: { type: "array", items: { type: "object" } } },
    });
    // Cuatro referencias a sí mismo por nivel: sin tope serían 4^12 nodos (segundos de CPU y más de 1 GB).
    const props = Object.fromEntries(["p0", "p1", "p2", "p3"].map((key) => [key, { $ref: "#/$defs/a" }]));
    const bomb = { $defs: { a: { type: "object", properties: props } }, $ref: "#/$defs/a" };
    const started = Date.now();
    expect(cleanSchema(bomb)).toMatchObject({ type: "object", properties: { p0: { type: "object" } } });
    expect(Date.now() - started).toBeLessThan(200);
    // Un esquema enorme sin recursión también se rechaza.
    const wide = { type: "object", properties: Object.fromEntries(Array.from({ length: 2_500 }, (_, i) => [`c${i}`, { type: "string" }])) };
    expect(() => cleanSchema(wide)).toThrow(AIProviderError);
  });

  it("Anthropic: objetos cerrados y los límites pasan a la descripción", () => {
    const schema = toAnthropicOutputSchema(zodLike) as Record<string, any>;
    expect(schema.$schema).toBeUndefined();
    expect(schema.additionalProperties).toBe(false);
    expect(schema.properties.titular).toEqual({ type: "string", description: "Una frase (de 5 a 90 caracteres)" });
    expect(schema.properties.monto).toEqual({ anyOf: [{ type: "number", description: "(mínimo 0)" }, { type: "null" }] });
    expect(schema.properties.importancia).toEqual({ type: "integer" });
    expect(schema.properties.puntos).toEqual({
      type: "array",
      items: { type: "string", description: "(máximo 200 caracteres)" },
      description: "(de 2 a 5 elementos)",
    });
    expect(schema.properties.correo).toEqual({ type: "string", format: "email" });
    expect(schema.properties.nota).toEqual({ type: "string" });
    expect(schema.required).toEqual(zodLike.required);
  });

  it("Anthropic: las uniones quedan como anyOf de objetos cerrados y const pasa a enum", () => {
    const schema = toAnthropicOutputSchema(sections) as Record<string, any>;
    const branches = schema.properties.secciones.items.anyOf;
    expect(branches).toHaveLength(2);
    expect(branches[0]).toMatchObject({ additionalProperties: false, properties: { kind: { type: "string", enum: ["faq"] } } });
  });

  it("Gemini: subconjunto de OpenAPI con nullable, sin additionalProperties y en el orden declarado", () => {
    const schema = toGeminiSchema(zodLike, { ordered: true }) as Record<string, any>;
    expect(schema.propertyOrdering).toEqual(["titular", "monto", "importancia", "veredicto", "puntos", "correo", "nota"]);
    expect(schema.additionalProperties).toBeUndefined();
    expect(schema.properties.monto).toEqual({ type: "number", minimum: 0, nullable: true });
    expect(schema.properties.titular).toEqual({ type: "string", description: "Una frase (de 5 a 90 caracteres)" });
    expect(schema.properties.importancia).toEqual({ type: "integer" });
    expect(schema.properties.veredicto).toEqual({ type: "string", enum: ["comprar", "esperar"] });
    expect(schema.properties.puntos).toEqual({
      type: "array",
      items: { type: "string", description: "(máximo 200 caracteres)" },
      minItems: 2,
      maxItems: 5,
    });
    expect(schema.properties.correo).toEqual({ type: "string" });
    expect(schema.properties.nota).toEqual({ type: "string" });
  });

  it("Gemini: tipos con null y uniones de varias ramas", () => {
    expect(toGeminiSchema({ type: ["string", "null"] })).toEqual({ type: "string", nullable: true });
    const schema = toGeminiSchema(sections) as Record<string, any>;
    const branches = schema.properties.secciones.items.anyOf;
    expect(branches[0].properties.kind).toEqual({ type: "string", enum: ["faq"] });
    expect(branches[1].properties.text).toEqual({ type: "string" });
  });

  it("modo estricto de OpenAI/xAI solo si todo objeto está cerrado y completo", () => {
    expect(isStrictCompatible(zodLike)).toBe(false);
    const strict = {
      type: "object",
      properties: { a: { type: "string" }, b: { type: "object", properties: { c: { type: "number" } }, required: ["c"], additionalProperties: false } },
      required: ["a", "b"],
      additionalProperties: false,
    };
    expect(isStrictCompatible(strict)).toBe(true);
    expect(isStrictCompatible({ ...strict, required: ["a"] })).toBe(false);
    expect(isStrictCompatible({ ...strict, properties: { ...strict.properties, a: { type: "string", default: "x" } } })).toBe(false);
  });

  it("una raíz que no es objeto va dentro de `value`", () => {
    expect(objectRoot({ type: "object", properties: {} }).wrapped).toBe(false);
    const root = objectRoot({ type: "array", items: { type: "string" } });
    expect(root).toEqual({
      wrapped: true,
      schema: { type: "object", properties: { value: { type: "array", items: { type: "string" } } }, required: ["value"], additionalProperties: false },
    });
    expect(unwrapJson('{"value":["a","b"]}')).toEqual(["a", "b"]);
    expect(unwrapJson("no es json")).toBeUndefined();
  });

  it("lee el JSON aunque venga en un bloque de código o con texto alrededor", () => {
    expect(parseJsonText('{"a":1}')).toEqual({ ok: true, value: { a: 1 } });
    expect(parseJsonText('```json\n{"a":1}\n```')).toEqual({ ok: true, value: { a: 1 } });
    expect(parseJsonText('Aquí está: {"a":{"b":[1,2]}} ¡listo!')).toEqual({ ok: true, value: { a: { b: [1, 2] } } });
    expect(parseJsonText("[1,2]")).toEqual({ ok: true, value: [1, 2] });
    expect(parseJsonText('{"a":')).toEqual({ ok: false });
    expect(parseJsonText("")).toEqual({ ok: false });
  });
});
