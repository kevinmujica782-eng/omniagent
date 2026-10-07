// Tipos de la memoria del agente: lo que Omni recuerda de cada persona, en cinco categorías con datos tipados.
// Sin "server-only": la pantalla de Cuenta, las herramientas del agente y las pruebas usan estos tipos.
import { z } from "zod";

export const MEMORY_KINDS = ["PREFERENCE", "FINANCE", "WEBSITE", "GOAL", "NOTE"] as const;
export type MemoryKind = (typeof MEMORY_KINDS)[number];

/** Quién lo guardó: la persona en la app, Omni en el chat (con lo que la persona dijo) o la app al sincronizar. */
export const MEMORY_SOURCES = ["USER", "AGENT", "SYSTEM"] as const;
export type MemorySource = (typeof MEMORY_SOURCES)[number];

/** 1 baja, 2 media, 3 alta. Lo fijado entra siempre en el contexto, sea cual sea su importancia. */
export type Importance = 1 | 2 | 3;
export const importanceSchema = z.union([z.literal(1), z.literal(2), z.literal(3)]);

export const MEMORY_KIND_LABEL: Record<MemoryKind, string> = {
  PREFERENCE: "Preferencias",
  FINANCE: "Finanzas",
  WEBSITE: "Páginas web",
  GOAL: "Metas",
  NOTE: "Otros datos",
};

// ── Piezas comunes ───────────────────────────────────────────────────────────

const text = (max: number) => z.string().trim().min(1).max(max);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "La fecha va como AAAA-MM-DD");

function isWebUrl(value: string): boolean {
  try {
    const url = new URL(value);
    // Sin usuario ni contraseña dentro de la dirección (https://usuario:clave@…).
    return (url.protocol === "https:" || url.protocol === "http:") && url.hostname.includes(".") && !url.username && !url.password;
  } catch {
    return false;
  }
}

const webUrl = z.string().trim().max(300).refine(isWebUrl, "La dirección debe empezar con https:// o http://");

/** Monto con su moneda (USD, VES, USDT…). */
export const moneySchema = z.object({
  amount: z.number().finite().nonnegative().max(1_000_000_000_000),
  currency: z
    .string()
    .trim()
    .transform((c) => c.toUpperCase())
    .pipe(z.string().regex(/^[A-Z]{3,5}$/, "La moneda va como USD, VES o USDT")),
});
export type Money = z.output<typeof moneySchema>;

// ── Datos de cada categoría ──────────────────────────────────────────────────

export const PREFERENCE_TOPICS = ["comunicacion", "idioma", "notificaciones", "finanzas", "compras", "tramites", "privacidad", "otro"] as const;

/** Cómo quiere la persona que Omni trabaje o hable con ella. */
export const preferenceDataSchema = z.object({
  topic: z.enum(PREFERENCE_TOPICS).default("otro"),
  /** La preferencia en una frase: «Prefiere respuestas cortas y sin tecnicismos». */
  statement: text(280),
  /** firme: la pidió de forma explícita; suave: se dedujo de cómo habla. */
  strength: z.enum(["suave", "firme"]).default("firme"),
});

export const FINANCE_ASPECTS = ["ingreso", "gasto_fijo", "deuda", "ahorro", "inversion", "presupuesto", "cuenta", "habito", "otro"] as const;
export const FREQUENCIES = ["unica", "semanal", "quincenal", "mensual", "anual"] as const;

/** Datos de dinero que la persona cuenta y que el banco conectado no muestra (cobra en USDT, paga alquiler el 5…). */
export const financeDataSchema = z.object({
  aspect: z.enum(FINANCE_ASPECTS),
  detail: text(280).optional(),
  amount: moneySchema.optional(),
  frequency: z.enum(FREQUENCIES).optional(),
  dayOfMonth: z.number().int().min(1).max(31).optional(),
});

export const WEBSITE_STATUSES = ["idea", "en_construccion", "publicada", "pausada", "archivada"] as const;

/** Página o sitio web que la persona creó (su tienda, su landing, su portafolio). */
export const websiteDataSchema = z.object({
  url: webUrl.optional(),
  platform: text(40).optional(),
  purpose: text(280),
  status: z.enum(WEBSITE_STATUSES).default("publicada"),
  stack: z.array(text(30)).max(8).default([]),
  launchedOn: isoDate.optional(),
});

export const GOAL_STATUSES = ["activa", "lograda", "abandonada"] as const;

/**
 * Meta o aspiración que la persona contó. Las metas con monto que sigue en la pantalla Metas viven en la tabla
 * goals; aquí se puede enlazar una con trackedGoalId.
 */
export const goalDataSchema = z.object({
  why: text(280).optional(),
  horizon: z.enum(["corto", "mediano", "largo"]).optional(),
  targetDate: isoDate.optional(),
  target: moneySchema.optional(),
  status: z.enum(GOAL_STATUSES).default("activa"),
  trackedGoalId: z.uuid().optional(),
});

export const NOTE_ABOUT = ["familia", "trabajo", "negocio", "hogar", "estudios", "otro"] as const;

/** Otros datos duraderos de la persona (su negocio, a qué se dedica, con quién vive). */
export const noteDataSchema = z.object({
  text: text(500),
  about: z.enum(NOTE_ABOUT).default("otro"),
});

export const MEMORY_DATA_SCHEMAS = {
  PREFERENCE: preferenceDataSchema,
  FINANCE: financeDataSchema,
  WEBSITE: websiteDataSchema,
  GOAL: goalDataSchema,
  NOTE: noteDataSchema,
} as const satisfies Record<MemoryKind, z.ZodType>;

/** Datos ya validados de cada categoría. */
export type MemoryDataMap = { [K in MemoryKind]: z.output<(typeof MEMORY_DATA_SCHEMAS)[K]> };
/** Datos tal como llegan (con valores por defecto opcionales). */
export type MemoryDataInput = { [K in MemoryKind]: z.input<(typeof MEMORY_DATA_SCHEMAS)[K]> };

export type PreferenceData = MemoryDataMap["PREFERENCE"];
export type FinanceData = MemoryDataMap["FINANCE"];
export type WebsiteData = MemoryDataMap["WEBSITE"];
export type GoalData = MemoryDataMap["GOAL"];
export type NoteData = MemoryDataMap["NOTE"];

// ── Recuerdos ────────────────────────────────────────────────────────────────

export interface MemoryBase {
  id: string;
  /** Nombre corto: «Respuestas cortas», «FlujoMarket», «Alquiler». */
  title: string;
  importance: Importance;
  pinned: boolean;
  source: MemorySource;
  useCount: number;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Un recuerdo con sus datos tipados según su categoría (unión discriminada por `kind`). */
export type MemoryRecord = { [K in MemoryKind]: MemoryBase & { kind: K; data: MemoryDataMap[K] } }[MemoryKind];
export type MemoryOf<K extends MemoryKind> = Extract<MemoryRecord, { kind: K }>;

/** Lo que se pide guardar. El servicio valida `data` con el esquema de su categoría. */
export type MemoryInput = {
  [K in MemoryKind]: {
    kind: K;
    title: string;
    data: MemoryDataInput[K];
    importance?: Importance;
    pinned?: boolean;
    /** Para datos que vencen solos («este mes estoy de viaje»). */
    expiresAt?: Date | null;
  };
}[MemoryKind];

/** Entrada validada y lista para guardar. */
export type ValidMemoryInput = {
  [K in MemoryKind]: {
    kind: K;
    title: string;
    data: MemoryDataMap[K];
    importance: Importance;
    pinned: boolean;
    expiresAt: Date | null;
  };
}[MemoryKind];

/** Esquema de la entrada (lo usan la API y las pruebas): unión discriminada por `kind`. */
export const memoryInputSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("PREFERENCE"), title: text(120), data: preferenceDataSchema, importance: importanceSchema.optional(), pinned: z.boolean().optional() }),
  z.object({ kind: z.literal("FINANCE"), title: text(120), data: financeDataSchema, importance: importanceSchema.optional(), pinned: z.boolean().optional() }),
  z.object({ kind: z.literal("WEBSITE"), title: text(120), data: websiteDataSchema, importance: importanceSchema.optional(), pinned: z.boolean().optional() }),
  z.object({ kind: z.literal("GOAL"), title: text(120), data: goalDataSchema, importance: importanceSchema.optional(), pinned: z.boolean().optional() }),
  z.object({ kind: z.literal("NOTE"), title: text(120), data: noteDataSchema, importance: importanceSchema.optional(), pinned: z.boolean().optional() }),
]);

/** Un recuerdo como lo ve la pantalla (JSON, fechas en ISO). */
export interface MemoryView {
  id: string;
  /** Referencia corta (8 caracteres) con la que Omni lo nombra en el chat. */
  ref: string;
  kind: MemoryKind;
  title: string;
  /** La frase que lo resume, igual a la que recibe Omni. */
  summary: string;
  importance: Importance;
  pinned: boolean;
  source: MemorySource;
  updatedAt: string;
}

// ── Contexto vivo (de los otros módulos, solo lectura) ───────────────────────

/** Meta que la persona sigue en la pantalla Metas (tabla goals). */
export interface TrackedGoalFact {
  title: string;
  current: number;
  target: number | null;
  currency: string;
  monthly: number | null;
  targetDate: string | null;
}

/** El último análisis de Finanzas (ya validado cifra por cifra cuando se generó). */
export interface FinanceSnapshotFact {
  /** AAAA-MM-DD del análisis. */
  date: string;
  health: string;
  headline: string;
  monthlySavingsPotential: number;
  currency: string;
}

/** Algo que pasó: una acción aprobada o rechazada, o una conversación anterior. */
export interface ActivityFact {
  /** AAAA-MM-DD. */
  date: string;
  text: string;
}

export interface LiveContext {
  goals: TrackedGoalFact[];
  finance: FinanceSnapshotFact | null;
  activity: ActivityFact[];
}
