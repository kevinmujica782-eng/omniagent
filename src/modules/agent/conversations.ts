import "server-only";
import { prisma } from "@/lib/db";
import { isUuid } from "@/lib/validation";
import { toApprovalCard } from "@/modules/actions/actions.service";
import { currentRecommendationViews } from "@/modules/finance/insights/analysis.service";
import { alertViewsByIds } from "@/modules/concierge/alerts.service";
import { checkoutsByIds } from "@/modules/concierge/checkout.service";
import { trackedViewsByIds } from "@/modules/concierge/tracking.service";
import { proceduresByIds } from "@/modules/procedures/plan";
import { AI_PROVIDER_IDS, type AIProviderId } from "@/types/ai";
import type { AgentCard, AnsweredBy, ChatMessageView } from "@/types/cards";

/** Qué modelo respondió, guardado con el mensaje (los mensajes de antes del router no lo tienen). */
function answeredByOf(value: unknown): AnsweredBy | null {
  if (!value || typeof value !== "object") return null;
  const ai = value as { provider?: unknown; model?: unknown; fallbackFrom?: unknown; requested?: unknown };
  const known = (id: unknown): id is AIProviderId => typeof id === "string" && (AI_PROVIDER_IDS as readonly string[]).includes(id);
  if (!known(ai.provider) || typeof ai.model !== "string") return null;
  return {
    provider: ai.provider,
    model: ai.model,
    fallbackFrom: known(ai.fallbackFrom) ? ai.fallbackFrom : null,
    requested: known(ai.requested) ? ai.requested : null,
  };
}

export async function getConversationView(userId: string, conversationId: string) {
  if (!isUuid(conversationId)) return null;
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, userId },
    select: { id: true, title: true, module: true },
  });
  if (!conversation) return null;

  const rows = await prisma.message.findMany({
    where: { conversationId, role: { in: ["USER", "ASSISTANT"] } },
    orderBy: { createdAt: "asc" },
    take: 200,
    select: { id: true, role: true, text: true, content: true, createdAt: true },
  });

  const messages: ChatMessageView[] = rows.map((row) => {
    const content = (row.content ?? {}) as unknown as { cards?: AgentCard[]; suggestions?: string[]; ai?: unknown };
    const ai = answeredByOf(content.ai);
    return {
      id: row.id,
      role: row.role === "USER" ? "user" : "assistant",
      text: row.text ?? "",
      cards: Array.isArray(content.cards) ? content.cards : [],
      ...(Array.isArray(content.suggestions) ? { suggestions: content.suggestions } : {}),
      ...(ai ? { ai } : {}),
      createdAt: row.createdAt.toISOString(),
    };
  });

  // Las tarjetas de aprobación guardadas pueden estar desactualizadas: se refrescan desde agent_actions.
  const actionIds = messages.flatMap((m) => m.cards.flatMap((c) => (c.kind === "approval" ? [c.actionId] : [])));
  if (actionIds.length > 0) {
    const actions = await prisma.agentAction.findMany({ where: { id: { in: actionIds }, userId } });
    const fresh = new Map(actions.map((action) => [action.id, toApprovalCard(action)]));
    for (const message of messages) {
      message.cards = message.cards.map((card) => (card.kind === "approval" ? fresh.get(card.actionId) ?? card : card));
    }
  }

  // Lo mismo con las recomendaciones de los informes financieros (aplicadas, descartadas...).
  const analysisIds = messages.flatMap((m) => m.cards.flatMap((c) => (c.kind === "insights" ? [c.analysisId] : [])));
  if (analysisIds.length > 0) {
    const views = await currentRecommendationViews(userId, analysisIds);
    for (const message of messages) {
      message.cards = message.cards.map((card) =>
        card.kind === "insights" && views.has(card.analysisId)
          ? { ...card, recommendations: views.get(card.analysisId) ?? card.recommendations }
          : card,
      );
    }
  }

  // Y con los trámites (confirmados, hechos o descartados después de mostrarse).
  const taskIds = messages.flatMap((m) =>
    m.cards.flatMap((c) => (c.kind === "inbox_digest" || c.kind === "procedures" ? c.items.map((i) => i.taskId) : [])),
  );
  if (taskIds.length > 0) {
    const fresh = await proceduresByIds(userId, [...new Set(taskIds)]);
    for (const message of messages) {
      message.cards = message.cards.map((card) =>
        card.kind === "inbox_digest" || card.kind === "procedures"
          ? { ...card, items: card.items.map((item) => fresh.get(item.taskId) ?? item) }
          : card,
      );
    }
  }

  // Y con las compras: seguimientos, alertas y hojas de pago (compradas, denegadas, vencidas...).
  const itemIds = messages.flatMap((m) => m.cards.flatMap((c) => (c.kind === "tracked_item" ? [c.item.id] : [])));
  const alertIds = messages.flatMap((m) => m.cards.flatMap((c) => (c.kind === "price_alert" ? [c.alert.id] : [])));
  const checkoutIds = messages.flatMap((m) => m.cards.flatMap((c) => (c.kind === "checkout" ? [c.checkout.actionId] : [])));
  if (itemIds.length + alertIds.length + checkoutIds.length > 0) {
    const [items, alerts, checkouts] = await Promise.all([
      trackedViewsByIds(userId, [...new Set(itemIds)]),
      alertViewsByIds(userId, [...new Set(alertIds)]),
      checkoutsByIds(userId, [...new Set(checkoutIds)]),
    ]);
    for (const message of messages) {
      message.cards = message.cards.map((card) => {
        if (card.kind === "tracked_item") return { ...card, item: items.get(card.item.id) ?? card.item };
        if (card.kind === "price_alert") return { ...card, alert: alerts.get(card.alert.id) ?? card.alert };
        if (card.kind === "checkout") return { ...card, checkout: checkouts.get(card.checkout.actionId) ?? card.checkout };
        return card;
      });
    }
  }

  return { id: conversation.id, title: conversation.title, module: conversation.module, messages };
}

export async function listRecentConversations(userId: string, take = 5) {
  const rows = await prisma.conversation.findMany({
    where: { userId, archived: false },
    orderBy: { updatedAt: "desc" },
    take,
    select: { id: true, title: true, updatedAt: true },
  });
  return rows.map((row) => ({ id: row.id, title: row.title ?? "Conversación", updatedAt: row.updatedAt.toISOString() }));
}
