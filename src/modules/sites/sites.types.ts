// Páginas web que arma Omni: lo que pide la persona (brief), el texto que escribe la IA (copy) y el contenido que se
// publica. Puro (solo zod): lo usan el servidor, la página pública, el motor y las pruebas.
//
// Seguridad por diseño: la IA solo escribe textos. Los enlaces (WhatsApp, teléfono, correo, Instagram, web) los arma
// el servidor con los datos que dio la persona, así una página nunca lleva a un sitio que ella no indicó.
import { z } from "zod";

export const PALETTE_IDS = ["bosque", "oceano", "atardecer", "grafito", "ciruela", "arena"] as const;
export type PaletteId = (typeof PALETTE_IDS)[number];

export const PALETTE_LABEL: Record<PaletteId, string> = {
  bosque: "verde bosque",
  oceano: "azul océano",
  atardecer: "naranja atardecer",
  grafito: "grafito oscuro",
  ciruela: "ciruela",
  arena: "arena",
};

export const SITE_GOALS = ["vender", "reservas", "contacto", "portafolio", "evento", "informar"] as const;
export type SiteGoal = (typeof SITE_GOALS)[number];

export const FEATURE_ICONS = ["check", "estrella", "corazon", "rayo", "escudo", "reloj", "envio", "chat", "regalo", "hoja", "chispa", "etiqueta"] as const;
export type FeatureIcon = (typeof FEATURE_ICONS)[number];

const text = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) => z.string().trim().max(max).default("");

// ── Lo que pide la persona ───────────────────────────────────────────────────

export const siteContactInputSchema = z.object({
  whatsapp: z.string().trim().max(30).optional().describe("Número de WhatsApp con código de país, como lo dio la persona"),
  phone: z.string().trim().max(30).optional().describe("Teléfono para llamar"),
  email: z.email().max(120).optional(),
  instagram: z.string().trim().max(80).optional().describe("Usuario o enlace de Instagram"),
  website: z.string().trim().max(200).optional().describe("Otra web suya (https)"),
  address: z.string().trim().max(160).optional(),
  hours: z.string().trim().max(120).optional().describe("Horario de atención"),
});
export type SiteContactInput = z.output<typeof siteContactInputSchema>;

export const siteBriefSchema = z.object({
  name: z.string().trim().min(2).max(60).describe("Nombre del negocio, marca o proyecto, como lo escribió la persona"),
  about: z
    .string()
    .trim()
    .min(10)
    .max(1200)
    .describe("Qué ofrece, a quién y qué lo hace distinto, con las palabras de la persona (sin inventar nada)"),
  goal: z.enum(SITE_GOALS).default("contacto").describe("Para qué es la página"),
  offerings: z.array(z.string().trim().min(2).max(80)).max(8).default([]).describe("Productos o servicios que nombró"),
  prices: z.string().trim().max(400).optional().describe("Precios exactamente como los dio la persona; nunca los inventes"),
  contact: siteContactInputSchema.default({}),
  palette: z
    .enum(PALETTE_IDS)
    .optional()
    .describe("Colores, solo si la persona eligió: bosque (verde), oceano (azul), atardecer (naranja), grafito (oscuro), ciruela (morado) o arena (beige)"),
});
export type SiteBrief = z.output<typeof siteBriefSchema>;

// ── Lo que escribe la IA ─────────────────────────────────────────────────────

export const siteSectionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("features"),
    title: text(70),
    items: z.array(z.object({ title: text(60), text: optionalText(220), icon: z.enum(FEATURE_ICONS) })).min(2).max(6),
  }),
  z.object({ kind: z.literal("about"), title: text(70), text: text(900) }),
  z.object({
    kind: z.literal("steps"),
    title: text(70),
    items: z.array(z.object({ title: text(60), text: optionalText(220) })).min(2).max(5),
  }),
  z.object({
    kind: z.literal("pricing"),
    title: text(70),
    items: z.array(z.object({ name: text(60), price: text(40), detail: optionalText(160) })).min(1).max(8),
    note: optionalText(200),
  }),
  z.object({
    kind: z.literal("faq"),
    title: text(70),
    items: z.array(z.object({ question: text(140), answer: text(400) })).min(2).max(8),
  }),
]);
export type SiteSection = z.output<typeof siteSectionSchema>;

/** Los textos de la página: los escribe la IA (o las reglas, sin IA). Sin enlaces. */
export const siteCopySchema = z.object({
  tagline: optionalText(120).describe("Frase corta que acompaña al nombre"),
  hero: z.object({
    headline: text(90).describe("Titular de 3 a 9 palabras"),
    subheadline: optionalText(240),
    ctaLabel: text(32).describe("Texto del botón principal, según el contacto disponible"),
  }),
  sections: z.array(siteSectionSchema).min(1).max(6),
  closing: z.object({ title: text(80), text: optionalText(240) }).nullable().default(null),
  palette: z.enum(PALETTE_IDS),
});
export type SiteCopy = z.output<typeof siteCopySchema>;

// ── Lo que se publica ────────────────────────────────────────────────────────

/** Contacto ya normalizado (los enlaces se arman al mostrarlo; ver contactLinks en sites.rules.ts). */
export const siteContactSchema = z.object({
  /** Solo dígitos, con código de país. */
  whatsapp: z.string().nullable().default(null),
  /** Como se muestra ("+58 414 555 0101"). */
  phone: z.string().nullable().default(null),
  email: z.string().nullable().default(null),
  /** Usuario sin @. */
  instagram: z.string().nullable().default(null),
  /** https://… */
  website: z.string().nullable().default(null),
  address: z.string().nullable().default(null),
  hours: z.string().nullable().default(null),
});
export type SiteContact = z.output<typeof siteContactSchema>;

export const siteContentSchema = siteCopySchema.extend({
  name: text(60),
  contact: siteContactSchema,
});
export type SiteContent = z.output<typeof siteContentSchema>;

// ── Vistas ───────────────────────────────────────────────────────────────────

export type SiteStatusId = "DRAFT" | "PUBLISHED" | "ARCHIVED";

export interface SiteView {
  id: string;
  slug: string;
  name: string;
  status: SiteStatusId;
  /** Ruta pública (/s/slug). */
  path: string;
  /** Vista previa para su dueño (con los cambios que esperan aprobación). */
  previewPath: string;
  hasPendingChanges: boolean;
  createdAt: string;
  publishedAt: string | null;
}
