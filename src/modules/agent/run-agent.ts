import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import type { Prisma } from "@/generated/prisma/client";
import type { AgentModule } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { AppError, Errors, isFreePlanLimit, type PlanLimitDetails } from "@/lib/errors";
import { log } from "@/lib/log";
import { assertCanSendMessage, getEntitlements } from "@/modules/billing/entitlements";
import { upgradeCard } from "@/modules/billing/upgrade";
import type { AgentCard, ChatMessageView } from "@/types/cards";
import { anthropic } from "./anthropic";
import { buildSystemPrompt } from "./prompts";
import { toAnthropicTool, type ToolContext } from "./registry";
import { ALL_TOOLS, findTool } from "./tools";

const MAX_TOOL_ROUNDS = 6;
const HISTORY_LIMIT = 20;
const MAX_OUTPUT_TOKENS = 1500;

type BlockParams = Exclude<Anthropic.MessageParam["content"], string>;

export interface RunAgentInput {
  userId: string;
  message: string;
  conversationId?: string;
  module?: AgentModule;
}

export interface RunAgentResult {
  conversationId: string;
  message: ChatMessageView;
}

/**
 * Un turno del agente: guarda el mensaje del usuario, llama a Claude con las herramientas de todos los
 * módulos, ejecuta las llamadas a funciones (máx. MAX_TOOL_ROUNDS rondas), guarda la respuesta con sus
 * tarjetas y registra el consumo para la cuota del plan.
 */
export async function runAgent(input: RunAgentInput): Promise<RunAgentResult> {
  const { userId } = input;
  const text = input.message.trim();
  if (!text) throw Errors.badRequest("Escribe un mensaje.");

  const [profile, entitlements] = await Promise.all([
    prisma.profile.findUnique({
      where: { id: userId },
      select: { fullName: true, currency: true, timezone: true },
    }),
    getEntitlements(userId),
  ]);
  if (!profile) throw Errors.notFound("El perfil");
  await assertCanSendMessage(userId, entitlements);

  const conversationId = await resolveConversation(userId, input.conversationId, input.module, text);

  const history = await prisma.message.findMany({
    where: { conversationId, role: { in: ["USER", "ASSISTANT"] } },
    orderBy: { createdAt: "desc" },
    take: HISTORY_LIMIT,
    select: { role: true, text: true },
  });

  await prisma.message.create({ data: { conversationId, userId, role: "USER", text, content: { text } } });

  const messages = normalizeHistory(
    history
      .reverse()
      .filter((m) => Boolean(m.text))
      .map((m) => ({ role: m.role === "USER" ? ("user" as const) : ("assistant" as const), text: m.text as string })),
  );
  appendUserText(messages, text);

  const now = new Date();
  const ctx: ToolContext = { userId, conversationId, currency: profile.currency, timezone: profile.timezone, now };
  const prompt = buildSystemPrompt({
    name: profile.fullName,
    currency: profile.currency,
    timezone: profile.timezone,
    plan: entitlements.plan,
    now,
  });
  // Prompt caching: herramientas + parte fija del sistema se reutilizan entre turnos (menos costo y latencia).
  const system: Anthropic.TextBlockParam[] = [
    { type: "text", text: prompt.stable, cache_control: { type: "ephemeral" } },
    { type: "text", text: prompt.dynamic },
  ];
  const tools = ALL_TOOLS.map(toAnthropicTool);

  const cards: AgentCard[] = [];
  let suggestions: string[] = [];
  const usage = { input: 0, output: 0, cacheRead: 0, toolCalls: 0 };
  let finalText = "";

  for (let round = 0; ; round++) {
    const response = await anthropic().messages.create({
      model: entitlements.model,
      max_tokens: MAX_OUTPUT_TOKENS,
      system,
      tools,
      messages,
    });
    usage.input += response.usage.input_tokens;
    usage.output += response.usage.output_tokens;
    usage.cacheRead += response.usage.cache_read_input_tokens ?? 0;

    const texts = response.content.flatMap((block) => (block.type === "text" ? [block.text] : []));
    const toolUses = response.content.flatMap((block) => (block.type === "tool_use" ? [block] : []));

    if (response.stop_reason !== "tool_use" || toolUses.length === 0) {
      finalText = texts.join("\n").trim();
      break;
    }
    if (round >= MAX_TOOL_ROUNDS) {
      finalText = texts.join("\n").trim() || "Esto necesita más pasos de los que puedo dar de una vez. ¿Lo dividimos?";
      break;
    }

    const assistantBlocks: BlockParams = [];
    for (const block of response.content) {
      if (block.type === "text") assistantBlocks.push({ type: "text", text: block.text });
      if (block.type === "tool_use") {
        assistantBlocks.push({ type: "tool_use", id: block.id, name: block.name, input: block.input });
      }
    }
    messages.push({ role: "assistant", content: assistantBlocks });

    const results: BlockParams = [];
    for (const call of toolUses) {
      usage.toolCalls += 1;
      const outcome = await executeTool(call.name, call.input, ctx);
      if (outcome.cards) cards.push(...outcome.cards);
      if (outcome.suggestions?.length) suggestions = outcome.suggestions.slice(0, 3);
      results.push({
        type: "tool_result",
        tool_use_id: call.id,
        content: JSON.stringify(outcome.data),
        is_error: outcome.isError,
      });
      await prisma.message.create({
        data: {
          conversationId,
          userId,
          role: "TOOL",
          content: { name: call.name, input: call.input, ok: !outcome.isError } as unknown as Prisma.InputJsonValue,
        },
      });
    }
    messages.push({ role: "user", content: results });
  }

  if (!finalText) {
    finalText = cards.length ? "Listo, aquí tienes el detalle." : "No tengo una respuesta para eso todavía.";
  }

  const saved = await prisma.message.create({
    data: {
      conversationId,
      userId,
      role: "ASSISTANT",
      text: finalText,
      content: {
        text: finalText,
        cards,
        ...(suggestions.length ? { suggestions } : {}),
      } as unknown as Prisma.InputJsonValue,
    },
    select: { id: true, createdAt: true },
  });

  await Promise.all([
    prisma.aiUsageLog.create({
      data: {
        userId,
        conversationId,
        module: input.module ?? "GENERAL",
        model: entitlements.model,
        inputTokens: usage.input,
        outputTokens: usage.output,
        cacheReadTokens: usage.cacheRead,
        toolCalls: usage.toolCalls,
      },
    }),
    prisma.conversation.update({ where: { id: conversationId }, data: { updatedAt: new Date() } }),
  ]);

  return {
    conversationId,
    message: {
      id: saved.id,
      role: "assistant",
      text: finalText,
      cards,
      ...(suggestions.length ? { suggestions } : {}),
      createdAt: saved.createdAt.toISOString(),
    },
  };
}

async function resolveConversation(
  userId: string,
  conversationId: string | undefined,
  module: AgentModule | undefined,
  firstMessage: string,
): Promise<string> {
  if (conversationId) {
    const exists = await prisma.conversation.findFirst({ where: { id: conversationId, userId }, select: { id: true } });
    if (!exists) throw Errors.notFound("La conversación");
    return conversationId;
  }
  const created = await prisma.conversation.create({
    data: { userId, module: module ?? "GENERAL", title: firstMessage.slice(0, 80) },
    select: { id: true },
  });
  return created.id;
}

async function executeTool(
  name: string,
  rawInput: unknown,
  ctx: ToolContext,
): Promise<{ data: unknown; cards?: AgentCard[]; suggestions?: string[]; isError: boolean }> {
  const tool = findTool(name);
  if (!tool) return { data: { error: `Herramienta desconocida: ${name}` }, isError: true };

  const parsed = tool.input.safeParse(rawInput);
  if (!parsed.success) {
    return {
      data: {
        error: "Parámetros inválidos",
        issues: parsed.error.issues.map((issue) => `${issue.path.map(String).join(".")}: ${issue.message}`),
      },
      isError: true,
    };
  }

  try {
    const result = await tool.run(parsed.data, ctx);
    return { data: result.data, cards: result.cards, suggestions: result.suggestions, isError: false };
  } catch (error) {
    if (!(error instanceof AppError)) log.error("agent.tool_failed", { tool: name, userId: ctx.userId, error });
    const message = error instanceof AppError ? error.message : "La herramienta falló. Intenta con otros datos.";
    if (isFreePlanLimit(error)) {
      // Límite del plan Gratis: el modelo lo explica en una frase y el chat muestra la tarjeta para pasarse a Pro.
      const details = (error as AppError).details as PlanLimitDetails;
      return { data: { error: message, plan_limit: true }, cards: [upgradeCard(message, details)], isError: true };
    }
    return { data: { error: message }, isError: true };
  }
}

/** La API exige empezar con "user"; además unimos turnos consecutivos del mismo rol. */
function normalizeHistory(items: { role: "user" | "assistant"; text: string }[]): Anthropic.MessageParam[] {
  const out: Anthropic.MessageParam[] = [];
  for (const item of items) {
    if (out.length === 0 && item.role !== "user") continue;
    const last = out[out.length - 1];
    if (last && last.role === item.role && typeof last.content === "string") {
      last.content = `${last.content}\n\n${item.text}`;
    } else {
      out.push({ role: item.role, content: item.text });
    }
  }
  return out;
}

function appendUserText(messages: Anthropic.MessageParam[], text: string) {
  const last = messages[messages.length - 1];
  if (last && last.role === "user" && typeof last.content === "string") {
    last.content = `${last.content}\n\n${text}`;
  } else {
    messages.push({ role: "user", content: text });
  }
}
