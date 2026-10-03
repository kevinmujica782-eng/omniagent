import "server-only";
import type { Suggestion } from "@/generated/prisma/client";
import type { AgentModule, SuggestionType } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { Errors } from "@/lib/errors";
import { money, shortDate } from "@/lib/format";
import { isUuid } from "@/lib/validation";
import { DAY_MS, monthlyEquivalent } from "@/modules/finance/analyzers";
import { getAntExpenses, getFinanceOverview } from "@/modules/finance/finance.service";
import { OPEN_TASK_STATUSES } from "@/modules/procedures/procedures.service";
import type { IdeaView } from "@/types/cards";

// "Ideas": el agente mira los datos del usuario y propone cosas que puede resolver por él.
// Cada idea tiene una dedupe_key para no repetirse; si el usuario la descarta, no vuelve a aparecer.

const round2 = (n: number) => Math.round(n * 100) / 100;

function listJoin(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} y ${items[items.length - 1]}`;
}

function monthKey(now = new Date()): string {
  return now.toISOString().slice(0, 7);
}

export function starterIdeas(): IdeaView[] {
  const base = { estimatedMonthlySavings: null, currency: null, starter: true } as const;
  return [
    {
      ...base,
      id: "starter-finance",
      module: "FINANCE",
      title: "Descubre a dónde se va tu dinero",
      body: "Conecta el banco de prueba y te muestro tus gastos, las suscripciones que no usas y tus gastos hormiga.",
      prompt: "¿A dónde se fue mi dinero los últimos 3 meses?",
    },
    {
      ...base,
      id: "starter-concierge",
      module: "CONCIERGE",
      title: "Vigila el precio de algo que quieras",
      body: "Dime qué producto, vuelo o boleto buscas y a qué precio lo comprarías. Te aviso cuando baje.",
      prompt: "Quiero que vigiles el precio de algo que quiero comprar.",
    },
    {
      ...base,
      id: "starter-procedures",
      module: "PROCEDURES",
      title: "Encuentra los trámites de tu correo",
      body: "Permisos escolares, citas, reembolsos y facturas: te propongo cuándo hacerlos, lleno los formularios y te aviso a tiempo.",
      prompt: "Revisa mi correo y dime qué trámites tengo",
    },
    {
      ...base,
      id: "starter-goals",
      module: "GOALS",
      title: "Convierte una meta en un plan",
      body: "Un viaje, un carro o un fondo de emergencia: te propongo cuánto apartar cada mes para llegar.",
      prompt: "Quiero crear una meta de ahorro.",
    },
  ];
}

type Draft = {
  module: AgentModule;
  type: SuggestionType;
  title: string;
  body: string;
  prompt: string;
  dedupeKey: string;
  estimatedMonthlySavings?: number | null;
  currency?: string | null;
  expiresAt?: Date | null;
};

async function save(userId: string, draft: Draft) {
  await prisma.suggestion.upsert({
    where: { userId_dedupeKey: { userId, dedupeKey: draft.dedupeKey } },
    create: {
      userId,
      module: draft.module,
      type: draft.type,
      title: draft.title,
      body: draft.body,
      prompt: draft.prompt,
      dedupeKey: draft.dedupeKey,
      estimatedMonthlySavings: draft.estimatedMonthlySavings ?? null,
      currency: draft.currency ?? null,
      expiresAt: draft.expiresAt ?? null,
    },
    update: {}, // no se pisa el estado (si la descartó, sigue descartada)
  });
}

async function financeDrafts(userId: string, now: Date, drafts: Draft[]) {
  // Suscripciones sin uso
  const unused = await prisma.recurringCharge.findMany({
    where: { userId, status: "UNUSED_SUSPECTED" },
    orderBy: { amount: "desc" },
  });
  if (unused.length > 0) {
    const names = unused.map((u) => u.merchantName);
    const total = round2(unused.reduce((sum, u) => sum + monthlyEquivalent(Number(u.amount), u.cadence), 0));
    const currency = unused[0].currency;
    drafts.push({
      module: "FINANCE",
      type: "UNUSED_SUBSCRIPTION",
      title: unused.length === 1 ? `Puedo darte de baja de ${names[0]}` : `Puedo darte de baja de ${unused.length} suscripciones`,
      body: `${listJoin(names)} ${unused.length === 1 ? "lleva" : "llevan"} más de 60 días sin uso. Son ${money(total, currency, { cents: true })} al mes.`,
      prompt: "¿Qué suscripciones estoy pagando y no uso? Propón cancelar las que no uso.",
      dedupeKey: `unused-subs:${[...names].sort().join("|")}`,
      estimatedMonthlySavings: total,
      currency,
    });
  }

  // Gastos hormiga del último mes
  const ant = await getAntExpenses(userId, 30, 15);
  if (ant && ant.monthlyProjection >= 40 && ant.items.length > 0) {
    const top = ant.items.slice(0, 2);
    const purchases = top.reduce((sum, item) => sum + item.count, 0);
    drafts.push({
      module: "FINANCE",
      type: "ANT_EXPENSE",
      title: `Tus gastos hormiga suman ${money(ant.monthlyProjection, ant.currency)} al mes`,
      body: `${listJoin(top.map((i) => i.merchant))} concentran ${purchases} compras pequeñas. Te propongo un tope semanal realista.`,
      prompt: "Muéstrame mis gastos hormiga y propón un tope semanal realista.",
      dedupeKey: `ant:${monthKey(now)}`,
    });
  }

  // Categoría que se disparó en los últimos 30 días
  const overview = await getFinanceOverview(userId, 90);
  const spike = overview?.topCategories.find(
    (c) => c.changePct !== null && c.changePct >= 30 && c.monthly >= 150 && c.name !== "Vivienda",
  );
  if (spike && spike.changePct !== null) {
    drafts.push({
      module: "FINANCE",
      type: "GENERAL",
      title: `${spike.name} subió ${spike.changePct}% este mes`,
      body: `En los últimos 30 días gastaste más que tu promedio en ${spike.name.toLowerCase()}. Te muestro de dónde viene y cómo bajarlo.`,
      prompt: `¿Por qué subió mi gasto en ${spike.name} y cómo lo bajo?`,
      dedupeKey: `spike:${spike.name}:${monthKey(now)}`,
    });
  }
}

/** Recalcula las ideas a partir de finanzas, trámites y metas. Es barato: se llama al abrir Ideas. */
export async function refreshSuggestions(userId: string): Promise<void> {
  const now = new Date();
  const profile = await prisma.profile.findUnique({ where: { id: userId }, select: { timezone: true } });
  const timezone = profile?.timezone ?? "UTC";
  const drafts: Draft[] = [];
  const recentAnalysis = await prisma.financialAnalysis.count({
    where: { userId, createdAt: { gte: new Date(now.getTime() - 35 * DAY_MS) } },
  });
  // Con un análisis reciente, las ideas de finanzas vienen de sus recomendaciones (ver analysis.service).
  if (recentAnalysis === 0) await financeDrafts(userId, now, drafts);

  // Trámites detectados en el correo que esperan confirmación
  const suggested = await prisma.task.count({ where: { userId, status: "SUGGESTED" } });
  if (suggested > 0) {
    drafts.push({
      module: "PROCEDURES",
      type: "TASK_DUE",
      title: suggested === 1 ? "Tienes un trámite por confirmar" : `Tienes ${suggested} trámites por confirmar`,
      body: "Los encontré en tu correo y ya les propuse fechas. Confírmalos con un toque en Trámites.",
      prompt: "¿Qué trámites encontraste en mi correo?",
      dedupeKey: `suggested:${now.toISOString().slice(0, 10)}`,
      expiresAt: new Date(now.getTime() + DAY_MS),
    });
  }

  // Trámites que vencen en los próximos 3 días
  const dueSoon = await prisma.task.findMany({
    where: {
      userId,
      status: { in: [...OPEN_TASK_STATUSES] },
      dueAt: { gte: now, lte: new Date(now.getTime() + 3 * DAY_MS) },
    },
    orderBy: { dueAt: "asc" },
    take: 3,
  });
  for (const task of dueSoon) {
    drafts.push({
      module: "PROCEDURES",
      type: "TASK_DUE",
      title: `Vence el ${shortDate(task.dueAt, timezone)}: ${task.title}`,
      body: task.notes ?? "Te ayudo a dejarlo listo antes de la fecha.",
      prompt: `Ayúdame con el trámite “${task.title}”.`,
      dedupeKey: `task-due:${task.id}`,
      expiresAt: task.dueAt,
    });
  }

  // Aporte del mes para metas con fecha
  const goals = await prisma.goal.findMany({
    where: { userId, status: "ACTIVE", monthlyContribution: { not: null }, targetDate: { not: null } },
    take: 2,
  });
  for (const goal of goals) {
    drafts.push({
      module: "GOALS",
      type: "GOAL_TIP",
      title: `Aparta ${money(Number(goal.monthlyContribution), goal.currency)} para “${goal.title}”`,
      body: `Con ese aporte este mes llegas a tu meta el ${shortDate(goal.targetDate, "UTC")}.`,
      prompt: `¿Cómo voy con mi meta “${goal.title}”? Ayúdame a apartar lo de este mes.`,
      dedupeKey: `goal-tip:${goal.id}:${monthKey(now)}`,
    });
  }

  for (const draft of drafts) await save(userId, draft);
}

function toIdeaView(row: Suggestion): IdeaView {
  return {
    id: row.id,
    module: row.module,
    title: row.title,
    body: row.body,
    prompt: row.prompt,
    estimatedMonthlySavings: row.estimatedMonthlySavings === null ? null : Number(row.estimatedMonthlySavings),
    currency: row.currency,
    starter: false,
  };
}

export async function listSuggestions(userId: string, take = 20): Promise<IdeaView[]> {
  const rows = await prisma.suggestion.findMany({
    where: { userId, status: "NEW", OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
    orderBy: { createdAt: "desc" },
    take,
  });
  return rows.map(toIdeaView);
}

export async function setSuggestionStatus(userId: string, id: string, status: "ACCEPTED" | "DISMISSED") {
  if (!isUuid(id)) throw Errors.notFound("La idea");
  const updated = await prisma.suggestion.updateMany({ where: { id, userId }, data: { status } });
  if (updated.count === 0) throw Errors.notFound("La idea");
  return { id, status };
}
