import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { audit } from "@/lib/audit";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { isUuid } from "@/lib/validation";
import { buildCalendar, type IcsEvent } from "./ics";
import { OPEN_STATUSES, toIcsEvent } from "./calendar.service";

// Suscripción ICS: una URL secreta ({id}.{secreto}.ics) que Google Calendar, Apple Calendar u Outlook
// leen periódicamente. Así los recordatorios suenan en el teléfono sin notificaciones push propias.
// El secreto se guarda cifrado (para volver a mostrar la URL) y como hash (para validarlo en tiempo constante).

const hash = (secret: string) => createHash("sha256").update(secret).digest("hex");

function feedUrl(id: string, secret: string): string {
  const base = env().NEXT_PUBLIC_APP_URL.replace(/\/$/, "");
  return `${base}/api/calendar/${id}.${secret}.ics`;
}

export async function getFeedUrl(userId: string): Promise<string | null> {
  const feed = await prisma.calendarFeed.findUnique({ where: { userId } });
  if (!feed) return null;
  try {
    return feedUrl(feed.id, decryptSecret(feed.secretEncrypted));
  } catch {
    return null;
  }
}

/** Crea la URL o la cambia por una nueva (la anterior deja de funcionar). */
export async function rotateFeed(userId: string): Promise<string> {
  const secret = randomBytes(24).toString("base64url");
  const feed = await prisma.calendarFeed.upsert({
    where: { userId },
    create: { userId, secretHash: hash(secret), secretEncrypted: encryptSecret(secret) },
    update: { secretHash: hash(secret), secretEncrypted: encryptSecret(secret), lastAccessedAt: null },
  });
  await audit({ userId, actor: "user", action: "calendar_feed.rotated", entity: "calendar_feed", entityId: feed.id });
  return feedUrl(feed.id, secret);
}

export async function revokeFeed(userId: string) {
  await prisma.calendarFeed.deleteMany({ where: { userId } });
  await audit({ userId, actor: "user", action: "calendar_feed.revoked" });
  return { revoked: true };
}

/** Contenido del feed para un token "{id}.{secreto}" (null si no es válido). Ruta pública. */
export async function feedIcsForToken(token: string): Promise<string | null> {
  const clean = token.replace(/\.ics$/i, "");
  const dot = clean.indexOf(".");
  if (dot < 0) return null;
  const id = clean.slice(0, dot);
  const secret = clean.slice(dot + 1);
  if (!isUuid(id) || secret.length < 20) return null;

  const feed = await prisma.calendarFeed.findUnique({ where: { id } });
  if (!feed) return null;
  const expected = Buffer.from(feed.secretHash, "hex");
  const given = Buffer.from(hash(secret), "hex");
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;

  const now = new Date();
  const [profile, events, tasks] = await Promise.all([
    prisma.profile.findUnique({ where: { id: feed.userId }, select: { timezone: true } }),
    prisma.calendarEvent.findMany({
      where: {
        userId: feed.userId,
        startsAt: { gte: new Date(now.getTime() - 30 * 86_400_000), lt: new Date(now.getTime() + 400 * 86_400_000) },
      },
      orderBy: { startsAt: "asc" },
      take: 500,
    }),
    // Trámites con fecha límite que no tienen evento propio: se publican como "Vence: …" de todo el día.
    prisma.task.findMany({
      where: { userId: feed.userId, status: { in: [...OPEN_STATUSES] }, dueAt: { gte: now }, calendarEvents: { none: {} } },
      select: { id: true, title: true, dueAt: true, updatedAt: true },
      take: 200,
    }),
  ]);
  await prisma.calendarFeed.update({ where: { id }, data: { lastAccessedAt: now } }).catch(() => undefined);

  const items: IcsEvent[] = events.map(toIcsEvent);
  for (const task of tasks) {
    if (!task.dueAt) continue;
    items.push({
      uid: `task-${task.id}@omniagent`,
      title: `Vence: ${task.title}`,
      startsAt: task.dueAt,
      allDay: true,
      alarms: [300], // 7:00 p. m. del día anterior
      updatedAt: task.updatedAt,
    });
  }
  return buildCalendar(items, { name: "OmniAgent · Trámites", timeZone: profile?.timezone ?? "UTC", now });
}
