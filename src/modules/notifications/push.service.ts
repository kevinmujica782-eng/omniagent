import "server-only";
import * as webpush from "web-push";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { SUPPORT_EMAIL } from "@/lib/legal";
import { log } from "@/lib/log";

// Notificaciones push (Web Push) al teléfono o al navegador donde la persona las activó. Sirve en Android y en
// iPhone (con la app agregada a la pantalla de inicio). Cada notificación nueva de la app (tabla notifications)
// llega aquí por un trigger de la base que llama a /api/cron/push (ver prisma/sql/supabase-setup.sql).

const VAPID_SETTING = "vapid";
const MAX_DEVICES = 10;
const MAX_FAILURES = 5;

type VapidKeys = { publicKey: string; privateKey: string };
let cachedKeys: VapidKeys | null = null;

/**
 * Llaves VAPID: las de las variables de entorno si están; si no, las que la app generó la primera vez y guardó en
 * app_settings (la privada, cifrada con TOKEN_ENCRYPTION_KEY). Así funciona sin configurar nada.
 */
export async function vapidKeys(): Promise<VapidKeys> {
  if (cachedKeys) return cachedKeys;
  const config = env();
  if (config.VAPID_PUBLIC_KEY && config.VAPID_PRIVATE_KEY) {
    cachedKeys = { publicKey: config.VAPID_PUBLIC_KEY, privateKey: config.VAPID_PRIVATE_KEY };
    return cachedKeys;
  }
  let row = await prisma.appSetting.findUnique({ where: { key: VAPID_SETTING } });
  if (!row) {
    const generated = webpush.generateVAPIDKeys();
    const value = JSON.stringify({ publicKey: generated.publicKey, privateKey: encryptSecret(generated.privateKey) });
    // Si dos servidores las generan a la vez, gana la primera que se guarda y ambos usan esa.
    await prisma.appSetting.createMany({ data: [{ key: VAPID_SETTING, value }], skipDuplicates: true });
    row = await prisma.appSetting.findUniqueOrThrow({ where: { key: VAPID_SETTING } });
  }
  const stored = JSON.parse(row.value) as { publicKey: string; privateKey: string };
  cachedKeys = { publicKey: stored.publicKey, privateKey: decryptSecret(stored.privateKey) };
  return cachedKeys;
}

export type PushInput = { endpoint: string; keys: { p256dh: string; auth: string }; userAgent?: string | null };

/** Guarda el teléfono o navegador de la persona. Si ese aparato era de otra cuenta, pasa a esta. */
export async function saveSubscription(userId: string, input: PushInput): Promise<void> {
  await prisma.pushSubscription.upsert({
    where: { endpoint: input.endpoint },
    create: { userId, endpoint: input.endpoint, p256dh: input.keys.p256dh, auth: input.keys.auth, userAgent: input.userAgent ?? null },
    update: { userId, p256dh: input.keys.p256dh, auth: input.keys.auth, userAgent: input.userAgent ?? null, failures: 0 },
  });
  // Un tope de aparatos por persona: se van los más viejos.
  const extra = await prisma.pushSubscription.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
    skip: MAX_DEVICES,
    select: { id: true },
  });
  if (extra.length) await prisma.pushSubscription.deleteMany({ where: { id: { in: extra.map((s) => s.id) } } });
}

export async function removeSubscription(userId: string, endpoint: string): Promise<void> {
  await prisma.pushSubscription.deleteMany({ where: { userId, endpoint } });
}

export type PushMessage = { title: string; body?: string | null; url?: string | null; tag?: string | null };

/** Manda la notificación a todos los aparatos de la persona. Los que ya no existen (404/410) se borran. */
export async function sendPushToUser(userId: string, message: PushMessage): Promise<{ sent: number; removed: number }> {
  const subscriptions = await prisma.pushSubscription.findMany({ where: { userId } });
  if (subscriptions.length === 0) return { sent: 0, removed: 0 };
  const keys = await vapidKeys();
  const payload = JSON.stringify({
    title: message.title.slice(0, 120),
    body: (message.body ?? "").slice(0, 240),
    url: message.url ?? "/inicio",
    tag: message.tag ?? undefined,
  });
  let sent = 0;
  let removed = 0;
  for (const sub of subscriptions) {
    try {
      await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload, {
        vapidDetails: { subject: `mailto:${SUPPORT_EMAIL}`, publicKey: keys.publicKey, privateKey: keys.privateKey },
        TTL: 24 * 3600,
        timeout: 10_000,
      });
      sent++;
      await prisma.pushSubscription.update({ where: { id: sub.id }, data: { lastSuccessAt: new Date(), failures: 0 } });
    } catch (error) {
      const status = (error as { statusCode?: number } | null)?.statusCode;
      if (status === 404 || status === 410 || sub.failures + 1 >= MAX_FAILURES) {
        await prisma.pushSubscription.deleteMany({ where: { id: sub.id } });
        removed++;
      } else {
        await prisma.pushSubscription.updateMany({ where: { id: sub.id }, data: { failures: { increment: 1 } } });
        log.warn("push.send_failed", { userId, status: status ?? null, error });
      }
    }
  }
  return { sent, removed };
}

/** La notificación de la app (título, texto y pantalla) llega como push a los aparatos de su dueño. */
export async function pushAppNotification(notificationId: string): Promise<{ sent: number; removed: number }> {
  const notification = await prisma.appNotification.findUnique({ where: { id: notificationId } });
  if (!notification) return { sent: 0, removed: 0 };
  return sendPushToUser(notification.userId, {
    title: notification.title,
    body: notification.body,
    url: notification.href ?? "/inicio",
    tag: notification.id,
  });
}
