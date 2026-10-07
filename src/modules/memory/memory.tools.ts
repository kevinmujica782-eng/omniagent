import "server-only";
import { z } from "zod";
import { defineTool, type ToolContext, type ToolResult } from "@/modules/agent/registry";
import { asImportance, shortRef, summarizeMemory } from "./memory.rules";
import { forgetMemory, recallMemories, rememberMemory } from "./memory.service";
import {
  FINANCE_ASPECTS,
  FREQUENCIES,
  GOAL_STATUSES,
  MEMORY_KINDS,
  NOTE_ABOUT,
  PREFERENCE_TOPICS,
  WEBSITE_STATUSES,
  type MemoryInput,
} from "./memory.types";

// Herramientas de memoria del agente: guardar por categoría (con datos tipados), buscar y olvidar. Omni guarda solo
// lo duradero que la persona cuenta de sí misma o lo que pide recordar; nunca claves, tarjetas ni datos de salud.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Campos comunes a todas las herramientas de guardar. */
const common = {
  importance: z
    .number()
    .int()
    .min(1)
    .max(3)
    .optional()
    .describe("1 baja, 2 media (por defecto), 3 alta: algo que la persona repite o que cambia cómo la ayudas"),
  pin: z.boolean().optional().describe("true solo si la persona pide que siempre lo tengas presente"),
  ref: z
    .string()
    .max(40)
    .optional()
    .describe("ref del recuerdo que corriges o actualizas (la de la memoria o de memory_recall); sin ref, se busca por título"),
};

const moneyFields = {
  amount: z.number().nonnegative().optional().describe("Monto, si lo dijo"),
  currency: z
    .string()
    .regex(/^[A-Za-z]{3,5}$/)
    .optional()
    .describe("Moneda del monto (USD, VES, USDT…); por defecto, la del usuario"),
};

/** Guarda y responde lo mismo para todas las categorías. */
async function save(input: MemoryInput, ref: string | undefined, ctx: ToolContext): Promise<ToolResult> {
  const { memory, created, evicted } = await rememberMemory(ctx.userId, input, {
    source: "AGENT",
    conversationId: ctx.conversationId,
    ref: ref ?? null,
    now: ctx.now,
  });
  return {
    data: {
      saved: true,
      updated: !created,
      ref: shortRef(memory.id),
      remembered: summarizeMemory(memory),
      ...(evicted ? { forgot_to_make_room: evicted.title } : {}),
      note: "Dilo en pocas palabras (por ejemplo: «Lo recordaré»); no repitas todo lo guardado.",
    },
  };
}

function moneyOf(amount: number | undefined, currency: string | undefined, ctx: ToolContext) {
  return amount === undefined ? undefined : { amount, currency: (currency ?? ctx.currency).toUpperCase() };
}

export const memoryTools = [
  defineTool({
    name: "memory_save_preference",
    module: "GENERAL",
    description:
      "Recuerda cómo quiere la persona que la ayudes o le hables (respuestas cortas, avisos solo urgentes, que nunca compres sin preguntar el precio…). Úsala cuando lo diga o pida que lo recuerdes.",
    input: z.object({
      title: z.string().min(2).max(120).describe("Nombre corto: «Respuestas cortas»"),
      statement: z.string().min(3).max(280).describe("La preferencia en una frase, en tercera persona: «Prefiere respuestas cortas y sin tecnicismos»"),
      topic: z.enum(PREFERENCE_TOPICS).default("otro"),
      firm: z.boolean().default(true).describe("true si la pidió explícitamente; false si la deduces de cómo habla"),
      ...common,
    }),
    async run(input, ctx) {
      return save(
        {
          kind: "PREFERENCE",
          title: input.title,
          data: { topic: input.topic, statement: input.statement, strength: input.firm ? "firme" : "suave" },
          importance: asImportance(input.importance),
          pinned: input.pin,
        },
        input.ref,
        ctx,
      );
    },
  }),

  defineTool({
    name: "memory_save_finance",
    module: "GENERAL",
    description:
      "Recuerda un dato de dinero que la persona cuenta y que sus cuentas conectadas no muestran: cómo y cuándo cobra, gastos fijos, deudas, ahorros, inversiones o hábitos. No guarda números de cuenta ni de tarjeta.",
    input: z.object({
      title: z.string().min(2).max(120).describe("Nombre corto: «Sueldo», «Alquiler», «Deuda de la tarjeta»"),
      aspect: z.enum(FINANCE_ASPECTS),
      detail: z.string().max(280).optional().describe("Lo demás que contó: «Cobra en USDT por Binance»"),
      ...moneyFields,
      frequency: z.enum(FREQUENCIES).optional(),
      day_of_month: z.number().int().min(1).max(31).optional().describe("Día del mes en que cobra o paga"),
      ...common,
    }),
    async run(input, ctx) {
      return save(
        {
          kind: "FINANCE",
          title: input.title,
          data: {
            aspect: input.aspect,
            detail: input.detail || undefined,
            amount: moneyOf(input.amount, input.currency, ctx),
            frequency: input.frequency,
            dayOfMonth: input.day_of_month,
          },
          importance: asImportance(input.importance),
          pinned: input.pin,
        },
        input.ref,
        ctx,
      );
    },
  }),

  defineTool({
    name: "memory_save_website",
    module: "GENERAL",
    description:
      "Recuerda una página o sitio web que la persona creó o está creando (su tienda, su landing, su portafolio): dirección, plataforma, para qué es y en qué estado está.",
    input: z.object({
      name: z.string().min(2).max(120).describe("Nombre de la página: «FlujoMarket»"),
      url: z.string().max(300).optional().describe("Dirección completa con https://"),
      platform: z.string().max(40).optional().describe("Dónde está publicada: Netlify, Vercel, Shopify, WordPress…"),
      purpose: z.string().min(3).max(280).describe("Para qué es: «Marketplace para vender flujos de Make y n8n»"),
      status: z.enum(WEBSITE_STATUSES).default("publicada"),
      stack: z.array(z.string().min(1).max(30)).max(8).optional().describe("Con qué está hecha, si lo dijo"),
      launched_on: z.string().regex(DATE_RE).optional().describe("Desde cuándo está publicada (AAAA-MM-DD)"),
      ...common,
    }),
    async run(input, ctx) {
      return save(
        {
          kind: "WEBSITE",
          title: input.name,
          data: {
            url: input.url || undefined,
            platform: input.platform || undefined,
            purpose: input.purpose,
            status: input.status,
            stack: input.stack ?? [],
            launchedOn: input.launched_on,
          },
          importance: asImportance(input.importance),
          pinned: input.pin,
        },
        input.ref,
        ctx,
      );
    },
  }),

  defineTool({
    name: "memory_save_goal",
    module: "GENERAL",
    description:
      "Recuerda una meta o aspiración que la persona contó (lanzar su tienda, mudarse, aprender inglés) y por qué le importa. Para una meta de ahorro con monto que quiera seguir con avances, usa goals_create; aquí solo se recuerda.",
    input: z.object({
      title: z.string().min(2).max(120).describe("La meta: «Lanzar mi tienda online»"),
      why: z.string().max(280).optional().describe("Por qué le importa, si lo dijo"),
      horizon: z.enum(["corto", "mediano", "largo"]).optional(),
      target_date: z.string().regex(DATE_RE).optional().describe("Para cuándo (AAAA-MM-DD)"),
      ...moneyFields,
      status: z.enum(GOAL_STATUSES).default("activa").describe("lograda o abandonada cuando cuente que la cumplió o la dejó"),
      ...common,
    }),
    async run(input, ctx) {
      return save(
        {
          kind: "GOAL",
          title: input.title,
          data: {
            why: input.why || undefined,
            horizon: input.horizon,
            targetDate: input.target_date,
            target: moneyOf(input.amount, input.currency, ctx),
            status: input.status,
          },
          importance: asImportance(input.importance),
          pinned: input.pin,
        },
        input.ref,
        ctx,
      );
    },
  }),

  defineTool({
    name: "memory_save_note",
    module: "GENERAL",
    description:
      "Recuerda otro dato duradero de la persona que sirva para ayudarla mejor (a qué se dedica, su negocio, con quién vive). No guarda datos de salud, documentos ni claves.",
    input: z.object({
      title: z.string().min(2).max(120).describe("Nombre corto: «Su negocio»"),
      text: z.string().min(3).max(500).describe("El dato en una o dos frases, en tercera persona"),
      about: z.enum(NOTE_ABOUT).default("otro"),
      ...common,
    }),
    async run(input, ctx) {
      return save(
        {
          kind: "NOTE",
          title: input.title,
          data: { text: input.text, about: input.about },
          importance: asImportance(input.importance),
          pinned: input.pin,
        },
        input.ref,
        ctx,
      );
    },
  }),

  defineTool({
    name: "memory_recall",
    module: "GENERAL",
    description:
      "Busca en lo que recuerdas de la persona algo que no está en el resumen de memoria (por palabras: «página de números», «alquiler»). Sin query, devuelve lo más importante y reciente.",
    input: z.object({
      query: z.string().max(200).optional(),
      kinds: z.array(z.enum(MEMORY_KINDS)).max(5).optional().describe("Filtra por categoría"),
      limit: z.number().int().min(1).max(20).default(8),
    }),
    async run(input, ctx) {
      const found = await recallMemories(ctx.userId, { query: input.query, kinds: input.kinds, limit: input.limit, now: ctx.now });
      return {
        data: {
          count: found.length,
          memories: found.map(({ memory }) => ({
            ref: shortRef(memory.id),
            kind: memory.kind,
            title: memory.title,
            remembered: summarizeMemory(memory),
            updated: memory.updatedAt.toISOString().slice(0, 10),
            pinned: memory.pinned,
          })),
          ...(found.length === 0 ? { note: "No hay nada guardado sobre eso. No lo inventes: pregúntale a la persona si hace falta." } : {}),
        },
      };
    },
  }),

  defineTool({
    name: "memory_forget",
    module: "GENERAL",
    description: "Olvida (borra) un recuerdo cuando la persona lo pide o cuando ya no es cierto y no se puede corregir. Usa su ref.",
    input: z.object({ ref: z.string().min(6).max(40) }),
    async run(input, ctx) {
      const removed = await forgetMemory(ctx.userId, input.ref, "AGENT");
      return { data: { forgotten: true, title: removed.title } };
    },
  }),
];
