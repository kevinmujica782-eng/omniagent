import type { Metadata } from "next";
import { ChatView } from "@/components/chat/chat-view";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { firstName } from "@/lib/format";
import { CHAT_STARTERS, CONCIERGE_STARTERS, FINANCE_STARTERS, PROCEDURES_STARTERS, RETURNS_STARTERS } from "@/lib/starters";
import { isUuid } from "@/lib/validation";
import { getConversationView } from "@/modules/agent/conversations";

export const metadata: Metadata = { title: "Chat" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const MODULE_BY_PARAM = { finanzas: "FINANCE", tramites: "PROCEDURES", compras: "CONCIERGE", devoluciones: "CONCIERGE" } as const;
const STARTERS = { FINANCE: FINANCE_STARTERS, PROCEDURES: PROCEDURES_STARTERS, CONCIERGE: CONCIERGE_STARTERS } as const;

/**
 * /chat (general), /chat?modulo=finanzas (asistente financiero), /chat?modulo=tramites (trámites),
 * /chat?modulo=compras (concierge de compras), /chat?modulo=devoluciones (pedidos y devoluciones, con el mismo agente
 * de compras) y /chat?c=<id> (conversación guardada).
 */
export default async function ChatPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireUser();
  const params = await searchParams;
  const conversationParam = typeof params.c === "string" ? params.c : null;
  const prompt = typeof params.prompt === "string" ? params.prompt.slice(0, 500) : null;
  const ideaId = typeof params.idea === "string" && isUuid(params.idea) ? params.idea : null;

  const [conversation, profile] = await Promise.all([
    conversationParam ? getConversationView(user.userId, conversationParam) : null,
    prisma.profile.findUnique({ where: { id: user.userId }, select: { fullName: true, timezone: true } }),
  ]);

  const requested = typeof params.modulo === "string" ? MODULE_BY_PARAM[params.modulo as keyof typeof MODULE_BY_PARAM] : undefined;
  const fromConversation =
    conversation?.module === "FINANCE" || conversation?.module === "PROCEDURES" || conversation?.module === "CONCIERGE" ? conversation.module : undefined;
  const module = conversation ? fromConversation : requested;
  const returns = !conversation && params.modulo === "devoluciones";

  return (
    <ChatView
      key={conversation?.id ?? `new-${returns ? "devoluciones" : (module ?? "general")}`}
      conversationId={conversation?.id ?? null}
      initialMessages={conversation?.messages ?? []}
      starters={returns ? RETURNS_STARTERS : module ? STARTERS[module] : CHAT_STARTERS}
      autoPrompt={conversation ? null : prompt}
      ideaId={ideaId}
      userName={firstName(profile?.fullName)}
      timeZone={profile?.timezone}
      module={module}
      variant={returns ? "returns" : undefined}
    />
  );
}
