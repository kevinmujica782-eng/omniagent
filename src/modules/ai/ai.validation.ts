// Lo que acepta POST /api/v1/ai/chat. Validado antes de llegar al router: tamaños, tipos de imagen y formato.
import { z } from "zod";
import { AI_PROVIDER_IDS, AI_TIERS } from "@/types/ai";
import { IMAGE_MEDIA_TYPES } from "./ai.types";

/** Tope del cuerpo (las imágenes van en base64): cabe en una función de Netlify (6 MB). */
export const AI_CHAT_MAX_BYTES = 4_500_000;
const MAX_TEXT = 20_000;
const MAX_TOTAL_TEXT = 100_000;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

const textPart = z.object({ type: z.literal("text"), text: z.string().min(1).max(MAX_TEXT) });
const imagePart = z.object({
  type: z.literal("image"),
  mediaType: z.enum(IMAGE_MEDIA_TYPES),
  data: z.string().min(8).max(4_000_000).regex(BASE64, "La imagen debe ir en base64, sin el prefijo data:"),
});

const userMessage = z.object({
  role: z.literal("user"),
  content: z.union([z.string().trim().min(1).max(MAX_TEXT), z.array(z.discriminatedUnion("type", [textPart, imagePart])).min(1).max(8)]),
});
const assistantMessage = z.object({ role: z.literal("assistant"), content: z.string().max(MAX_TEXT) });

const responseFormat = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text") }),
  z.object({
    type: z.literal("json"),
    /** JSON Schema de un objeto. */
    schema: z.record(z.string(), z.unknown()).optional(),
    name: z
      .string()
      .regex(/^[A-Za-z0-9_-]{1,64}$/, "Usa letras, números, guion o guion bajo (máximo 64)")
      .optional(),
  }),
]);

const textLength = (message: z.infer<typeof userMessage> | z.infer<typeof assistantMessage>) =>
  typeof message.content === "string"
    ? message.content.length
    : message.content.reduce((total, part) => total + (part.type === "text" ? part.text.length : 0), 0);

export const aiChatBodySchema = z
  .object({
    messages: z.array(z.discriminatedUnion("role", [userMessage, assistantMessage])).min(1).max(40),
    /** Indicaciones de la app para esta conversación (van debajo de las reglas de Omni). */
    instructions: z.string().trim().max(2_000).optional(),
    provider: z.enum(["auto", ...AI_PROVIDER_IDS] as const).default("auto"),
    tier: z.enum(AI_TIERS).default("fast"),
    responseFormat: responseFormat.optional(),
    maxOutputTokens: z.number().int().min(16).max(8_192).optional(),
    temperature: z.number().min(0).max(2).optional(),
    /** Si el proveedor elegido falla, responder con otro (por defecto sí). */
    fallback: z.boolean().default(true),
  })
  .refine((body) => body.messages.at(-1)?.role === "user", "El último mensaje debe ser de la persona.")
  .refine((body) => body.messages.reduce((total, message) => total + textLength(message), 0) <= MAX_TOTAL_TEXT, "La conversación es demasiado larga.")
  .refine(
    (body) => body.responseFormat?.type !== "json" || !body.responseFormat.schema || JSON.stringify(body.responseFormat.schema).length <= 16_000,
    "El esquema JSON es demasiado grande.",
  );

export type AIChatBody = z.output<typeof aiChatBodySchema>;
