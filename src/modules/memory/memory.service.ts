import "server-only";
import type { AgentMemory as MemoryRow, Prisma } from "@/generated/prisma/client";
import type { ActionStatus, ActionType } from "@/generated/prisma/enums";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { Errors } from "@/lib/errors";
import { money } from "@/lib/format";
import { log } from "@/lib/log";
import { isUuid } from "@/lib/validation";
import {
  MAX_MEMORIES,
  asImportance,
  assertNotSensitive,
  dedupeKeyFor,
  pickEvictable,
  rankMemories,
  refMatches,
  renderMemoryContext,
  tokenize,
  validateMemoryInput,
  type MemoryContext,
  type RankedMemory,
} from "./memory.rules";
import {
  MEMORY_DATA_SCHEMAS,
  type ActivityFact,
  type Importance,
  type LiveContext,
  type MemoryBase,
  type MemoryInput,
  type MemoryKind,
  type MemoryRecord,
  type MemorySource,
} from "./memory.types";

// Memoria del agente: guarda y recupera lo que Omni sabe de cada persona (preferencias, finanzas, páginas web que
// creó, metas y otros datos) y arma, en cada turno del chat, el bloque de contexto con lo más relevante, junto con
// lo que muestran los otros módulos (metas que sigue, último análisis de sus cuentas, lo que aprobó hace poco).

const DAY_MS = 86_400_000;
const ACTIVITY_DAYS = 30;

// ── Filas ↔ recuerdos tipados ────────────────────────────────────────────────

/** Convierte una fila en un recuerdo tipado, validando `data` con el esquema de su categoría. */
export function fromRow(row: MemoryRow): MemoryRecord {
  const base: MemoryBase = {
    id: row.id,
    title: row.title,
    importance: asImportance(row.importance) ?? 2,
    pinned: row.pinned,
    source: row.source,
    useCount: row.useCount,
    lastUsedAt: row.lastUsedAt,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
  switch (row.kind) {
    case "PREFERENCE": {
      const parsed = MEMORY_DATA_SCHEMAS.PREFERENCE.safeParse(row.data);
      if (parsed.success) return { ...base, kind: "PREFERENCE", data: parsed.data };
      break;
    }
    case "FINANCE": {
      const parsed = MEMORY_DATA_SCHEMAS.FINANCE.safeParse(row.data);
      if (parsed.success) return { ...base, kind: "FINANCE", data: parsed.data };
      break;
    }
    case "WEBSITE": {
      const parsed = MEMORY_DATA_SCHEMAS.WEBSITE.safeParse(row.data);
      if (parsed.success) return { ...base, kind: "WEBSITE", data: parsed.data };
      break;
    }
    case "GOAL": {
      const parsed = MEMORY_DATA_SCHEMAS.GOAL.safeParse(row.data);
      if (parsed.success) return { ...base, kind: "GOAL", data: parsed.data };
      break;
    }
    case "NOTE": {
      const parsed = MEMORY_DATA_SCHEMAS.NOTE.safeParse(row.data);
      if (parsed.success) return { ...base, kind: "NOTE", data: parsed.data };
      break;
    }
  }
  // Datos de una versión anterior que ya no cumplen el esquema: se muestran como nota para poder verlos y borrarlos.
  log.warn("memory.invalid_row", { id: row.id, kind: row.kind });
  return { ...base, kind: "NOTE", data: { text: row.title, about: "otro" } };
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2002";
}

// ── Buscar por id o ref ──────────────────────────────────────────────────────

/** Encuentra un recuerdo de la persona por su id o por su ref de 8 caracteres. */
export async function findMemoryRow(userId: string, idOrRef: string): Promise<MemoryRow> {
  const value = idOrRef.trim();
  if (isUuid(value)) {
    const row = await prisma.agentMemory.findFirst({ where: { id: value, userId } });
    if (!row) throw Errors.notFound("El recuerdo");
    return row;
  }
  const ids = await prisma.agentMemory.findMany({ where: { userId }, select: { id: true } });
  const matches = ids.filter((r) => refMatches(r.id, value));
  if (matches.length === 0) throw Errors.notFound("El recuerdo");
  if (matches.length > 1) throw Errors.badRequest("Esa referencia coincide con varios recuerdos; usa el id completo.");
  const row = await prisma.agentMemory.findUnique({ where: { id: matches[0].id } });
  if (!row) throw Errors.notFound("El recuerdo");
  return row;
}

// ── Guardar ──────────────────────────────────────────────────────────────────

export interface RememberOptions {
  source: MemorySource;
  /** Conversación donde se guardó (solo como referencia). */
  conversationId?: string | null;
  /** Actualiza este recuerdo (id o ref) en lugar de buscarlo por título. */
  ref?: string | null;
  now?: Date;
}

export interface RememberResult {
  memory: MemoryRecord;
  /** false: ya existía y se actualizó. */
  created: boolean;
  /** Recuerdo que se descartó para hacer lugar (memoria llena). */
  evicted: MemoryRecord | null;
}

/**
 * Guarda un recuerdo. Si ya hay uno igual (misma categoría y título, o la misma dirección web), lo actualiza en vez
 * de duplicarlo. Rechaza tarjetas, contraseñas, llaves, documentos y datos de salud. Con la memoria llena, descarta
 * el recuerdo menos útil que guardó Omni; si todos son de la persona o están fijados, pide borrar alguno.
 */
export async function rememberMemory(userId: string, input: MemoryInput, opts: RememberOptions, attempt = 0): Promise<RememberResult> {
  const now = opts.now ?? new Date();
  const valid = validateMemoryInput(input);
  assertNotSensitive(valid);
  const dedupeKey = dedupeKeyFor(valid);
  const data = valid.data as Prisma.InputJsonValue;

  const existing = opts.ref
    ? await findMemoryRow(userId, opts.ref)
    : await prisma.agentMemory.findUnique({ where: { userId_dedupeKey: { userId, dedupeKey } } });

  if (existing) {
    if (opts.ref) {
      // Al editar por ref, si el nuevo título ya existía en otro recuerdo, ese duplicado sobra.
      const duplicate = await prisma.agentMemory.findFirst({ where: { userId, dedupeKey, NOT: { id: existing.id } }, select: { id: true } });
      if (duplicate) await prisma.agentMemory.delete({ where: { id: duplicate.id } });
    }
    const row = await prisma.agentMemory.update({
      where: { id: existing.id },
      data: {
        kind: valid.kind,
        title: valid.title,
        data,
        dedupeKey,
        // Lo que no se indica se conserva (una actualización de Omni no baja la importancia ni desfija).
        importance: input.importance ?? existing.importance,
        pinned: input.pinned ?? existing.pinned,
        expiresAt: input.expiresAt === undefined ? existing.expiresAt : input.expiresAt,
        source: opts.source === "USER" ? "USER" : existing.source,
        conversationId: opts.conversationId ?? existing.conversationId,
      },
    });
    await audit({ userId, actor: actorOf(opts.source), action: "memory.updated", entity: "agent_memory", entityId: row.id, metadata: { kind: row.kind } });
    return { memory: fromRow(row), created: false, evicted: null };
  }

  let evicted: MemoryRecord | null = null;
  const count = await prisma.agentMemory.count({ where: { userId } });
  if (count >= MAX_MEMORIES) {
    const all = (await prisma.agentMemory.findMany({ where: { userId } })).map(fromRow);
    const victim = pickEvictable(all, now);
    if (!victim) {
      throw Errors.conflict(`Omni ya recuerda ${MAX_MEMORIES} cosas. Borra alguna en Cuenta → Lo que Omni recuerda.`);
    }
    await prisma.agentMemory.delete({ where: { id: victim.id } });
    evicted = victim;
  }

  try {
    const row = await prisma.agentMemory.create({
      data: {
        userId,
        kind: valid.kind,
        title: valid.title,
        data,
        dedupeKey,
        importance: valid.importance,
        pinned: valid.pinned,
        source: opts.source,
        conversationId: opts.conversationId ?? null,
        expiresAt: valid.expiresAt,
      },
    });
    await audit({ userId, actor: actorOf(opts.source), action: "memory.created", entity: "agent_memory", entityId: row.id, metadata: { kind: row.kind } });
    return { memory: fromRow(row), created: true, evicted };
  } catch (error) {
    // Otra petición guardó el mismo recuerdo al mismo tiempo: se actualiza ese.
    if (isUniqueViolation(error) && attempt === 0) return rememberMemory(userId, input, opts, 1);
    throw error;
  }
}

function actorOf(source: MemorySource): "user" | "agent" | "system" {
  return source === "USER" ? "user" : source === "AGENT" ? "agent" : "system";
}

/** Fija o suelta un recuerdo, o cambia su importancia (desde Cuenta). */
export async function setMemoryFlags(
  userId: string,
  idOrRef: string,
  patch: { pinned?: boolean; importance?: Importance },
): Promise<MemoryRecord> {
  const row = await findMemoryRow(userId, idOrRef);
  const updated = await prisma.agentMemory.update({
    where: { id: row.id },
    data: { ...(patch.pinned === undefined ? {} : { pinned: patch.pinned }), ...(patch.importance === undefined ? {} : { importance: patch.importance }) },
  });
  return fromRow(updated);
}

// ── Olvidar ──────────────────────────────────────────────────────────────────

/** Borra un recuerdo (de verdad, no se archiva). */
export async function forgetMemory(
  userId: string,
  idOrRef: string,
  actor: MemorySource,
): Promise<{ id: string; kind: MemoryKind; title: string }> {
  const row = await findMemoryRow(userId, idOrRef);
  await prisma.agentMemory.delete({ where: { id: row.id } });
  await audit({ userId, actor: actorOf(actor), action: "memory.forgotten", entity: "agent_memory", entityId: row.id, metadata: { kind: row.kind } });
  return { id: row.id, kind: row.kind, title: row.title };
}

/** Borra toda la memoria de la persona. */
export async function forgetAllMemories(userId: string): Promise<{ removed: number }> {
  const { count } = await prisma.agentMemory.deleteMany({ where: { userId } });
  await audit({ userId, actor: "user", action: "memory.cleared", entity: "agent_memory", metadata: { count } });
  return { removed: count };
}

// ── Leer y buscar ────────────────────────────────────────────────────────────

/** Todos los recuerdos vigentes: primero los fijados, después los más recientes. Los vencidos se borran al pasar. */
export async function listMemories(userId: string, opts: { kinds?: MemoryKind[]; now?: Date } = {}): Promise<MemoryRecord[]> {
  const now = opts.now ?? new Date();
  await prisma.agentMemory.deleteMany({ where: { userId, expiresAt: { lte: now } } });
  const rows = await prisma.agentMemory.findMany({
    where: { userId, ...(opts.kinds?.length ? { kind: { in: opts.kinds } } : {}) },
    orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }],
    take: MAX_MEMORIES,
  });
  return rows.map(fromRow);
}

/** Marca recuerdos como usados (sirven para decidir cuál descartar cuando la memoria se llena). */
async function touchMemories(ids: string[], now: Date): Promise<void> {
  if (ids.length === 0) return;
  await prisma.agentMemory.updateMany({ where: { id: { in: ids } }, data: { lastUsedAt: now, useCount: { increment: 1 } } });
}

/**
 * Busca en la memoria: con texto, solo lo que coincide (por palabras, sin tildes ni plurales); sin texto, lo más
 * relevante (fijado, importante y reciente).
 */
export async function recallMemories(
  userId: string,
  opts: { query?: string; kinds?: MemoryKind[]; limit?: number; now?: Date } = {},
): Promise<RankedMemory[]> {
  const now = opts.now ?? new Date();
  const limit = Math.min(Math.max(opts.limit ?? 10, 1), 50);
  const memories = await listMemories(userId, { kinds: opts.kinds, now });
  const ranked = rankMemories(memories, { query: opts.query, now });
  const searching = tokenize(opts.query ?? "").length > 0;
  const result = (searching ? ranked.filter((r) => r.match > 0) : ranked).slice(0, limit);
  await touchMemories(
    result.map((r) => r.memory.id),
    now,
  );
  return result;
}

// ── Contexto para el chat ────────────────────────────────────────────────────

const ACTION_LABEL: Record<ActionType, string> = {
  CANCEL_SUBSCRIPTION: "Cancelar suscripción",
  SEND_EMAIL: "Correo",
  CREATE_CALENDAR_EVENT: "Evento",
  SUBMIT_FORM: "Formulario",
  PURCHASE: "Compra",
  PUBLISH_SITE: "Publicar página web",
};

const STATUS_LABEL: Partial<Record<ActionStatus, string>> = {
  APPROVED: "la aprobó",
  EXECUTED: "la aprobó y se hizo",
  REJECTED: "la rechazó",
  FAILED: "la aprobó, pero falló",
};

/** AAAA-MM-DD en la zona horaria de la persona. */
function localDate(date: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

/** Lo que muestran los otros módulos: metas que sigue, último análisis de sus cuentas y lo que pasó hace poco. */
export async function loadLiveContext(
  userId: string,
  opts: { now: Date; timeZone: string; excludeConversationId?: string },
): Promise<LiveContext> {
  const since = new Date(opts.now.getTime() - ACTIVITY_DAYS * DAY_MS);
  const [goals, analysis, actions, conversations] = await Promise.all([
    prisma.goal.findMany({
      where: { userId, status: "ACTIVE" },
      orderBy: [{ targetDate: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }],
      take: 5,
      select: { title: true, currentAmount: true, targetAmount: true, monthlyContribution: true, currency: true, targetDate: true },
    }),
    prisma.financialAnalysis.findFirst({
      where: { userId },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true, health: true, headline: true, totalMonthlySavings: true, currency: true },
    }),
    prisma.agentAction.findMany({
      where: { userId, status: { in: ["APPROVED", "EXECUTED", "REJECTED", "FAILED"] }, updatedAt: { gte: since } },
      orderBy: { updatedAt: "desc" },
      take: 5,
      select: { type: true, status: true, title: true, amount: true, currency: true, updatedAt: true },
    }),
    prisma.conversation.findMany({
      where: {
        userId,
        archived: false,
        updatedAt: { gte: since },
        ...(opts.excludeConversationId ? { id: { not: opts.excludeConversationId } } : {}),
      },
      orderBy: { updatedAt: "desc" },
      take: 3,
      select: { title: true, updatedAt: true },
    }),
  ]);

  const activity: (ActivityFact & { at: number })[] = [
    ...actions.map((a) => ({
      at: a.updatedAt.getTime(),
      date: localDate(a.updatedAt, opts.timeZone),
      text: `${ACTION_LABEL[a.type]}: ${a.title}${a.amount !== null ? ` (${money(Number(a.amount), a.currency ?? "USD")})` : ""}; ${STATUS_LABEL[a.status] ?? a.status.toLowerCase()}.`,
    })),
    ...conversations
      .filter((c) => c.title)
      .map((c) => ({ at: c.updatedAt.getTime(), date: localDate(c.updatedAt, opts.timeZone), text: `Habló con Omni de «${c.title}».` })),
  ];

  return {
    goals: goals.map((g) => ({
      title: g.title,
      current: Number(g.currentAmount),
      target: g.targetAmount === null ? null : Number(g.targetAmount),
      currency: g.currency,
      monthly: g.monthlyContribution === null ? null : Number(g.monthlyContribution),
      targetDate: g.targetDate ? g.targetDate.toISOString().slice(0, 10) : null,
    })),
    finance: analysis
      ? {
          date: localDate(analysis.createdAt, opts.timeZone),
          health: analysis.health,
          headline: analysis.headline,
          monthlySavingsPotential: Number(analysis.totalMonthlySavings),
          currency: analysis.currency,
        }
      : null,
    activity: activity
      .sort((a, b) => b.at - a.at)
      .slice(0, 6)
      .map(({ date, text }) => ({ date, text })),
  };
}

/**
 * El bloque de memoria para el prompt de sistema de este turno: los recuerdos más relevantes para el mensaje y lo
 * que muestran los módulos, dentro de un presupuesto de caracteres. Los recuerdos que tienen que ver con el mensaje
 * se marcan como usados.
 */
export async function buildAgentMemory(
  userId: string,
  opts: { query?: string; now?: Date; timeZone: string; excludeConversationId?: string; budgetChars?: number },
): Promise<MemoryContext> {
  const now = opts.now ?? new Date();
  const [memories, live] = await Promise.all([
    listMemories(userId, { now }),
    loadLiveContext(userId, { now, timeZone: opts.timeZone, excludeConversationId: opts.excludeConversationId }),
  ]);
  const context = renderMemoryContext(memories, live, { query: opts.query, now, budgetChars: opts.budgetChars });
  await touchMemories(context.matchedIds, now);
  return context;
}
