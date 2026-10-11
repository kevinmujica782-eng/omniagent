import "server-only";
import type { Assistant } from "@/generated/prisma/client";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { Errors } from "@/lib/errors";
import { isUuid } from "@/lib/validation";
import {
  DOT_LIMITS,
  toDotModules,
  type AssistantCreateInput,
  type AssistantUpdateInput,
  type AssistantView,
} from "./assistants.types";

// Dots de cada persona: crearlos, listarlos, editarlos, marcar el de por defecto y archivarlos. Solo el servidor
// toca la tabla assistants; la persona lee los suyos con RLS. El Dot por defecto (no archivado) es el que usa el
// agente en el chat. Un trigger de la base garantiza que solo haya uno por defecto por persona.

function toView(row: Assistant): AssistantView {
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    personality: row.personality,
    instructions: row.instructions,
    modules: toDotModules(row.modules),
    isDefault: row.isDefault,
    createdAt: row.createdAt.toISOString(),
  };
}

async function findOwned(userId: string, id: string): Promise<Assistant> {
  if (!isUuid(id)) throw Errors.notFound("El asistente");
  const row = await prisma.assistant.findFirst({ where: { id, userId } });
  if (!row) throw Errors.notFound("El asistente");
  return row;
}

/** Los Dots activos de la persona (los archivados no se muestran), el de por defecto primero. */
export async function listAssistants(userId: string): Promise<AssistantView[]> {
  const rows = await prisma.assistant.findMany({
    where: { userId, archivedAt: null },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
  });
  return rows.map(toView);
}

/** El Dot que usa el agente: el de por defecto no archivado, o null si la persona no tiene ninguno. */
export async function activeAssistant(userId: string): Promise<AssistantView | null> {
  const row = await prisma.assistant.findFirst({ where: { userId, isDefault: true, archivedAt: null } });
  return row ? toView(row) : null;
}

export async function createAssistant(userId: string, input: AssistantCreateInput): Promise<AssistantView> {
  const active = await prisma.assistant.count({ where: { userId, archivedAt: null } });
  if (active >= DOT_LIMITS.perUser) {
    throw Errors.badRequest(`Llegaste al máximo de ${DOT_LIMITS.perUser} asistentes. Archiva alguno para crear otro.`);
  }
  // El primer Dot de la persona queda por defecto aunque no lo pida: siempre hay uno activo para el chat.
  const isDefault = input.isDefault || active === 0;
  try {
    const row = await prisma.assistant.create({
      data: {
        userId,
        name: input.name,
        role: input.role,
        personality: input.personality,
        instructions: input.instructions,
        modules: input.modules,
        isDefault,
      },
    });
    await audit({ userId, actor: "user", action: "assistant.created", entity: "assistant", entityId: row.id });
    return toView(row);
  } catch (error) {
    if (isUniqueViolation(error)) throw Errors.conflict("Ya tienes un asistente con ese nombre.");
    throw error;
  }
}

export async function updateAssistant(userId: string, id: string, input: AssistantUpdateInput): Promise<AssistantView> {
  const current = await findOwned(userId, id);
  if (input.archived === true && current.isDefault) {
    throw Errors.badRequest("No puedes archivar tu asistente por defecto. Marca otro por defecto primero.");
  }
  try {
    const row = await prisma.assistant.update({
      where: { id: current.id },
      data: {
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.role === undefined ? {} : { role: input.role }),
        ...(input.personality === undefined ? {} : { personality: input.personality }),
        ...(input.instructions === undefined ? {} : { instructions: input.instructions }),
        ...(input.modules === undefined ? {} : { modules: input.modules }),
        ...(input.isDefault ? { isDefault: true } : {}), // el trigger desmarca los demás
        ...(input.archived === undefined ? {} : { archivedAt: input.archived ? new Date() : null }),
      },
    });
    return toView(row);
  } catch (error) {
    if (isUniqueViolation(error)) throw Errors.conflict("Ya tienes un asistente con ese nombre.");
    throw error;
  }
}

/** Archiva un Dot (no se borra: el chat viejo puede haberlo usado). El de por defecto no se puede archivar. */
export async function archiveAssistant(userId: string, id: string): Promise<{ id: string }> {
  const current = await findOwned(userId, id);
  if (current.isDefault) {
    throw Errors.badRequest("No puedes archivar tu asistente por defecto. Marca otro por defecto primero.");
  }
  if (current.archivedAt) return { id: current.id };
  await prisma.assistant.update({ where: { id: current.id }, data: { archivedAt: new Date() } });
  await audit({ userId, actor: "user", action: "assistant.archived", entity: "assistant", entityId: current.id });
  return { id: current.id };
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2002";
}
