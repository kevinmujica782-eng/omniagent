import "server-only";
import { randomInt } from "node:crypto";
import type { IntegrationConnection } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { Errors } from "@/lib/errors";
import { log } from "@/lib/log";

// Vínculo de Slack con Omni: la persona genera un código en la app y escribe «/omni vincular CÓDIGO» en Slack. No se
// guardan tokens de Slack; las respuestas van por el response_url que Slack manda con cada comando (vale 30 min). El
// vínculo vive en integration_connections (provider SLACK): PENDING con el código, ACTIVE una vez enlazado.

const CODE_TTL_MS = 15 * 60 * 1000;
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sin I/O/0/1 para que sea fácil de teclear

export function slackConfigured(): boolean {
  return Boolean(env().SLACK_SIGNING_SECRET);
}

export function slackSigningSecret(): string {
  const secret = env().SLACK_SIGNING_SECRET;
  if (!secret) throw Errors.notConfigured("Slack");
  return secret;
}

type SlackMeta = { code?: string; codeExpiresAt?: string; teamId?: string; slackUserId?: string; conversationId?: string };

function metaOf(row: IntegrationConnection): SlackMeta {
  return (row.metadata ?? {}) as SlackMeta;
}

function newCode(): string {
  return Array.from({ length: 6 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("");
}

function externalId(teamId: string, slackUserId: string): string {
  return `${teamId}:${slackUserId}`;
}

/** Genera (o renueva) el código de vínculo de la persona. Un solo vínculo pendiente por persona. */
export async function createSlackLinkCode(userId: string): Promise<{ code: string; expiresAt: string }> {
  const code = newCode();
  const expiresAt = new Date(Date.now() + CODE_TTL_MS);
  // Quita un pendiente anterior (externalAccountId null = aún sin enlazar); no toca un vínculo ya activo.
  await prisma.integrationConnection.deleteMany({ where: { userId, provider: "SLACK", externalAccountId: null } });
  await prisma.integrationConnection.create({
    data: {
      userId,
      provider: "SLACK",
      status: "PENDING",
      displayName: "Slack",
      metadata: { code, codeExpiresAt: expiresAt.toISOString() },
    },
  });
  return { code, expiresAt: expiresAt.toISOString() };
}

/** Enlaza un usuario de Slack (equipo + usuario) con la cuenta de Omni que generó ese código. */
export async function linkSlackUser(code: string, teamId: string, slackUserId: string): Promise<{ linked: boolean; reason?: string }> {
  const clean = code.trim().toUpperCase();
  if (!/^[A-Z0-9]{6}$/.test(clean)) return { linked: false, reason: "código inválido" };

  const external = externalId(teamId, slackUserId);
  // ¿Ya está enlazado este usuario de Slack?
  const existing = await prisma.integrationConnection.findFirst({
    where: { provider: "SLACK", externalAccountId: external, status: "ACTIVE" },
  });
  if (existing) return { linked: true }; // ya enlazado (idempotente)

  // Busca un pendiente con ese código, sin vencer. Se filtra en memoria porque el código vive en el JSON.
  const pendings = await prisma.integrationConnection.findMany({
    where: { provider: "SLACK", externalAccountId: null, status: "PENDING" },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  const now = Date.now();
  const match = pendings.find((row) => {
    const meta = metaOf(row);
    return meta.code === clean && meta.codeExpiresAt && Date.parse(meta.codeExpiresAt) > now;
  });
  if (!match) return { linked: false, reason: "código no encontrado o vencido" };

  try {
    await prisma.integrationConnection.update({
      where: { id: match.id },
      data: {
        externalAccountId: external,
        status: "ACTIVE",
        displayName: "Slack",
        lastSyncedAt: new Date(),
        metadata: { teamId, slackUserId },
      },
    });
  } catch (error) {
    log.warn("slack.link_failed", { error });
    return { linked: false, reason: "no se pudo enlazar" };
  }
  return { linked: true };
}

/** La cuenta de Omni enlazada a ese usuario de Slack, o null. */
export async function resolveSlackUser(teamId: string, slackUserId: string): Promise<{ userId: string; connectionId: string; conversationId: string | null } | null> {
  const row = await prisma.integrationConnection.findFirst({
    where: { provider: "SLACK", externalAccountId: externalId(teamId, slackUserId), status: "ACTIVE" },
  });
  if (!row) return null;
  return { userId: row.userId, connectionId: row.id, conversationId: metaOf(row).conversationId ?? null };
}

/** Recuerda la conversación de Slack para no perder el hilo entre mensajes. */
export async function rememberSlackConversation(connectionId: string, teamId: string, slackUserId: string, conversationId: string): Promise<void> {
  await prisma.integrationConnection
    .update({ where: { id: connectionId }, data: { metadata: { teamId, slackUserId, conversationId }, lastSyncedAt: new Date() } })
    .catch((error: unknown) => log.warn("slack.remember_conversation_failed", { error }));
}

/** Responde en Slack por el response_url del comando (no necesita token: Slack lo acepta hasta 5 veces en 30 min). */
export async function postToSlack(responseUrl: string, text: string, opts: { inChannel?: boolean } = {}): Promise<void> {
  try {
    const res = await fetch(responseUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ response_type: opts.inChannel ? "in_channel" : "ephemeral", text }),
    });
    if (!res.ok) log.warn("slack.post_failed", { status: res.status });
  } catch (error) {
    log.warn("slack.post_error", { error });
  }
}
