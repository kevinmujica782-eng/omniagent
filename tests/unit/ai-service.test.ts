import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

// Router de IA de punta a punta en el servidor: generateStructured arma el pedido, el router llama a la API (fetch
// simulado), zod valida, se pide una corrección si hace falta, se cambia de proveedor si uno falla y se registra el
// consumo con su proveedor. Sin red ni base de datos.

const db = vi.hoisted(() => ({ usage: [] as Record<string, unknown>[] }));
vi.mock("@/lib/db", () => ({
  prisma: {
    aiUsageLog: {
      create: async (args: { data: Record<string, unknown> }) => {
        db.usage.push(args.data);
        return args.data;
      },
    },
  },
}));

process.env.ANTHROPIC_API_KEY = "sk-ant-prueba";
process.env.OPENAI_API_KEY = "sk-prueba";

const { generateStructured, StructuredOutputError, aiConfigured, tierForPlan, jsonSchemaOf } = await import("@/modules/ai/ai.service");

const alertSchema = z.object({
  titular: z.string().min(5).max(90),
  veredicto: z.enum(["comprar", "esperar"]),
});

type Sent = { url: string; body: Record<string, any> };
let sent: Sent[] = [];

function serve(replies: { status?: number; body: unknown }[]) {
  const queue = [...replies];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    sent.push({ url, body: JSON.parse(String(init.body)) as Record<string, any> });
    const next = queue.shift();
    if (!next) throw new Error("Sin más respuestas programadas.");
    return new Response(JSON.stringify(next.body), { status: next.status ?? 200, headers: { "content-type": "application/json" } });
  });
}

const claudeTool = (input: unknown) => ({
  body: {
    id: "msg_1",
    type: "message",
    role: "assistant",
    model: "claude-haiku-4-5-20251001",
    content: [{ type: "tool_use", id: "toolu_1", name: "redactar_alerta", input }],
    stop_reason: "tool_use",
    usage: { input_tokens: 100, output_tokens: 20 },
  },
});

beforeEach(() => {
  sent = [];
  db.usage.length = 0;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("router de IA: salida estructurada para los módulos", () => {
  it("hay IA configurada y el plan elige el nivel", () => {
    expect(aiConfigured()).toBe(true);
    expect(tierForPlan("FREE")).toBe("fast");
    expect(tierForPlan("PRO")).toBe("smart");
    expect(jsonSchemaOf(alertSchema)).toMatchObject({ type: "object", required: ["titular", "veredicto"] });
  });

  it("Haiku responde con la herramienta del formato; zod valida y se registra el consumo", async () => {
    serve([claudeTool({ titular: "Bajó 24% hoy", veredicto: "comprar" })]);
    const result = await generateStructured({
      schema: alertSchema,
      name: "redactar_alerta",
      system: "Redactas avisos.",
      prompt: "Datos",
      tier: "fast",
      maxOutputTokens: 500,
      usage: { userId: "u1", module: "CONCIERGE", kind: "price_alert" },
    });
    expect(result).toMatchObject({ value: { titular: "Bajó 24% hoy", veredicto: "comprar" }, provider: "anthropic", model: "claude-haiku-4-5-20251001" });
    expect(sent[0].url).toBe("https://api.anthropic.com/v1/messages");
    expect(sent[0].body.tool_choice).toEqual({ type: "tool", name: "redactar_alerta" });
    expect(db.usage).toEqual([
      expect.objectContaining({ userId: "u1", module: "CONCIERGE", kind: "price_alert", provider: "anthropic", inputTokens: 100, outputTokens: 20 }),
    ]);
  });

  it("si la revisión encuentra un problema, pide la corrección al mismo proveedor", async () => {
    serve([claudeTool({ titular: "Bajó 50% hoy", veredicto: "comprar" }), claudeTool({ titular: "Bajó 24% hoy", veredicto: "comprar" })]);
    const result = await generateStructured({
      schema: alertSchema,
      name: "redactar_alerta",
      system: "Redactas avisos.",
      prompt: "Datos",
      tier: "fast",
      maxOutputTokens: 500,
      attempts: 2,
      review: (value) => (value.titular.includes("50%") ? "El 50% no sale de los datos." : null),
      usage: { userId: "u1", module: "CONCIERGE", kind: "price_alert" },
    });
    expect(result.value.titular).toBe("Bajó 24% hoy");
    expect(sent).toHaveLength(2);
    expect(sent[1].body.messages).toEqual([
      { role: "user", content: [{ type: "text", text: "Datos" }] },
      { role: "assistant", content: [{ type: "text", text: '{"titular":"Bajó 50% hoy","veredicto":"comprar"}' }] },
      {
        role: "user",
        content: [{ type: "text", text: "Corrige tu respuesta: El 50% no sale de los datos. Devuélvela completa otra vez, con el mismo formato." }],
      },
    ]);
    // Un solo registro con el consumo de los dos intentos.
    expect(db.usage).toEqual([expect.objectContaining({ inputTokens: 200, outputTokens: 40 })]);
  });

  it("si Claude está saturado, responde OpenAI con el mismo esquema", async () => {
    const overloaded = { status: 529, body: { type: "error", error: { type: "overloaded_error", message: "Overloaded" } } };
    serve([
      overloaded,
      overloaded,
      {
        body: {
          status: "completed",
          model: "gpt-6-luna",
          output: [{ type: "message", content: [{ type: "output_text", text: '{"titular":"Llegó a tu precio","veredicto":"comprar"}' }] }],
          usage: { input_tokens: 80, output_tokens: 15, total_tokens: 95 },
        },
      },
    ]);
    const result = await generateStructured({
      schema: alertSchema,
      name: "redactar_alerta",
      system: "Redactas avisos.",
      prompt: "Datos",
      tier: "fast",
      maxOutputTokens: 500,
      usage: { userId: "u1", module: "CONCIERGE", kind: "price_alert" },
    });
    expect(result).toMatchObject({ provider: "openai", model: "gpt-6-luna", value: { titular: "Llegó a tu precio" } });
    expect(sent.map((request) => request.url)).toEqual([
      "https://api.anthropic.com/v1/messages",
      "https://api.anthropic.com/v1/messages",
      "https://api.openai.com/v1/responses",
    ]);
    expect(sent[2].body.text).toMatchObject({ format: { type: "json_schema", name: "redactar_alerta" } });
    expect(db.usage).toEqual([expect.objectContaining({ provider: "openai", model: "gpt-6-luna", inputTokens: 80, outputTokens: 15 })]);
  });

  it("si la respuesta nunca pasa la validación, lanza (y con logOn success no registra)", async () => {
    serve([claudeTool({ titular: "x", veredicto: "quizas" })]);
    await expect(
      generateStructured({
        schema: alertSchema,
        name: "redactar_alerta",
        system: "Redactas avisos.",
        prompt: "Datos",
        tier: "fast",
        maxOutputTokens: 500,
        usage: { userId: "u1", module: "PROCEDURES", kind: "document", logOn: "success" },
      }),
    ).rejects.toBeInstanceOf(StructuredOutputError);
    expect(db.usage).toEqual([]);
  });
});
