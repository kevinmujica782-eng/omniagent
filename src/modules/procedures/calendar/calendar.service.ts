import "server-only";
import type { CalendarEvent } from "@/generated/prisma/client";
import type { CalendarEventKind } from "@/generated/prisma/enums";
import { decryptSecret } from "@/lib/crypto";
import { prisma } from "@/lib/db";
import { Errors } from "@/lib/errors";
import { isUuid } from "@/lib/validation";
import type { AgendaItemView, CalendarSyncView } from "@/types/cards";
import { getMailProvider } from "../mail/providers";
import type { MailProviderName } from "../mail/providers/types";
import { buildCalendar, type IcsEvent } from "./ics";
import type { BusyBlock } from "./scheduler";

// Calendario de OmniAgent: eventos propios (citas, bloques para hacer trámites, fechas límite) que se
// sincronizan con el calendario conectado (sandbox hoy; Google/Microsoft con la misma interfaz) y se publican
// en el feed ICS para Google Calendar, Apple y Outlook.

export const OPEN_STATUSES = ["PENDING", "IN_PROGRESS", "WAITING_USER"] as const;

export interface NewCalendarEvent {
  kind: CalendarEventKind;
  title: string;
  description?: string | null;
  location?: string | null;
  startsAt: Date;
  endsAt: Date | null;
  allDay: boolean;
  reminderMinutes: number[];
}

type ConnectionMeta = { provider?: MailProviderName; address?: string };

/** Cuentas conectadas con calendario (hoy, las bandejas de prueba). */
export async function calendarConnections(userId: string) {
  const rows = await prisma.integrationConnection.findMany({
    where: { userId, provider: "MAIL_DEMO", status: "ACTIVE" },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((row) => {
    const meta = (row.metadata ?? {}) as ConnectionMeta;
    return {
      id: row.id,
      name: row.displayName ?? "Calendario",
      address: meta.address ?? row.externalAccountId ?? "",
      provider: getMailProvider(meta.provider ?? "sandbox"),
      token: row.accessTokenEncrypted ? decryptSecret(row.accessTokenEncrypted) : null,
    };
  });
}

/** Horarios ocupados: calendario conectado + eventos de OmniAgent. */
export async function busyBlocks(userId: string, from: Date, to: Date): Promise<BusyBlock[]> {
  const [connections, own] = await Promise.all([
    calendarConnections(userId),
    prisma.calendarEvent.findMany({
      where: { userId, status: "confirmed", allDay: false, startsAt: { lt: to }, OR: [{ endsAt: { gt: from } }, { endsAt: null, startsAt: { gte: from } }] },
      select: { title: true, startsAt: true, endsAt: true },
    }),
  ]);
  const blocks: BusyBlock[] = own.map((e) => ({ start: e.startsAt, end: e.endsAt ?? new Date(e.startsAt.getTime() + 30 * 60_000), title: e.title }));
  for (const connection of connections) {
    if (!connection.token) continue;
    try {
      const events = await connection.provider.listCalendarEvents(connection.token, from, to);
      blocks.push(...events.filter((e) => !e.allDay).map((e) => ({ start: e.startsAt, end: e.endsAt, title: e.title })));
    } catch (error) {
      console.error("[calendar] no se pudo leer el calendario conectado", connection.id, error);
    }
  }
  return blocks.sort((a, b) => a.start.getTime() - b.start.getTime());
}

/** Crea los eventos y los envía al calendario conectado (si hay uno). */
export async function createCalendarEvents(userId: string, taskId: string | null, events: NewCalendarEvent[]): Promise<CalendarEvent[]> {
  if (events.length === 0) return [];
  const [connection] = await calendarConnections(userId);
  const created: CalendarEvent[] = [];
  for (const event of events) {
    let row = await prisma.calendarEvent.create({
      data: {
        userId,
        taskId,
        connectionId: connection?.id ?? null,
        kind: event.kind,
        title: event.title.slice(0, 200),
        description: event.description ?? null,
        location: event.location ?? null,
        startsAt: event.startsAt,
        endsAt: event.endsAt,
        allDay: event.allDay,
        reminderMinutes: event.reminderMinutes,
        syncStatus: connection?.token ? "PENDING" : "LOCAL_ONLY",
      },
    });
    if (connection?.token) {
      try {
        const remote = await connection.provider.createCalendarEvent(connection.token, {
          title: row.title,
          description: row.description,
          location: row.location,
          startsAt: row.startsAt,
          endsAt: row.endsAt,
          allDay: row.allDay,
          reminderMinutes: row.reminderMinutes,
        });
        row = await prisma.calendarEvent.update({
          where: { id: row.id },
          data: { externalEventId: remote.id, syncStatus: "SYNCED", syncError: null },
        });
      } catch (error) {
        console.error("[calendar] no se pudo sincronizar el evento", row.id, error);
        row = await prisma.calendarEvent.update({
          where: { id: row.id },
          data: { syncStatus: "ERROR", syncError: "No se pudo enviar al calendario conectado." },
        });
      }
    }
    created.push(row);
  }
  return created;
}

/** Cancela los eventos de un trámite (al descartarlo o completarlo antes de tiempo). */
export async function cancelTaskEvents(userId: string, taskId: string, kinds?: CalendarEventKind[]) {
  const events = await prisma.calendarEvent.findMany({
    where: { userId, taskId, status: "confirmed", ...(kinds ? { kind: { in: kinds } } : {}) },
  });
  if (events.length === 0) return 0;
  const connections = await calendarConnections(userId);
  for (const event of events) {
    const connection = connections.find((c) => c.id === event.connectionId);
    if (connection?.token && event.externalEventId) {
      await connection.provider.deleteCalendarEvent(connection.token, event.externalEventId).catch(() => undefined);
    }
    await prisma.calendarEvent.update({
      where: { id: event.id },
      data: { status: "cancelled", sequence: { increment: 1 } },
    });
  }
  return events.length;
}

function toAgendaItem(event: CalendarEvent): AgendaItemView {
  return {
    id: event.id,
    kind: event.kind,
    title: event.title,
    startsAt: event.startsAt.toISOString(),
    endsAt: event.endsAt?.toISOString() ?? null,
    allDay: event.allDay,
    location: event.location,
    taskId: event.taskId,
    synced: event.syncStatus === "SYNCED",
  };
}

/** Agenda: eventos de OmniAgent, fechas límite de trámites abiertos y, si se pide, lo ocupado del calendario. */
export async function listAgenda(userId: string, from: Date, to: Date, opts: { includeBusy?: boolean } = {}): Promise<AgendaItemView[]> {
  const [events, tasks] = await Promise.all([
    prisma.calendarEvent.findMany({
      where: { userId, status: "confirmed", startsAt: { gte: from, lt: to } },
      orderBy: { startsAt: "asc" },
    }),
    prisma.task.findMany({
      where: { userId, status: { in: [...OPEN_STATUSES] }, dueAt: { gte: from, lt: to } },
      select: { id: true, title: true, dueAt: true, metadata: true },
    }),
  ]);
  const items = events.map(toAgendaItem);
  const withEvents = new Set(events.filter((e) => e.kind !== "EVENT").map((e) => e.taskId));
  for (const task of tasks) {
    if (!task.dueAt || withEvents.has(task.id)) continue;
    const dueHasTime = Boolean((task.metadata as { dueHasTime?: boolean } | null)?.dueHasTime);
    items.push({
      id: `due-${task.id}`,
      kind: "DUE",
      title: task.title,
      startsAt: task.dueAt.toISOString(),
      endsAt: null,
      allDay: !dueHasTime,
      location: null,
      taskId: task.id,
      synced: false,
    });
  }
  if (opts.includeBusy) {
    const busy = await busyBlocks(userId, from, to);
    const own = new Set(events.map((e) => `${e.startsAt.getTime()}|${e.title}`));
    for (const block of busy) {
      if (own.has(`${block.start.getTime()}|${block.title}`)) continue;
      items.push({
        id: `busy-${block.start.getTime()}-${block.title ?? ""}`,
        kind: "BUSY",
        title: block.title ?? "Ocupado",
        startsAt: block.start.toISOString(),
        endsAt: block.end.toISOString(),
        allDay: false,
        location: null,
        taskId: null,
        synced: true,
      });
    }
  }
  return items.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

export function toIcsEvent(event: CalendarEvent): IcsEvent {
  return {
    uid: `${event.id}@omniagent`,
    title: event.title,
    description: event.description,
    location: event.location,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    allDay: event.allDay,
    alarms: event.reminderMinutes,
    status: event.status === "cancelled" ? "cancelled" : "confirmed",
    sequence: event.sequence,
    updatedAt: event.updatedAt,
  };
}

/** Un evento como archivo .ics ("Añadir a mi calendario" desde el teléfono). */
export async function eventIcs(userId: string, eventId: string, timeZone: string) {
  if (!isUuid(eventId)) throw Errors.notFound("El evento");
  const event = await prisma.calendarEvent.findFirst({ where: { id: eventId, userId } });
  if (!event) throw Errors.notFound("El evento");
  const slug = event.title
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\w]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  return {
    fileName: `${slug || "evento"}.ics`,
    ics: buildCalendar([toIcsEvent(event)], { name: "OmniAgent", timeZone }),
  };
}

export async function calendarSyncView(userId: string, feedUrl: string | null): Promise<CalendarSyncView> {
  const connections = await calendarConnections(userId);
  return {
    calendars: connections.map((c) => ({ id: c.id, name: c.name, address: c.address })),
    feedUrl,
    webcalUrl: feedUrl ? feedUrl.replace(/^https?:\/\//, "webcal://") : null,
  };
}
