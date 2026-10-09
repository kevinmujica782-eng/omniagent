import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import type { AgentModule } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { AppError, Errors, isFreePlanLimit, type PlanLimitDetails } from "@/lib/errors";
import { log } from "@/lib/log";
import { preferredProviderOf } from "@/modules/ai/ai.catalog";
import { aiRouter, logAIUsage, tierForPlan } from "@/modules/ai/ai.service";
import type { AIMessage, AISystemPart, AIToolDefinition } from "@/modules/ai/ai.types";
import { assertCanSendMessage, getEntitlements } from "@/modules/billing/entitlements";
import { upgradeCard } from "@/modules/billing/upgrade";
import { buildAgentMemory } from "@/modules/memory/memory.service";
import type { AnsweredBy, ChatMessageView } from "@/types/cards";
import { buildSystemPrompt } from "./prompts";
import { toAITool, type ToolContext } from "./registry";
import { runToolLoop, type ToolOutcome } from "./tool-loop";
import { ALL_TOOLS, findTool } from "./tools";

const MAX_TOOL_ROUNDS = 6;
const HISTORY_LIMIT = 20;
const MAX_OUTPUT_TOKENS = 1500;
/** Tiempo del turno completo (la ruta tiene 60 s; queda margen para guardar y responder). */
const TURN_BUDGET_MS = 52_000;

let toolDefinitions: AIToolDefinition[] | undefined;

/** Las herramientas de todos los módulos para el router (se arman una vez por instancia). */
function agentTools(): AIToolDefinition[] {
  toolDefinitions ??= ALL_TOOLS.map(toAITool);
  return toolDefinitions;
}

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
 * Un turno del agente: guarda el mensaje del usuario, llama a la IA por el router (el modelo que eligió la persona o
 * el del orden configurado, con respaldo si falla) con las herramientas de todos los módulos, ejecuta las llamadas a
 * funciones (máx. MAX_TOOL_ROUNDS rondas), guarda la respuesta con sus tarjetas y registra el consumo para la cuota.
 */
export async function runAgent(input: RunAgentInput): Promise<RunAgentResult> {
  const { userId } = input;
  const text = input.message.trim();
  if (!text) throw Errors.badRequest("Escribe un mensaje.");
  const deadline = Date.now() + TURN_BUDGET_MS;

  const [profile, entitlements] = await Promise.all([
    prisma.profile.findUnique({
      where: { id: userId },
      select: { fullName: true, currency: true, timezone: true, preferences: true },
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
  // Memoria de Omni: lo más relevante para este mensaje. Si falla, el turno sigue sin ella.
  const memory = await buildAgentMemory(userId, {
    query: text,
    now,
    timeZone: profile.timezone,
    excludeConversationId: conversationId,
  }).catch((error: unknown) => {
    log.warn("agent.memory_unavailable", { userId, error });
    return null;
  });
  // Caché de Claude: herramientas + parte fija del sistema se reutilizan entre turnos (menos costo y latencia). El
  // segundo punto de caché (después de la memoria) sirve entre las rondas de herramientas de este mismo turno. Los
  // demás proveedores reciben las partes en un solo texto (OpenAI y Gemini guardan su caché solos).
  const system: AISystemPart[] = [
    { text: prompt.stable, cache: true },
    memory?.text ? { text: `${prompt.dynamic}\n\n${memory.text}`, cache: true } : { text: prompt.dynamic },
  ];

  const result = await runToolLoop({
    complete: (request) => aiRouter().complete(request),
    system,
    messages,
    tools: agentTools(),
    tier: tierForPlan(entitlements.plan),
    provider: preferredProviderOf(profile.preferences),
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    maxRounds: MAX_TOOL_ROUNDS,
    deadline,
    execute: async (call) => {
      const outcome = await executeTool(call.name, call.arguments, ctx);
      await prisma.message.create({
        data: {
          conversationId,
          userId,
          role: "TOOL",
          content: { name: call.name, input: call.arguments, ok: !outcome.isError } as unknown as Prisma.InputJsonValue,
        },
      });
      return outcome;
    },
  });

  if (result.interrupted) {
    log.warn("agent.turn_interrupted", { userId, conversationId, provider: result.provider, code: result.interrupted, toolCalls: result.toolCalls });
  }
  const { cards, suggestions } = result;
  let finalText = result.text;
  if (!finalText) {
    finalText = cards.length ? "Listo, aquí tienes el detalle." : "No tengo una respuesta para eso todavía.";
  }
  const answeredBy: AnsweredBy = { provider: result.provider, model: result.model, fallbackFrom: result.fallbackFrom };

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
        ai: answeredBy,
      } as unknown as Prisma.InputJsonValue,
    },
    select: { id: true, createdAt: true },
  });

  await Promise.all([
    logAIUsage(
      { userId, conversationId, module: input.module ?? "GENERAL", kind: "chat" },
      {
        provider: result.provider,
        model: result.model,
        inputTokens: result.usage.input,
        outputTokens: result.usage.output,
        cachedInputTokens: result.usage.cached,
        toolCalls: result.toolCalls,
      },
    ),
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
      ai: answeredBy,
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

async function executeTool(name: string, rawInput: unknown, ctx: ToolContext): Promise<ToolOutcome> {
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

/** Las APIs exigen empezar con la persona; además se unen turnos consecutivos del mismo rol. */
function normalizeHistory(items: { role: "user" | "assistant"; text: string }[]): AIMessage[] {
  const out: AIMessage[] = [];
  for (const item of items) {
    if (out.length === 0 && item.role !== "user") continue;
    const last = out.at(-1);
    if (last && last.role === item.role && typeof last.content === "string") {
      last.content = `${last.content}\n\n${item.text}`;
    } else {
      out.push(item.role === "user" ? { role: "user", content: item.text } : { role: "assistant", content: item.text });
    }
  }
  return out;
}

function appendUserText(messages: AIMessage[], text: string) {
  const last = messages.at(-1);
  if (last && last.role === "user" && typeof last.content === "string") {
    last.content = `${last.content}\n\n${text}`;
  } else {
    messages.push({ role: "user", content: text });
  }
}
