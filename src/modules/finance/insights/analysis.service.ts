import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { Prisma, SavingsRecommendation } from "@/generated/prisma/client";
import type { AnalysisTrigger } from "@/generated/prisma/enums";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { AppError, Errors } from "@/lib/errors";
import { money, shortDate } from "@/lib/format";
import { isUuid } from "@/lib/validation";
import { anthropic } from "@/modules/agent/anthropic";
import { getEntitlements } from "@/modules/billing/entitlements";
import { createGoal } from "@/modules/goals/goals.service";
import { createTask } from "@/modules/procedures/procedures.service";
import type { ApprovalCard, BudgetView, InsightsCard, RecommendationView } from "@/types/cards";
import { DAY_MS } from "../analyzers";
import { listBudgets, upsertBudget } from "../budgets.service";
import { proposeSubscriptionCancellation } from "../cancellation";
import { loadTransactions } from "../finance.service";
import { ANALYSIS_DAYS, buildSnapshot, type FinancialSnapshot } from "./metrics";
import {
  ANALYST_SYSTEM_PROMPT,
  REPORT_TOOL_NAME,
  buildAnalysisPrompt,
  draftFromModel,
  findUnsupportedAmounts,
  reportSchema,
  unsupportedAmountsFeedback,
} from "./report";
import { buildCandidates, rulesReport, type AnalysisDraft, type Candidate } from "./rules";

// Servicio de IA del asistente financiero:
// snapshot de 3 meses → candidatas por reglas → Claude redacta el informe (salida estructurada) → se guarda
// con recomendaciones accionables. Sin API key, o si el modelo falla, se usa el informe por reglas.

export const ANALYSIS_REQUEST_TEXT = "Analiza mis finanzas de los últimos 3 meses.";

const round2 = (n: number) => Math.round(n * 100) / 100;

type AnalysisWithRecommendations = Prisma.FinancialAnalysisGetPayload<{ include: { recommendations: true } }>;

export async function loadSnapshot(userId: string, timeZone?: string): Promise<FinancialSnapshot | null> {
  const accounts = await prisma.financialAccount.findMany({ where: { userId }, orderBy: { createdAt: "asc" } });
  if (accounts.length === 0) return null;
  const now = new Date();
  const [txs, recurring, budgets] = await Promise.all([
    loadTransactions(userId, new Date(now.getTime() - (ANALYSIS_DAYS + 1) * DAY_MS)),
    prisma.recurringCharge.findMany({ where: { userId, status: { not: "CANCELED" } } }),
    listBudgets(userId),
  ]);
  return buildSnapshot({
    txs,
    now,
    timeZone,
    currency: accounts[0].currency,
    accounts: accounts.map((a) => ({
      name: a.name,
      institution: a.institutionName,
      type: a.type,
      balance: a.currentBalance === null ? null : Number(a.currentBalance),
      creditLimit: a.creditLimit === null ? null : Number(a.creditLimit),
      simulated: a.isSimulated,
    })),
    recurring: recurring.map((r) => ({
      id: r.id,
      merchant: r.merchantName,
      amount: Number(r.amount),
      cadence: r.cadence,
      category: r.category,
      subcategory: r.subcategory,
      status: r.status,
      lastUsedAt: r.lastUsedAt,
      usageSource: r.usageSource,
    })),
    budgets: budgets.map((b) => ({ category: b.category, limit: b.monthlyLimit, spentThisMonth: b.spent })),
  });
}

/** Intentos del modelo: el primero y, si cita montos que no están en los datos, uno para corregirlos. */
const REPORT_ATTEMPTS = 2;

/**
 * Pide el informe a Claude con salida estructurada (tool use forzado) y revisa cada monto contra los datos.
 * Si alguno no sale de ellos, le pide una corrección; si sigue mal, lanza y se usa el informe por reglas.
 * Exportada para probarla con un cliente simulado.
 */
export async function generateWithClaude(snapshot: FinancialSnapshot, candidates: Candidate[], model: string) {
  const schema = z.toJSONSchema(reportSchema, { io: "input" }) as Record<string, unknown>;
  delete schema.$schema;
  const tool: Anthropic.Tool = {
    name: REPORT_TOOL_NAME,
    description: "Guarda el informe de ahorro del usuario con sus recomendaciones.",
    input_schema: schema as unknown as Anthropic.Tool["input_schema"],
  };

  const messages: Anthropic.MessageParam[] = [{ role: "user", content: buildAnalysisPrompt(snapshot, candidates) }];
  const usage = { input: 0, output: 0 };
  for (let attempt = 1; ; attempt++) {
    const response = await anthropic().messages.create({
      model,
      max_tokens: 2000,
      system: [{ type: "text", text: ANALYST_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      tools: [tool],
      // Salida estructurada: el modelo debe responder llamando a la herramienta con el esquema del informe.
      tool_choice: { type: "tool", name: REPORT_TOOL_NAME },
      messages,
    });
    usage.input += response.usage.input_tokens;
    usage.output += response.usage.output_tokens;

    const block = response.content.find((b) => b.type === "tool_use" && b.name === REPORT_TOOL_NAME);
    if (!block || block.type !== "tool_use") throw new Error("El modelo no devolvió el informe.");
    const parsed = reportSchema.safeParse(block.input);
    if (!parsed.success) {
      throw new Error(`Informe inválido: ${parsed.error.issues.map((i) => i.path.join(".")).join(", ")}`);
    }

    const unsupported = findUnsupportedAmounts(parsed.data, snapshot, candidates);
    if (unsupported.length === 0) return { draft: draftFromModel(parsed.data, candidates, snapshot), usage };
    if (attempt >= REPORT_ATTEMPTS) throw new Error(`El informe cita montos que no salen de los datos: ${unsupported.join(", ")}`);

    console.warn("[finance] el informe citó montos que no están en los datos; se pide corregirlo", unsupported);
    messages.push({ role: "assistant", content: [{ type: "tool_use", id: block.id, name: block.name, input: block.input }] });
    messages.push({
      role: "user",
      content: [{ type: "tool_result", tool_use_id: block.id, is_error: true, content: unsupportedAmountsFeedback(unsupported) }],
    });
  }
}

function waitLabel(minutes: number): string {
  if (minutes < 60) return `${Math.max(1, Math.ceil(minutes))} min`;
  const hours = Math.ceil(minutes / 60);
  return `${hours} ${hours === 1 ? "hora" : "horas"}`;
}

export async function runFinancialAnalysis(
  userId: string,
  opts: { trigger: AnalysisTrigger; force?: boolean },
): Promise<{ analysisId: string; card: InsightsCard }> {
  const [profile, entitlements, last] = await Promise.all([
    prisma.profile.findUnique({ where: { id: userId }, select: { timezone: true } }),
    getEntitlements(userId),
    prisma.financialAnalysis.findFirst({ where: { userId }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
  ]);

  if (!opts.force && last) {
    const minutes = entitlements.limits.analysisCooldownMinutes;
    const elapsed = (Date.now() - last.createdAt.getTime()) / 60_000;
    if (elapsed < minutes) {
      throw new AppError(
        429,
        "rate_limited",
        `Ya tienes un análisis reciente. Podrás pedir otro en ${waitLabel(minutes - elapsed)}.`,
      );
    }
  }

  const timeZone = profile?.timezone ?? "UTC";
  const snapshot = await loadSnapshot(userId, timeZone);
  if (!snapshot) throw Errors.badRequest("Conecta una cuenta o tarjeta, o sube un estado de cuenta, para analizar tus finanzas.");
  if (snapshot.dataQuality.transactions < 10) {
    throw Errors.badRequest(
      "Todavía hay muy pocos movimientos para un análisis útil. Sube más estados de cuenta o vuelve a intentarlo en unos días.",
    );
  }

  const candidates = buildCandidates(snapshot);
  let draft: AnalysisDraft = rulesReport(snapshot, candidates);
  let model: string | null = null;
  let usage = { input: 0, output: 0 };
  if (env().ANTHROPIC_API_KEY) {
    try {
      const result = await generateWithClaude(snapshot, candidates, entitlements.model);
      draft = result.draft;
      usage = result.usage;
      model = entitlements.model;
    } catch (error) {
      console.error("[finance] el análisis con IA falló; se usa el informe por reglas", error);
    }
  }

  const analysis = await persistAnalysis(userId, snapshot, draft, { trigger: opts.trigger, model, usage });
  return { analysisId: analysis.id, card: toInsightsCard(analysis) };
}

async function persistAnalysis(
  userId: string,
  snapshot: FinancialSnapshot,
  draft: AnalysisDraft,
  meta: { trigger: AnalysisTrigger; model: string | null; usage: { input: number; output: number } },
): Promise<AnalysisWithRecommendations> {
  // Las recomendaciones anteriores sin decidir quedan reemplazadas por las nuevas.
  await prisma.savingsRecommendation.updateMany({ where: { userId, status: "NEW" }, data: { status: "EXPIRED" } });

  const total = round2(draft.recommendations.reduce((sum, r) => sum + r.monthlySavings, 0));
  const analysis = await prisma.financialAnalysis.create({
    data: {
      userId,
      trigger: meta.trigger,
      source: draft.source,
      model: meta.model,
      periodStart: new Date(`${snapshot.period.from}T00:00:00Z`),
      periodEnd: new Date(`${snapshot.period.to}T00:00:00Z`),
      currency: snapshot.currency,
      health: draft.health,
      headline: draft.headline,
      summary: draft.summary,
      chatMessage: draft.chatMessage,
      keyPoints: draft.keyPoints,
      suggestedQuestions: draft.suggestedQuestions,
      totalMonthlySavings: total,
      metrics: snapshot as unknown as Prisma.InputJsonValue,
      inputTokens: meta.usage.input,
      outputTokens: meta.usage.output,
    },
  });

  const created: SavingsRecommendation[] = [];
  for (const [index, rec] of draft.recommendations.entries()) {
    created.push(
      await prisma.savingsRecommendation.create({
        data: {
          userId,
          analysisId: analysis.id,
          kind: rec.kind,
          difficulty: rec.difficulty,
          priority: index,
          title: rec.title,
          detail: rec.detail,
          estimatedMonthlySavings: rec.monthlySavings,
          currency: snapshot.currency,
          targetType: rec.target?.type ?? null,
          targetId: rec.target?.id ?? null,
          targetLabel: rec.target?.label ?? null,
          suggestedAmount: rec.suggestedAmount,
        },
      }),
    );
  }

  if (meta.model) {
    await prisma.aiUsageLog.create({
      data: {
        userId,
        module: "FINANCE",
        kind: "analysis",
        model: meta.model,
        inputTokens: meta.usage.input,
        outputTokens: meta.usage.output,
      },
    });
  }

  await prisma.appNotification.create({
    data: {
      userId,
      type: "INSIGHT",
      title: "Tu análisis financiero está listo",
      body: total > 0 ? `Encontré ${money(total, snapshot.currency)} al mes que puedes liberar.` : draft.headline,
      href: "/finanzas",
      data: { analysisId: analysis.id },
    },
  });
  await syncRecommendationIdeas(userId, created);
  await audit({
    userId,
    actor: "agent",
    action: "finance.analysis.created",
    entity: "financial_analysis",
    entityId: analysis.id,
    metadata: { source: draft.source, trigger: meta.trigger, recommendations: created.length },
  });

  return { ...analysis, recommendations: created };
}

/** Las 3 recomendaciones principales también aparecen en Ideas. */
async function syncRecommendationIdeas(userId: string, recommendations: SavingsRecommendation[]) {
  await prisma.suggestion.deleteMany({ where: { userId, status: "NEW", dedupeKey: { startsWith: "rec:" } } });
  for (const rec of recommendations.slice(0, 3)) {
    await prisma.suggestion.create({
      data: {
        userId,
        module: "FINANCE",
        type: rec.kind === "CANCEL_SUBSCRIPTION" ? "UNUSED_SUBSCRIPTION" : rec.kind === "REDUCE_ANT_EXPENSES" ? "ANT_EXPENSE" : "GENERAL",
        title: rec.title,
        body: rec.detail,
        prompt: `Quiero aplicar esta recomendación: “${rec.title}”.`,
        estimatedMonthlySavings: Number(rec.estimatedMonthlySavings) > 0 ? rec.estimatedMonthlySavings : null,
        currency: rec.currency,
        dedupeKey: `rec:${rec.id}`,
      },
    });
  }
}

export function toRecommendationView(rec: SavingsRecommendation): RecommendationView {
  const result = (rec.result ?? null) as { message?: string } | null;
  return {
    id: rec.id,
    kind: rec.kind,
    status: rec.status,
    difficulty: rec.difficulty,
    title: rec.title,
    detail: rec.detail,
    estimatedMonthlySavings: Number(rec.estimatedMonthlySavings),
    targetLabel: rec.targetLabel,
    resultMessage: result?.message ?? null,
  };
}

export function toInsightsCard(analysis: AnalysisWithRecommendations): InsightsCard {
  const health = analysis.health === "buena" || analysis.health === "en_riesgo" ? analysis.health : "estable";
  return {
    kind: "insights",
    analysisId: analysis.id,
    source: analysis.source,
    health,
    headline: analysis.headline,
    summary: analysis.summary,
    keyPoints: analysis.keyPoints,
    currency: analysis.currency,
    totalMonthlySavings: Number(analysis.totalMonthlySavings),
    periodLabel: `${shortDate(analysis.periodStart, "UTC")} al ${shortDate(analysis.periodEnd, "UTC")}`,
    createdAt: analysis.createdAt.toISOString(),
    recommendations: [...analysis.recommendations].sort((a, b) => a.priority - b.priority).map(toRecommendationView),
  };
}

export async function getLatestAnalysis(userId: string): Promise<AnalysisWithRecommendations | null> {
  const analysis = await prisma.financialAnalysis.findFirst({
    where: { userId },
    orderBy: { createdAt: "desc" },
    include: { recommendations: true },
  });
  return analysis as AnalysisWithRecommendations | null;
}

export async function getLatestInsights(userId: string): Promise<InsightsCard | null> {
  const analysis = await getLatestAnalysis(userId);
  return analysis ? toInsightsCard(analysis) : null;
}

/** Estado actual de las recomendaciones de tarjetas guardadas en el chat. */
export async function currentRecommendationViews(userId: string, analysisIds: string[]) {
  if (analysisIds.length === 0) return new Map<string, RecommendationView[]>();
  const recs = await prisma.savingsRecommendation.findMany({
    where: { userId, analysisId: { in: analysisIds } },
    orderBy: { priority: "asc" },
  });
  const map = new Map<string, RecommendationView[]>();
  for (const rec of recs) map.set(rec.analysisId, [...(map.get(rec.analysisId) ?? []), toRecommendationView(rec)]);
  return map;
}

export type RecommendationDecision = "accept" | "dismiss" | "done";

/**
 * Aplica una recomendación. Cancelar genera una propuesta en Aprobaciones (no cancela directo);
 * presupuestos y metas se crean al momento; el resto queda como recordatorio en trámites.
 */
export async function applyRecommendation(
  userId: string,
  recommendationId: string,
  decision: RecommendationDecision,
): Promise<{ recommendation: RecommendationView; approval: ApprovalCard | null; budget: BudgetView | null }> {
  if (!isUuid(recommendationId)) throw Errors.notFound("La recomendación");
  const rec = await prisma.savingsRecommendation.findFirst({ where: { id: recommendationId, userId } });
  if (!rec) throw Errors.notFound("La recomendación");

  const finish = async (status: "ACCEPTED" | "DISMISSED" | "DONE", result: Record<string, unknown> | null) => {
    const updated = await prisma.savingsRecommendation.update({
      where: { id: rec.id },
      data: { status, decidedAt: new Date(), ...(result ? { result: result as Prisma.InputJsonValue } : {}) },
    });
    await prisma.suggestion.updateMany({
      where: { userId, dedupeKey: `rec:${rec.id}` },
      data: { status: status === "DISMISSED" ? "DISMISSED" : "ACCEPTED" },
    });
    return toRecommendationView(updated);
  };

  if (decision === "dismiss") return { recommendation: await finish("DISMISSED", null), approval: null, budget: null };
  if (decision === "done") {
    return { recommendation: await finish("DONE", { message: "Marcada como hecha." }), approval: null, budget: null };
  }
  if (rec.status !== "NEW") throw Errors.conflict("Esta recomendación ya se aplicó o venció.");

  const amount = rec.suggestedAmount === null ? null : Number(rec.suggestedAmount);

  if (rec.kind === "CANCEL_SUBSCRIPTION" && rec.targetType === "recurring_charge" && rec.targetId) {
    const { card, alreadyRequested, merchant } = await proposeSubscriptionCancellation(userId, rec.targetId, {
      reason: rec.detail,
    });
    const message = alreadyRequested
      ? `La baja de ${merchant} ya estaba solicitada.`
      : `Dejé lista la baja de ${merchant} en Aprobaciones.`;
    return { recommendation: await finish("ACCEPTED", { message, actionId: card?.actionId ?? null }), approval: card, budget: null };
  }

  if (
    (rec.kind === "CATEGORY_BUDGET" || rec.kind === "REDUCE_ANT_EXPENSES") &&
    rec.targetType === "category" &&
    rec.targetLabel &&
    amount
  ) {
    const budget = await upsertBudget(userId, { category: rec.targetLabel, monthlyLimit: amount, source: "recommendation" });
    const message = `Presupuesto creado: ${money(budget.monthlyLimit, budget.currency)} al mes para ${budget.category.toLowerCase()}.`;
    return { recommendation: await finish("ACCEPTED", { message, budgetId: budget.id }), approval: null, budget };
  }

  if (rec.kind === "SAVINGS_GOAL" && amount) {
    const entitlements = await getEntitlements(userId);
    const goal = await createGoal(
      userId,
      {
        title: "Fondo de ahorro automático",
        category: "SAVINGS",
        description: "Lo que liberes con tus recomendaciones de ahorro.",
        targetAmount: null,
        currentAmount: 0,
        targetDate: null,
        currency: rec.currency,
        steps: ["Programar la transferencia el día de pago"],
        monthlyContribution: amount,
      },
      entitlements.limits.activeGoals,
      entitlements.plan,
    );
    const message = `Meta creada: apartar ${money(amount, rec.currency)} al mes.`;
    return { recommendation: await finish("ACCEPTED", { message, goalId: goal.id }), approval: null, budget: null };
  }

  const task = await createTask(userId, {
    title: rec.title,
    type: "REMINDER",
    priority: "MEDIUM",
    notes: rec.detail,
    dueAt: new Date(Date.now() + 7 * DAY_MS),
    remindAt: new Date(Date.now() + 2 * DAY_MS),
    source: "agent",
  });
  return {
    recommendation: await finish("ACCEPTED", { message: "Te dejé un recordatorio en tus trámites.", taskId: task.id }),
    approval: null,
    budget: null,
  };
}

/** Abre (o reutiliza) una conversación con Omni sembrada con el informe, para seguir con preguntas. */
export async function openAnalysisConversation(userId: string, analysisId: string): Promise<{ conversationId: string }> {
  if (!isUuid(analysisId)) throw Errors.notFound("El análisis");
  const analysis = (await prisma.financialAnalysis.findFirst({
    where: { id: analysisId, userId },
    include: { recommendations: true },
  })) as AnalysisWithRecommendations | null;
  if (!analysis) throw Errors.notFound("El análisis");

  if (analysis.conversationId) {
    const exists = await prisma.conversation.findFirst({ where: { id: analysis.conversationId, userId }, select: { id: true } });
    if (exists) return { conversationId: exists.id };
  }

  const conversation = await prisma.conversation.create({
    data: { userId, module: "FINANCE", title: analysis.headline.slice(0, 80) },
    select: { id: true },
  });
  const now = Date.now();
  await prisma.message.create({
    data: {
      conversationId: conversation.id,
      userId,
      role: "USER",
      text: ANALYSIS_REQUEST_TEXT,
      content: { text: ANALYSIS_REQUEST_TEXT },
      createdAt: new Date(now - 1000),
    },
  });
  await prisma.message.create({
    data: {
      conversationId: conversation.id,
      userId,
      role: "ASSISTANT",
      text: analysis.chatMessage,
      content: {
        text: analysis.chatMessage,
        cards: [toInsightsCard(analysis)],
        suggestions: analysis.suggestedQuestions,
      } as unknown as Prisma.InputJsonValue,
      createdAt: new Date(now),
    },
  });
  await prisma.financialAnalysis.update({ where: { id: analysis.id }, data: { conversationId: conversation.id } });
  return { conversationId: conversation.id };
}
