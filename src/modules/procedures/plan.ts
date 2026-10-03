import "server-only";
import type { MailAttachment, MailMessage, Prisma, Task } from "@/generated/prisma/client";
import type { TaskPriority, TaskType } from "@/generated/prisma/enums";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { Errors } from "@/lib/errors";
import { isUuid } from "@/lib/validation";
import type { ProcedureView, TaskStatusId } from "@/types/cards";
import { busyBlocks, cancelTaskEvents, createCalendarEvents, OPEN_STATUSES } from "./calendar/calendar.service";
import { suggestSchedule, type BusyBlock, type PlanKind } from "./calendar/scheduler";
import { documentsForTasks, extractForm, fillForm } from "./documents/documents.service";
import type { FillValue } from "./documents/fill";
import { downloadAttachment } from "./mail/mailbox";
import type { TriageResult } from "./mail/triage/rules";
import {
  calendarEventsFor,
  draftFromTriage,
  DURATION_MINUTES,
  factsFrom,
  nextDateOf,
  planKindForTaskType,
  priorityFor,
  procedureView,
  readPlanMeta,
  stepsFor,
  toStoredEvent,
  type PlanEvent,
  type PlanFacts,
  type PlanMeta,
} from "./plan-rules";
import { addLocalDays, atLocalTime, parseLocalDateTime, safeTimeZone } from "./time/tz";

// Plan de cada trámite: Omni lo detecta (en un correo o en el chat), sugiere cuándo hacerlo y cuándo avisar
// sin chocar con el calendario, y el usuario lo confirma con un toque. Al confirmar se crean la cita,
// el bloque para hacerlo y la fecha límite en su calendario (y en el feed ICS).

const DAY_MS = 86_400_000;
/** Ventana del calendario que se revisa al proponer fechas. */
const PLAN_HORIZON_DAYS = 60;

export interface PlanOverrides {
  title?: string;
  /** null = sin fecha límite. */
  due?: { at: Date; hasTime: boolean } | null;
  plannedAt?: Date | null;
  remindAt?: Date | null;
}

const VIEW_INCLUDE = {
  mailMessage: { select: { fromName: true, fromEmail: true, subject: true, receivedAt: true } },
  calendarEvents: { where: { status: "confirmed" }, select: { kind: true, syncStatus: true } },
} as const;

type TaskWithRelations = Prisma.TaskGetPayload<{ include: typeof VIEW_INCLUDE }>;

const asJson = (meta: PlanMeta) => meta as unknown as Prisma.InputJsonValue;

export async function userTimeZone(userId: string): Promise<string> {
  const profile = await prisma.profile.findUnique({ where: { id: userId }, select: { timezone: true } });
  return safeTimeZone(profile?.timezone);
}

export async function busyWindow(userId: string, now: Date): Promise<BusyBlock[]> {
  return busyBlocks(userId, now, new Date(now.getTime() + PLAN_HORIZON_DAYS * DAY_MS));
}

async function ownTask(userId: string, taskId: string): Promise<Task> {
  if (!isUuid(taskId)) throw Errors.notFound("El trámite");
  const task = await prisma.task.findFirst({ where: { id: taskId, userId } });
  if (!task) throw Errors.notFound("El trámite");
  return task;
}

const isPdf = (a: { fileName: string; mimeType: string }) => a.mimeType === "application/pdf" || /\.pdf$/i.test(a.fileName);

// ── Sugerencias desde el correo ──────────────────────────────────────────────

export interface SuggestContext {
  now: Date;
  timeZone: string;
  busy: BusyBlock[];
}

/**
 * Crea (o actualiza, si sigue sin confirmar) el trámite sugerido de un correo: título, fechas propuestas,
 * pasos y, si trae un formulario en PDF, lo descarga y lo deja prellenado con reglas (la IA lo lee al abrirlo).
 * Un trámite que el usuario ya confirmó o descartó no se vuelve a tocar.
 */
export async function suggestFromMessage(
  userId: string,
  message: MailMessage & { attachments: MailAttachment[] },
  triage: TriageResult,
  ctx: SuggestContext,
): Promise<{ task: Task; created: boolean } | null> {
  const draft = draftFromTriage(triage, message.subject, ctx);
  if (!draft) return null;
  const existing = await prisma.task.findUnique({ where: { userId_mailMessageId: { userId, mailMessageId: message.id } } });
  if (existing && existing.status !== "SUGGESTED") return null;

  const data = {
    title: draft.title,
    type: draft.type as TaskType,
    priority: draft.priority as TaskPriority,
    notes: draft.notes,
    dueAt: draft.dueAt,
    plannedAt: draft.plannedAt,
    remindAt: draft.remindAt,
    metadata: asJson(draft.meta),
  };

  let task: Task;
  let created = false;
  if (existing) {
    // Solo si sigue sugerido: si el usuario lo confirmó mientras tanto, se respeta.
    await prisma.task.updateMany({ where: { id: existing.id, status: "SUGGESTED" }, data });
    task = (await prisma.task.findUnique({ where: { id: existing.id } })) ?? existing;
  } else {
    try {
      task = await prisma.task.create({
        data: { userId, status: "SUGGESTED", source: "email", mailMessageId: message.id, ...data },
      });
      created = true;
    } catch (error) {
      // Otra sincronización lo creó al mismo tiempo (índice único usuario + correo).
      const again = await prisma.task.findUnique({ where: { userId_mailMessageId: { userId, mailMessageId: message.id } } });
      if (!again) throw error;
      return { task: again, created: false };
    }
  }

  if (triage.hasForm) {
    for (const attachment of message.attachments.filter(isPdf).slice(0, 3)) {
      try {
        const doc = await downloadAttachment(userId, attachment.id, { taskId: task.id });
        if (!doc.extractedAt) await extractForm(userId, doc.id); // reglas: rápido y sin costo
      } catch (error) {
        console.error("[procedures] no se pudo preparar el adjunto", attachment.id, error);
      }
    }
  }
  return { task, created };
}

// ── Fechas: confirmar, ajustar, reprogramar ──────────────────────────────────

interface ResolvedPlan {
  title: string;
  due: { at: Date; hasTime: boolean } | null;
  plannedAt: Date | null;
  plannedEndAt: Date | null;
  remindAt: Date | null;
  urgent: boolean;
  meta: PlanMeta;
  facts: PlanFacts;
}

/**
 * Fechas finales de un trámite: las que eligió el usuario o, si cambió la fecha límite, si la sugerencia
 * quedó vieja (el bloque ya pasó) o si se pide explícitamente, unas nuevas calculadas con su calendario.
 */
async function resolvePlan(
  userId: string,
  task: Task,
  meta: PlanMeta,
  overrides: PlanOverrides,
  now: Date,
  timeZone: string,
  opts: { recompute?: boolean } = {},
): Promise<ResolvedPlan> {
  const title = overrides.title?.trim().slice(0, 140) || task.title;
  const due = overrides.due !== undefined ? overrides.due : task.dueAt ? { at: task.dueAt, hasTime: meta.dueHasTime } : null;
  const next: PlanMeta = { ...meta, dueHasTime: due?.hasTime ?? false };
  let plannedAt = task.plannedAt;
  let plannedEndAt = meta.plannedEndAt ? new Date(meta.plannedEndAt) : null;
  let remindAt = task.remindAt;
  const eventAt = meta.event ? new Date(meta.event.startsAt) : null;
  let urgent = false;

  const dueChanged = overrides.due !== undefined && (overrides.due?.at.getTime() ?? null) !== (task.dueAt?.getTime() ?? null);
  const stale =
    (plannedAt !== null && plannedAt.getTime() < now.getTime() + 15 * 60_000) || (remindAt !== null && remindAt < now);

  if (overrides.plannedAt !== undefined) {
    plannedAt = overrides.plannedAt;
    plannedEndAt = plannedAt ? new Date(plannedAt.getTime() + Math.max(15, DURATION_MINUTES[meta.kind]) * 60_000) : null;
    remindAt = overrides.remindAt !== undefined ? overrides.remindAt : (plannedAt ?? remindAt);
    Object.assign(next, { basis: "user" as const, skipped: null });
  } else if (opts.recompute || dueChanged || stale) {
    const schedule = suggestSchedule({
      now,
      timeZone,
      kind: meta.kind,
      dueAt: due?.at ?? null,
      eventAt,
      durationMinutes: DURATION_MINUTES[meta.kind] || 15,
      busy: await busyWindow(userId, now),
    });
    plannedAt = schedule.plannedAt;
    plannedEndAt = schedule.plannedEndAt;
    remindAt = overrides.remindAt !== undefined ? overrides.remindAt : schedule.remindAt;
    urgent = schedule.urgent;
    Object.assign(next, { basis: schedule.basis, lead: schedule.lead, skipped: schedule.skipped });
  } else if (overrides.remindAt !== undefined) {
    remindAt = overrides.remindAt;
  }

  const ref = meta.kind === "appointment" || meta.kind === "event" ? eventAt : (due?.at ?? null);
  urgent ||= ref !== null && ref > now && ref.getTime() - now.getTime() < 48 * 3_600_000;
  next.plannedEndAt = plannedEndAt?.toISOString() ?? null;
  const facts = factsFrom(title, due, next);
  next.steps = stepsFor(facts, timeZone);
  return { title, due, plannedAt, plannedEndAt, remindAt, urgent, meta: next, facts };
}

/**
 * Confirmación de un toque: el trámite sugerido pasa a activo con sus fechas y se agenda en el calendario
 * (cita, bloque para hacerlo y fecha límite). Un segundo toque no duplica nada.
 */
export async function confirmProcedure(
  userId: string,
  taskId: string,
  overrides: PlanOverrides = {},
  opts: { skipFocus?: boolean; status?: "PENDING" | "IN_PROGRESS"; actor?: "user" | "agent" } = {},
): Promise<ProcedureView> {
  const task = await ownTask(userId, taskId);
  if (task.status === "CANCELED") throw Errors.conflict("Descartaste este trámite. Restáuralo para confirmarlo.");
  if (task.status !== "SUGGESTED") return getProcedure(userId, task.id);

  const now = new Date();
  const timeZone = await userTimeZone(userId);
  const plan = await resolvePlan(userId, task, readPlanMeta(task.metadata, task.type), overrides, now, timeZone);
  const plannedAt = opts.skipFocus ? null : plan.plannedAt;

  const claimed = await prisma.task.updateMany({
    where: { id: task.id, userId, status: "SUGGESTED" },
    data: {
      status: opts.status ?? "PENDING",
      confirmedAt: now,
      title: plan.title,
      dueAt: plan.due?.at ?? null,
      plannedAt,
      remindAt: plan.remindAt,
      remindedAt: null,
      priority: plan.urgent ? "HIGH" : task.priority,
      metadata: asJson(plan.meta),
    },
  });
  if (claimed.count === 0) return getProcedure(userId, task.id);

  const drafts = calendarEventsFor(plan.facts, { plannedAt, plannedEndAt: plan.plannedEndAt }, plan.meta.steps, now, timeZone);
  await createCalendarEvents(userId, task.id, drafts);
  await audit({
    userId,
    actor: opts.actor ?? "user",
    action: "procedure.confirmed",
    entity: "task",
    entityId: task.id,
    metadata: { events: drafts.map((d) => d.kind) },
  });
  return getProcedure(userId, task.id);
}

/**
 * Cambia fechas (o pide otra sugerencia con `recompute`). Si ya estaba confirmado, rehace en el calendario
 * el bloque y la fecha límite; la cita o evento original no se toca.
 */
export async function rescheduleProcedure(
  userId: string,
  taskId: string,
  overrides: PlanOverrides,
  opts: { recompute?: boolean } = {},
): Promise<ProcedureView> {
  const task = await ownTask(userId, taskId);
  if (task.status === "DONE" || task.status === "CANCELED") throw Errors.conflict("Este trámite ya está cerrado.");
  const now = new Date();
  const timeZone = await userTimeZone(userId);
  const plan = await resolvePlan(userId, task, readPlanMeta(task.metadata, task.type), overrides, now, timeZone, opts);

  await prisma.task.update({
    where: { id: task.id },
    data: {
      title: plan.title,
      dueAt: plan.due?.at ?? null,
      plannedAt: plan.plannedAt,
      remindAt: plan.remindAt,
      remindedAt: null,
      metadata: asJson(plan.meta),
    },
  });
  if (task.status !== "SUGGESTED") {
    await cancelTaskEvents(userId, task.id, ["FOCUS", "DEADLINE"]);
    const drafts = calendarEventsFor(plan.facts, { plannedAt: plan.plannedAt, plannedEndAt: plan.plannedEndAt }, plan.meta.steps, now, timeZone);
    await createCalendarEvents(userId, task.id, drafts.filter((d) => d.kind !== "EVENT"));
  }
  await audit({ userId, actor: "user", action: "procedure.rescheduled", entity: "task", entityId: task.id });
  return getProcedure(userId, task.id);
}

/** Descartar (o cancelar un trámite activo): sus eventos se quitan del calendario. */
export async function dismissProcedure(userId: string, taskId: string): Promise<ProcedureView> {
  const task = await ownTask(userId, taskId);
  if (task.status === "DONE") throw Errors.conflict("Este trámite ya está terminado.");
  if (task.status !== "CANCELED") {
    await prisma.task.update({ where: { id: task.id }, data: { status: "CANCELED", remindAt: null } });
    await cancelTaskEvents(userId, task.id);
    await audit({ userId, actor: "user", action: "procedure.dismissed", entity: "task", entityId: task.id });
  }
  return getProcedure(userId, task.id);
}

/** Deshacer un descarte: vuelve como sugerencia, con fechas recalculadas. */
export async function restoreProcedure(userId: string, taskId: string): Promise<ProcedureView> {
  const task = await ownTask(userId, taskId);
  if (task.status !== "CANCELED") return getProcedure(userId, task.id);
  const now = new Date();
  const timeZone = await userTimeZone(userId);
  const plan = await resolvePlan(userId, task, readPlanMeta(task.metadata, task.type), {}, now, timeZone, { recompute: true });
  await prisma.task.update({
    where: { id: task.id },
    data: {
      status: "SUGGESTED",
      confirmedAt: null,
      plannedAt: plan.plannedAt,
      remindAt: plan.remindAt,
      remindedAt: null,
      metadata: asJson(plan.meta),
    },
  });
  return getProcedure(userId, task.id);
}

/** Hecho: ya no hacen falta el bloque ni el aviso de la fecha límite (la cita, si la hay, se queda). */
export async function completeProcedure(userId: string, taskId: string, actor: "user" | "system" = "user"): Promise<ProcedureView> {
  const task = await ownTask(userId, taskId);
  if (task.status === "CANCELED") throw Errors.conflict("Este trámite está descartado.");
  if (task.status !== "DONE") {
    const now = new Date();
    await prisma.task.update({
      where: { id: task.id },
      data: { status: "DONE", completedAt: now, confirmedAt: task.confirmedAt ?? now, remindAt: null },
    });
    await cancelTaskEvents(userId, task.id, ["FOCUS", "DEADLINE"]);
    await audit({ userId, actor, action: "procedure.completed", entity: "task", entityId: task.id });
  }
  return getProcedure(userId, task.id);
}

export type SnoozePreset = "1h" | "tonight" | "tomorrow";

export function snoozeTime(preset: SnoozePreset, now: Date, timeZone: string): Date {
  if (preset === "tonight") {
    const tonight = atLocalTime(now, 20, 0, timeZone);
    if (tonight.getTime() > now.getTime() + 30 * 60_000) return tonight;
    return new Date(now.getTime() + 3_600_000);
  }
  if (preset === "tomorrow") return atLocalTime(addLocalDays(now, 1, timeZone), 9, 0, timeZone);
  return new Date(now.getTime() + 3_600_000);
}

/** "Recordarme más tarde": mueve solo el aviso en la app (el calendario no cambia). */
export async function snoozeProcedure(userId: string, taskId: string, preset: SnoozePreset): Promise<ProcedureView> {
  const task = await ownTask(userId, taskId);
  if (!OPEN_STATUSES.includes(task.status as (typeof OPEN_STATUSES)[number])) {
    throw Errors.conflict("Solo puedes posponer trámites activos.");
  }
  const remindAt = snoozeTime(preset, new Date(), await userTimeZone(userId));
  await prisma.task.update({ where: { id: task.id }, data: { remindAt, remindedAt: null } });
  return getProcedure(userId, task.id);
}

/** Trámite nuevo desde el chat o la app: queda sugerido con fechas propuestas (o confirmado si se pide). */
export async function createProcedure(
  userId: string,
  input: {
    title: string;
    type: TaskType;
    notes?: string | null;
    priority?: TaskPriority;
    due?: { at: Date; hasTime: boolean } | null;
    remindAt?: Date | null;
    event?: PlanEvent | null;
    source?: "user" | "agent";
    confirm?: boolean;
  },
): Promise<ProcedureView> {
  const now = new Date();
  const timeZone = await userTimeZone(userId);
  const kind: PlanKind = input.event ? "appointment" : planKindForTaskType(input.type);
  const due = input.due ?? null;
  const schedule = suggestSchedule({
    now,
    timeZone,
    kind,
    dueAt: due?.at ?? null,
    eventAt: input.event?.startsAt ?? null,
    durationMinutes: DURATION_MINUTES[kind] || 15,
    busy: await busyWindow(userId, now),
  });
  // Si el usuario dijo cuándo avisarle, ese es el momento para hacerlo.
  const userTime = input.remindAt && kind !== "appointment" ? input.remindAt : null;
  const plannedAt = userTime ?? schedule.plannedAt;
  const plannedEndAt = userTime ? new Date(userTime.getTime() + Math.max(15, DURATION_MINUTES[kind]) * 60_000) : schedule.plannedEndAt;
  const meta: PlanMeta = {
    v: 1,
    kind,
    category: null,
    summary: input.notes ?? null,
    dueHasTime: due?.hasTime ?? false,
    plannedEndAt: plannedEndAt?.toISOString() ?? null,
    basis: userTime ? "user" : schedule.basis,
    lead: schedule.lead,
    skipped: userTime ? null : schedule.skipped,
    event: toStoredEvent(input.event ?? null),
    replyTo: null,
    amount: null,
    currency: "USD",
    reference: null,
    steps: [],
    triageSource: null,
    hasForm: false,
    origin: null,
  };
  meta.steps = stepsFor(factsFrom(input.title, due, meta), timeZone);

  const task = await prisma.task.create({
    data: {
      userId,
      status: "SUGGESTED",
      source: input.source ?? "user",
      title: input.title.slice(0, 140),
      type: input.type,
      priority: input.priority ?? priorityFor(1, schedule.urgent, schedule.overdue),
      notes: input.notes ?? null,
      dueAt: due?.at ?? null,
      plannedAt,
      remindAt: input.remindAt ?? schedule.remindAt,
      metadata: asJson(meta),
    },
  });
  await audit({ userId, actor: input.source === "agent" ? "agent" : "user", action: "procedure.created", entity: "task", entityId: task.id });
  return input.confirm ? confirmProcedure(userId, task.id) : getProcedure(userId, task.id);
}

/**
 * Después de llenar un formulario: si el trámite seguía sugerido, cuenta como confirmado (se agenda la
 * fecha límite; el bloque para llenarlo ya no hace falta). Si estaba pendiente, pasa a "en curso".
 */
export async function noteFormFilled(userId: string, taskId: string | null): Promise<void> {
  if (!taskId) return;
  const task = await prisma.task.findFirst({ where: { id: taskId, userId }, select: { id: true, status: true } });
  if (!task) return;
  if (task.status === "SUGGESTED") {
    await confirmProcedure(userId, task.id, {}, { skipFocus: true, status: "IN_PROGRESS" });
  } else if (task.status === "PENDING") {
    await prisma.task.update({ where: { id: task.id }, data: { status: "IN_PROGRESS" } });
  }
}

/** Llenar el PDF y actualizar el trámite en un paso (lo usan la API y el agente). */
export async function fillProcedureForm(
  userId: string,
  documentId: string,
  input: { values: Record<string, FillValue>; saveToProfile: boolean },
) {
  const result = await fillForm(userId, documentId, input);
  await noteFormFilled(userId, result.taskId);
  return result;
}

/** Entrada de la app ("2026-10-02" o "2026-10-02T19:00" en hora local) → fechas del plan. */
export async function parsePlanOverrides(
  userId: string,
  raw: { title?: string; due?: string | null; plannedAt?: string | null; remindAt?: string | null },
): Promise<PlanOverrides> {
  const timeZone = await userTimeZone(userId);
  const now = Date.now();
  const out: PlanOverrides = {};
  if (raw.title !== undefined) out.title = raw.title;
  if (raw.due !== undefined) {
    if (raw.due === null || raw.due === "") out.due = null;
    else {
      const parsed = parseLocalDateTime(raw.due, timeZone);
      if (!parsed) throw Errors.badRequest("La fecha límite no es válida.");
      out.due = { at: parsed.hasTime ? parsed.date : atLocalTime(parsed.date, 23, 59, timeZone), hasTime: parsed.hasTime };
    }
  }
  for (const key of ["plannedAt", "remindAt"] as const) {
    const value = raw[key];
    if (value === undefined) continue;
    if (value === null || value === "") {
      out[key] = null;
      continue;
    }
    const parsed = parseLocalDateTime(value, timeZone);
    if (!parsed) throw Errors.badRequest(key === "plannedAt" ? "La fecha para hacerlo no es válida." : "La fecha del aviso no es válida.");
    const at = parsed.hasTime ? parsed.date : atLocalTime(parsed.date, 19, 0, timeZone);
    if (at.getTime() < now - 5 * 60_000) throw Errors.badRequest("Elige una fecha que aún no haya pasado.");
    out[key] = at;
  }
  return out;
}

// ── Vistas ───────────────────────────────────────────────────────────────────

async function toViews(userId: string, tasks: TaskWithRelations[]): Promise<ProcedureView[]> {
  if (tasks.length === 0) return [];
  const [timeZone, docs] = await Promise.all([userTimeZone(userId), documentsForTasks(userId, tasks.map((t) => t.id))]);
  const now = new Date();
  return tasks.map((task) =>
    procedureView(
      {
        taskId: task.id,
        status: task.status as TaskStatusId,
        type: task.type,
        title: task.title,
        notes: task.notes,
        dueAt: task.dueAt,
        plannedAt: task.plannedAt,
        remindAt: task.remindAt,
        confirmedAt: task.confirmedAt,
        completedAt: task.completedAt,
        metadata: task.metadata,
        mail: task.mailMessage,
        calendarSynced: task.calendarEvents.some((e) => e.syncStatus === "SYNCED"),
        documents: docs.get(task.id) ?? [],
      },
      now,
      timeZone,
    ),
  );
}

export async function getProcedure(userId: string, taskId: string): Promise<ProcedureView> {
  if (!isUuid(taskId)) throw Errors.notFound("El trámite");
  const task = await prisma.task.findFirst({ where: { id: taskId, userId }, include: VIEW_INCLUDE });
  if (!task) throw Errors.notFound("El trámite");
  const [view] = await toViews(userId, [task]);
  return view;
}

/** Vistas actuales de varios trámites (para refrescar tarjetas guardadas en el chat). */
export async function proceduresByIds(userId: string, taskIds: string[]): Promise<Map<string, ProcedureView>> {
  const ids = taskIds.filter(isUuid).slice(0, 100);
  if (ids.length === 0) return new Map();
  const tasks = await prisma.task.findMany({ where: { userId, id: { in: ids } }, include: VIEW_INCLUDE });
  const views = await toViews(userId, tasks);
  return new Map(views.map((v) => [v.taskId, v]));
}

export type ProcedureScope = "suggested" | "active" | "done" | "canceled";

export async function listProcedures(userId: string, scope: ProcedureScope, take = 40): Promise<ProcedureView[]> {
  const status =
    scope === "suggested"
      ? { equals: "SUGGESTED" as const }
      : scope === "active"
        ? { in: [...OPEN_STATUSES] }
        : scope === "done"
          ? { equals: "DONE" as const }
          : { equals: "CANCELED" as const };
  const tasks = await prisma.task.findMany({
    where: { userId, status },
    include: VIEW_INCLUDE,
    orderBy: scope === "done" || scope === "canceled" ? [{ updatedAt: "desc" }] : [{ createdAt: "desc" }],
    take,
  });
  const views = await toViews(userId, tasks);
  if (scope === "suggested" || scope === "active") views.sort((a, b) => nextDateOf(a) - nextDateOf(b));
  return views;
}

/** Para la navegación: trámites por confirmar y avisos que ya tocan. */
export async function procedureCounts(userId: string): Promise<{ suggested: number; due: number }> {
  const now = new Date();
  const [suggested, due] = await Promise.all([
    prisma.task.count({ where: { userId, status: "SUGGESTED" } }),
    prisma.task.count({ where: { userId, status: { in: [...OPEN_STATUSES] }, remindAt: { lte: now } } }),
  ]);
  return { suggested, due };
}
