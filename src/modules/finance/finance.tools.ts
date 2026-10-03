import "server-only";
import { z } from "zod";
import { AppError } from "@/lib/errors";
import { money, shortDate } from "@/lib/format";
import { defineTool } from "@/modules/agent/registry";
import type { TransactionsCard } from "@/types/cards";
import { listBudgets, upsertBudget } from "./budgets.service";
import { proposeSubscriptionCancellation } from "./cancellation";
import {
  getAntExpenses,
  getFinanceOverview,
  getMonthlyTrend,
  getSubscriptions,
  listAccounts,
  searchTransactions,
  setSubscriptionUsage,
} from "./finance.service";
import { applyRecommendation, getLatestAnalysis, runFinancialAnalysis, toInsightsCard } from "./insights/analysis.service";
import { listBankConnections } from "./sync.service";

const NOT_CONNECTED = {
  connected: false,
  hint: "No hay cuentas conectadas ni estados de cuenta importados. Sugiere abrir Finanzas para conectar una cuenta, subir un estado de cuenta en PDF o CSV (si su banco no se puede conectar) o probar con datos de ejemplo.",
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const STALE_ANALYSIS_DAYS = 7;

export const financeTools = [
  defineTool({
    name: "finance_overview",
    module: "FINANCE",
    description:
      "Resume ingresos, gastos y ahorro promedio mensual de las cuentas y tarjetas conectadas, con las categorías principales y su cambio en los últimos 30 días (changePct). Úsala cuando pregunten cómo van o a dónde se va su dinero.",
    input: z.object({
      period_days: z.number().int().min(30).max(365).default(90).describe("Días hacia atrás a analizar."),
    }),
    async run({ period_days }, ctx) {
      const card = await getFinanceOverview(ctx.userId, period_days);
      if (!card) return { data: NOT_CONNECTED };
      return { data: card, cards: [card] };
    },
  }),

  defineTool({
    name: "finance_monthly_breakdown",
    module: "FINANCE",
    description:
      "Ingresos, gastos y saldo neto de los últimos 3 periodos de 30 días, para comparar mes a mes.",
    input: z.object({}),
    async run(_input, ctx) {
      const card = await getMonthlyTrend(ctx.userId, ctx.timezone);
      if (!card) return { data: NOT_CONNECTED };
      return { data: card, cards: [card] };
    },
  }),

  defineTool({
    name: "finance_get_insights",
    module: "FINANCE",
    description:
      "Informe de ahorro de los últimos 3 meses hecho con IA: salud financiera, hallazgos y recomendaciones con ahorro mensual estimado (cada una con su id). Si no hay uno reciente, lo genera. Úsala para consejos de ahorro o cuando pidan analizar sus finanzas.",
    input: z.object({
      refresh: z.boolean().default(false).describe("true para generar un análisis nuevo aunque haya uno reciente."),
    }),
    async run({ refresh }, ctx) {
      let analysis = await getLatestAnalysis(ctx.userId);
      const stale = !analysis || ctx.now.getTime() - analysis.createdAt.getTime() > STALE_ANALYSIS_DAYS * 86_400_000;
      let note: string | null = null;
      if (refresh || stale) {
        try {
          await runFinancialAnalysis(ctx.userId, { trigger: "CHAT", force: !analysis });
          analysis = await getLatestAnalysis(ctx.userId);
        } catch (error) {
          if (!(error instanceof AppError)) throw error;
          if (!analysis) return { data: { ...NOT_CONNECTED, detail: error.message } };
          note = error.message;
        }
      }
      if (!analysis) return { data: NOT_CONNECTED };
      const card = toInsightsCard(analysis);
      return {
        data: {
          note,
          analysisId: card.analysisId,
          generatedWith: card.source === "AI" ? "IA" : "reglas",
          period: card.periodLabel,
          health: card.health,
          headline: card.headline,
          summary: card.summary,
          keyPoints: card.keyPoints,
          totalMonthlySavings: card.totalMonthlySavings,
          recommendations: card.recommendations.map((r) => ({
            id: r.id,
            kind: r.kind,
            status: r.status,
            title: r.title,
            detail: r.detail,
            estimatedMonthlySavings: r.estimatedMonthlySavings,
          })),
        },
        cards: [card],
        suggestions: analysis.suggestedQuestions,
      };
    },
  }),

  defineTool({
    name: "finance_apply_recommendation",
    module: "FINANCE",
    description:
      "Aplica o descarta una recomendación del informe (id de finance_get_insights). Aplicar una cancelación la deja pendiente de aprobación; un presupuesto o una meta se crean al momento; el resto queda como recordatorio.",
    input: z.object({
      recommendation_id: z.string(),
      decision: z.enum(["accept", "dismiss"]),
    }),
    async run({ recommendation_id, decision }, ctx) {
      const result = await applyRecommendation(ctx.userId, recommendation_id, decision);
      return {
        data: { status: result.recommendation.status, message: result.recommendation.resultMessage },
        cards: result.approval ? [result.approval] : undefined,
      };
    },
  }),

  defineTool({
    name: "finance_search_transactions",
    module: "FINANCE",
    description:
      "Busca movimientos por comercio o texto, categoría, fechas, tipo y monto. Devuelve totales y los movimientos más recientes. Úsala para preguntas como \"¿cuánto gasté en EntregaYa en agosto?\".",
    input: z.object({
      query: z.string().max(80).optional().describe("Texto a buscar en el comercio o la descripción"),
      category: z.string().max(60).optional().describe("Categoría exacta, p. ej. Restaurantes, Delivery, Café y antojos"),
      from: z.string().regex(DATE_RE).optional().describe("Desde (AAAA-MM-DD)"),
      to: z.string().regex(DATE_RE).optional().describe("Hasta (AAAA-MM-DD)"),
      type: z.enum(["gasto", "ingreso"]).optional(),
      min_amount: z.number().min(0).optional(),
      max_amount: z.number().min(0).optional(),
      limit: z.number().int().min(1).max(25).default(10),
    }),
    async run(input, ctx) {
      const result = await searchTransactions(ctx.userId, {
        q: input.query,
        category: input.category,
        from: input.from ? new Date(`${input.from}T00:00:00Z`) : undefined,
        to: input.to ? new Date(`${input.to}T23:59:59Z`) : undefined,
        direction: input.type === "gasto" ? "DEBIT" : input.type === "ingreso" ? "CREDIT" : undefined,
        minAmount: input.min_amount,
        maxAmount: input.max_amount,
        limit: input.limit,
      });
      const currency = result.items[0]?.currency ?? ctx.currency;
      const titleParts = [
        input.query ? `“${input.query}”` : null,
        input.category ?? null,
        input.from || input.to
          ? `${input.from ? shortDate(`${input.from}T12:00:00Z`, "UTC") : "inicio"} al ${input.to ? shortDate(`${input.to}T12:00:00Z`, "UTC") : "hoy"}`
          : null,
      ].filter(Boolean);
      const card: TransactionsCard = {
        kind: "transactions",
        title: titleParts.length ? `Movimientos: ${titleParts.join(", ")}` : "Movimientos",
        currency,
        count: result.count,
        totalSpent: result.totalSpent,
        totalIncome: result.totalIncome,
        items: result.items.slice(0, 8),
      };
      return {
        data: {
          count: result.count,
          totalSpent: result.totalSpent,
          totalIncome: result.totalIncome,
          items: result.items.map((tx) => ({
            date: tx.postedAt.slice(0, 10),
            merchant: tx.merchantName ?? tx.description,
            amount: tx.amount,
            type: tx.direction === "DEBIT" ? "gasto" : "ingreso",
            category: tx.category,
            account: tx.accountLabel,
          })),
        },
        cards: result.count > 0 ? [card] : [],
      };
    },
  }),

  defineTool({
    name: "finance_ant_expenses",
    module: "FINANCE",
    description:
      "Detecta gastos hormiga: compras pequeñas y frecuentes (café, antojos, tienditas) agrupadas por comercio, con su proyección mensual.",
    input: z.object({
      period_days: z.number().int().min(14).max(120).default(30),
      max_amount: z
        .number()
        .positive()
        .max(100)
        .default(15)
        .describe("Monto máximo para considerar una compra como pequeña, en la moneda del usuario."),
    }),
    async run({ period_days, max_amount }, ctx) {
      const card = await getAntExpenses(ctx.userId, period_days, max_amount);
      if (!card) return { data: NOT_CONNECTED };
      return { data: card, cards: card.items.length > 0 ? [card] : [] };
    },
  }),

  defineTool({
    name: "finance_subscriptions",
    module: "FINANCE",
    description:
      "Lista suscripciones y cargos recurrentes. status UNUSED_SUSPECTED = sin uso reciente o el usuario dijo que no la usa. Devuelve los id necesarios para proponer cancelaciones o registrar el uso.",
    input: z.object({
      only_subscriptions: z
        .boolean()
        .default(true)
        .describe("true: solo servicios de suscripción. false: incluye renta, servicios y comisiones fijas."),
    }),
    async run({ only_subscriptions }, ctx) {
      const card = await getSubscriptions(ctx.userId, only_subscriptions);
      if (!card) return { data: { ...NOT_CONNECTED, note: "O todavía no se detectan cargos recurrentes." } };
      return { data: card, cards: [card] };
    },
  }),

  defineTool({
    name: "finance_mark_subscription_usage",
    module: "FINANCE",
    description:
      "Registra si el usuario usa o no una suscripción (id de finance_subscriptions). Es la señal más confiable para detectar suscripciones inactivas.",
    input: z.object({
      recurring_charge_id: z.string(),
      in_use: z.boolean(),
    }),
    async run({ recurring_charge_id, in_use }, ctx) {
      const charge = await setSubscriptionUsage(ctx.userId, recurring_charge_id, in_use);
      return { data: { merchant: charge.merchantName, status: charge.status } };
    },
  }),

  defineTool({
    name: "finance_propose_cancel_subscription",
    module: "FINANCE",
    description:
      "Propone cancelar una suscripción. NO la cancela: crea una solicitud que el usuario aprueba o rechaza en la app. Llama una vez por suscripción.",
    input: z.object({
      recurring_charge_id: z.string().describe("id obtenido de finance_subscriptions"),
      reason: z.string().max(280).describe("Motivo breve, p. ej. 'sin uso en 104 días'"),
    }),
    async run({ recurring_charge_id, reason }, ctx) {
      const result = await proposeSubscriptionCancellation(ctx.userId, recurring_charge_id, {
        reason,
        conversationId: ctx.conversationId,
        timeZone: ctx.timezone,
      });
      if (result.alreadyRequested || !result.card) {
        return { data: { alreadyRequested: true, merchant: result.merchant } };
      }
      return {
        data: { proposed: true, actionId: result.card.actionId, status: "pendiente de aprobación" },
        cards: [result.card],
      };
    },
  }),

  defineTool({
    name: "finance_set_budget",
    module: "FINANCE",
    description:
      "Crea o actualiza un presupuesto mensual para una categoría (no mueve dinero). Usa el nombre exacto de la categoría, como aparece en finance_overview.",
    input: z.object({
      category: z.string().min(2).max(60),
      monthly_limit: z.number().positive(),
    }),
    async run({ category, monthly_limit }, ctx) {
      const budget = await upsertBudget(ctx.userId, { category, monthlyLimit: monthly_limit, source: "agent" });
      const items = await listBudgets(ctx.userId);
      return {
        data: {
          saved: true,
          budget: `${budget.category}: ${money(budget.monthlyLimit, budget.currency)} al mes (${budget.pct}% usado este mes)`,
        },
        cards: [{ kind: "budgets", currency: budget.currency, items }],
      };
    },
  }),

  defineTool({
    name: "finance_list_accounts",
    module: "FINANCE",
    description: "Cuentas y tarjetas conectadas con saldo, límite de crédito, uso de la tarjeta y última sincronización.",
    input: z.object({}),
    async run(_input, ctx) {
      const [accounts, connections] = await Promise.all([listAccounts(ctx.userId), listBankConnections(ctx.userId)]);
      if (accounts.length === 0) return { data: NOT_CONNECTED };
      return {
        data: {
          accounts: accounts.map((a) => ({
            institution: a.institutionName,
            name: a.name,
            type: a.type,
            mask: a.mask,
            balance: a.currentBalance,
            creditLimit: a.creditLimit,
            creditUsePct:
              a.type === "CREDIT_CARD" && a.creditLimit && a.currentBalance !== null
                ? Math.round((a.currentBalance / a.creditLimit) * 100)
                : null,
            simulated: a.isSimulated,
          })),
          connections: connections.map((c) => ({ institution: c.institutionName, status: c.status, lastSyncedAt: c.lastSyncedAt })),
        },
      };
    },
  }),
];
