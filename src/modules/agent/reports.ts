import "server-only";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { Errors } from "@/lib/errors";
import { log } from "@/lib/log";
import { isUuid } from "@/lib/validation";

// Reportes de respuestas de la IA. La política de contenido generado con IA de Google Play exige poder reportar
// contenido ofensivo sin salir de la app y usar esos reportes para mejorar los filtros: quedan en content_reports
// (para revisarlos en Supabase) y en los logs como "agent.message.reported".

export const REPORT_REASONS = ["offensive", "dangerous", "sexual", "wrong", "privacy", "other"] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

export const reportSchema = z.object({
  reason: z.enum(REPORT_REASONS),
  comment: z.string().trim().max(1000).optional(),
});

const EXCERPT_CHARS = 2_000;

/** Reporta una respuesta de Omni. Reportar otra vez el mismo mensaje actualiza el reporte (no crea duplicados). */
export async function reportMessage(userId: string, messageId: string, input: z.infer<typeof reportSchema>) {
  if (!isUuid(messageId)) throw Errors.notFound("El mensaje");
  const message = await prisma.message.findFirst({
    where: { id: messageId, userId, role: "ASSISTANT" },
    select: { id: true, text: true, content: true, conversationId: true },
  });
  if (!message) throw Errors.notFound("El mensaje");

  const cards = Array.isArray((message.content as { cards?: unknown } | null)?.cards)
    ? ((message.content as { cards: { kind?: unknown }[] }).cards.map((card) => String(card?.kind ?? "")).filter(Boolean))
    : [];
  const excerpt = [message.text ?? "", cards.length ? `[tarjetas: ${cards.join(", ")}]` : ""]
    .filter(Boolean)
    .join("\n")
    .slice(0, EXCERPT_CHARS);
  const comment = input.comment || null;

  const report = await prisma.contentReport.upsert({
    where: { userId_messageId: { userId, messageId: message.id } },
    create: { userId, messageId: message.id, reason: input.reason, comment, excerpt },
    update: { reason: input.reason, comment, excerpt, status: "open" },
    select: { id: true },
  });

  log.warn("agent.message.reported", { userId, messageId: message.id, reportId: report.id, reason: input.reason });
  await audit({
    userId,
    actor: "user",
    action: "agent.message.reported",
    entity: "message",
    entityId: message.id,
    metadata: { reason: input.reason, conversationId: message.conversationId },
  });
  return { reported: true as const };
}
