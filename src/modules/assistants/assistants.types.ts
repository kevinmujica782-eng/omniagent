// Dots: asistentes personalizados de cada persona (nombre, rol, personalidad, instrucciones y áreas de enfoque).
// Puro (solo zod y tipos): lo usan el servidor, la API, la pantalla y la vista previa. Sin dependencias de servidor.
import { z } from "zod";
import type { AgentModule } from "@/generated/prisma/enums";

// Áreas que puede enfocar un Dot. GENERAL no se ofrece: un Dot sin áreas ya es general.
export const DOT_MODULES = ["FINANCE", "PROCEDURES", "CONCIERGE", "GOALS"] as const;
export type DotModule = (typeof DOT_MODULES)[number];

export const DOT_MODULE_LABEL: Record<DotModule, string> = {
  FINANCE: "Finanzas",
  PROCEDURES: "Trámites",
  CONCIERGE: "Compras",
  GOALS: "Metas",
};

export const DOT_LIMITS = { name: 40, role: 80, personality: 300, instructions: 4000, perUser: 20 } as const;

const name = z.string().trim().min(1, "Ponle un nombre").max(DOT_LIMITS.name);
const role = z.string().trim().min(1, "Dile qué hace").max(DOT_LIMITS.role);
const personality = z.string().trim().max(DOT_LIMITS.personality);
const instructions = z.string().trim().max(DOT_LIMITS.instructions);
const modules = z.array(z.enum(DOT_MODULES)).max(DOT_MODULES.length);

/** Crear un Dot. */
export const assistantCreateSchema = z.object({
  name,
  role,
  personality: personality.default(""),
  instructions: instructions.default(""),
  modules: modules.default([]),
  isDefault: z.boolean().default(false),
});
export type AssistantCreateInput = z.output<typeof assistantCreateSchema>;

/** Editar un Dot: todo opcional, pero al menos un campo. */
export const assistantUpdateSchema = z
  .object({
    name: name.optional(),
    role: role.optional(),
    personality: personality.optional(),
    instructions: instructions.optional(),
    modules: modules.optional(),
    isDefault: z.literal(true).optional(), // marcar por defecto; no se "desmarca" suelto, se marca otro
    archived: z.boolean().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, "Indica algo que cambiar");
export type AssistantUpdateInput = z.output<typeof assistantUpdateSchema>;

/** Lo que ve la pantalla. */
export type AssistantView = {
  id: string;
  name: string;
  role: string;
  personality: string;
  instructions: string;
  modules: DotModule[];
  isDefault: boolean;
  createdAt: string;
};

/** Solo las áreas que la pantalla ofrece (descarta GENERAL u otros valores que no se muestran). */
export function toDotModules(modules: AgentModule[]): DotModule[] {
  return modules.filter((m): m is DotModule => (DOT_MODULES as readonly string[]).includes(m));
}
