// Recomendaciones calculadas con reglas: son las "candidatas" que Claude prioriza y redacta,
// y el informe de respaldo cuando la IA no está disponible. Puras y deterministas.
import { money, signedPercent } from "@/lib/format";
import type { RecommendationKindId } from "@/types/cards";
import { ANT_CATEGORY } from "../categories";
import type { FinancialSnapshot } from "./metrics";

export type Difficulty = "EASY" | "MEDIUM" | "HARD";
export type Health = "buena" | "estable" | "en_riesgo";

export interface RecommendationTarget {
  type: "recurring_charge" | "category" | "merchant";
  id: string | null;
  label: string;
}

export interface Candidate {
  key: string;
  kind: RecommendationKindId;
  title: string;
  detail: string;
  monthlySavings: number;
  difficulty: Difficulty;
  target: RecommendationTarget | null;
  suggestedAmount: number | null;
}

export interface DraftRecommendation {
  kind: RecommendationKindId;
  title: string;
  detail: string;
  monthlySavings: number;
  difficulty: Difficulty;
  target: RecommendationTarget | null;
  suggestedAmount: number | null;
}

export interface AnalysisDraft {
  source: "AI" | "RULES";
  health: Health;
  headline: string;
  summary: string;
  keyPoints: string[];
  chatMessage: string;
  suggestedQuestions: string[];
  recommendations: DraftRecommendation[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const roundTo = (n: number, step: number) => Math.max(step, Math.round(n / step) * step);
const EXCLUDED_FROM_BUDGET = new Set(["Vivienda", "Servicios", "Suscripciones", "Comisiones e intereses", "Salud"]);

function listJoin(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} y ${items[items.length - 1]}`;
}

export function buildCandidates(s: FinancialSnapshot): Candidate[] {
  // Centavos solo en montos pequeños no redondos ($8.99 sí, $15 no).
  const m = (n: number) => money(n, s.currency);
  const out: Omit<Candidate, "key">[] = [];

  // 1. Suscripciones sin uso (o que el usuario marcó como no usadas)
  for (const sub of s.subscriptions.filter((x) => x.usage === "sin_uso")) {
    out.push({
      kind: "CANCEL_SUBSCRIPTION",
      title: `Cancela ${sub.merchant}`,
      detail:
        sub.lastUsedDaysAgo !== null && !sub.usageConfirmedByUser
          ? `No la usas hace ${sub.lastUsedDaysAgo} días y te cuesta ${m(sub.monthly)} al mes.`
          : `Dijiste que no la usas y te cuesta ${m(sub.monthly)} al mes.`,
      monthlySavings: sub.monthly,
      difficulty: "EASY",
      target: { type: "recurring_charge", id: sub.id, label: sub.merchant },
      suggestedAmount: null,
    });
  }

  // 2. Servicios duplicados del mismo tipo (solo entre los que sí se usan)
  for (const overlap of s.overlaps) {
    const active = s.subscriptions.filter((x) => x.kind === overlap.kind && (x.usage === "en_uso" || x.usage === "sin_datos"));
    if (active.length < 2) continue;
    const cheapest = [...active].sort((a, b) => a.monthly - b.monthly)[0];
    out.push({
      kind: "CANCEL_SUBSCRIPTION",
      title: `Quédate con un solo servicio de ${overlap.label}`,
      detail: `Pagas ${listJoin(active.map((x) => x.merchant))}. Con uno solo ahorras al menos ${m(cheapest.monthly)} al mes.`,
      monthlySavings: cheapest.monthly,
      difficulty: "MEDIUM",
      target: { type: "recurring_charge", id: cheapest.id, label: cheapest.merchant },
      suggestedAmount: null,
    });
  }

  // 3. Gastos hormiga
  if (s.antExpenses.monthlyTotal >= 40) {
    const cut = round2(s.antExpenses.monthlyTotal * 0.4);
    const monthlyCap = roundTo(s.antExpenses.monthlyTotal - cut, 5);
    const weeklyCap = roundTo(monthlyCap / 4.3, 1);
    const names = s.antExpenses.merchants.slice(0, 2).map((x) => x.merchant);
    out.push({
      kind: "REDUCE_ANT_EXPENSES",
      title: `Tope de ${m(weeklyCap)} a la semana para antojos`,
      detail: `${listJoin(names)} y otras compras pequeñas suman ${m(s.antExpenses.monthlyTotal)} al mes. Con ese tope ahorras cerca de ${m(cut)}.`,
      monthlySavings: cut,
      difficulty: "MEDIUM",
      target: { type: "category", id: null, label: ANT_CATEGORY },
      suggestedAmount: monthlyCap,
    });
  }

  // 4. Categorías que se dispararon en el último mes (máximo 2)
  const spikes = s.categories
    .filter((c) => c.changePct !== null && c.changePct >= 25 && c.lastMonth >= 150 && !EXCLUDED_FROM_BUDGET.has(c.name))
    .slice(0, 2);
  for (const c of spikes) {
    const previousAverage = Math.max(0, (c.monthlyAverage * 3 - c.lastMonth) / 2);
    const limit = roundTo(previousAverage, 10);
    const savings = round2(Math.max(0, c.lastMonth - limit));
    if (savings < 15) continue;
    out.push({
      kind: "CATEGORY_BUDGET",
      title: `Presupuesto de ${m(limit)} al mes en ${c.name.toLowerCase()}`,
      detail: `El último mes gastaste ${m(c.lastMonth)} (${signedPercent(c.changePct ?? 0)} vs. tu promedio). Volver a tu nivel anterior libera ${m(savings)}.`,
      monthlySavings: savings,
      difficulty: "MEDIUM",
      target: { type: "category", id: null, label: c.name },
      suggestedAmount: limit,
    });
  }

  // 5. Comisiones e intereses
  const feesMonthly = round2(s.avoidableFees.reduce((sum, fee) => sum + fee.monthly, 0));
  if (feesMonthly >= 5) {
    const feesPeriod = round2(s.avoidableFees.reduce((sum, fee) => sum + fee.totalPeriod, 0));
    out.push({
      kind: "AVOID_FEES",
      title: "Deja de pagar intereses y comisiones",
      detail: `${listJoin(s.avoidableFees.slice(0, 3).map((f) => f.concept))} te costaron ${m(feesPeriod)} en 3 meses. Pagar el total de la tarjeta a tiempo con débito automático las elimina casi todas.`,
      monthlySavings: feesMonthly,
      difficulty: "EASY",
      target: { type: "merchant", id: null, label: s.avoidableFees[0]?.concept ?? "Comisiones" },
      suggestedAmount: null,
    });
  }

  // 6. Servicios fijos negociables (internet, celular)
  const services = s.fixedCharges.filter((c) => c.category === "Servicios");
  const servicesMonthly = round2(services.reduce((sum, c) => sum + c.monthly, 0));
  if (servicesMonthly >= 90) {
    const savings = round2(servicesMonthly * 0.15);
    out.push({
      kind: "NEGOTIATE_BILL",
      title: "Pide un mejor plan de internet y celular",
      detail: `${listJoin(services.map((c) => c.merchant))} suman ${m(servicesMonthly)} al mes. Cambiar de plan o pedir una promoción suele bajar la cuenta un 15%.`,
      monthlySavings: savings,
      difficulty: "MEDIUM",
      target: { type: "merchant", id: null, label: services[0].merchant },
      suggestedAmount: null,
    });
  }

  // 7. Mover lo ahorrado a una meta (cuando la tasa de ahorro es baja)
  const potential = out.reduce((sum, c) => sum + c.monthlySavings, 0);
  if (s.averages.savingsRatePct < 15 && potential >= 20) {
    const amount = roundTo(potential, 10);
    out.push({
      kind: "SAVINGS_GOAL",
      title: `Aparta ${m(amount)} al mes en automático`,
      detail: `Si aplicas estas ideas liberas cerca de ${m(potential)} al mes. Moverlos a una meta el día de tu pago evita que se gasten.`,
      monthlySavings: 0,
      difficulty: "EASY",
      target: null,
      suggestedAmount: amount,
    });
  }

  return out
    .sort((a, b) => b.monthlySavings - a.monthlySavings)
    .slice(0, 7)
    .map((candidate, index) => ({ ...candidate, key: `c${index + 1}` }));
}

export function healthFrom(s: FinancialSnapshot): Health {
  const rate = s.averages.savingsRatePct;
  const creditUse = Math.max(0, ...s.accounts.map((a) => a.creditUsePct ?? 0));
  if (rate < 5 || s.averages.net < 0) return "en_riesgo";
  if (rate >= 15 && creditUse < 50) return "buena";
  return "estable";
}

/** Informe completo sin IA (respaldo y modo desarrollo). */
export function rulesReport(s: FinancialSnapshot, candidates: Candidate[]): AnalysisDraft {
  const m = (n: number) => money(n, s.currency);
  const total = round2(candidates.reduce((sum, c) => sum + c.monthlySavings, 0));
  const unused = s.subscriptions.filter((x) => x.usage === "sin_uso");
  const topCategory = s.categories[0];
  const biggestJump = s.categories.find((c) => (c.changePct ?? 0) >= 25);

  const summaryParts = [
    `En los últimos 3 meses entraron ${m(s.averages.income)} al mes en promedio y salieron ${m(s.averages.spending)}; te quedan ${m(s.averages.net)} (${s.averages.savingsRatePct}% de tu ingreso).`,
  ];
  if (unused.length > 0) {
    summaryParts.push(
      `Tienes ${unused.length} ${unused.length === 1 ? "suscripción" : "suscripciones"} sin uso que ${unused.length === 1 ? "cuesta" : "suman"} ${money(round2(unused.reduce((a, x) => a + x.monthly, 0)), s.currency, { cents: true })} al mes.`,
    );
  }
  if (s.antExpenses.monthlyTotal >= 40) {
    summaryParts.push(`Tus gastos hormiga llegan a ${m(s.antExpenses.monthlyTotal)} al mes.`);
  }

  const keyPoints = [
    topCategory ? `Tu mayor gasto es ${topCategory.name.toLowerCase()}: ${m(topCategory.monthlyAverage)} al mes.` : null,
    biggestJump
      ? `${biggestJump.name} subió ${signedPercent(biggestJump.changePct ?? 0)} en el último mes.`
      : null,
    s.antExpenses.merchants[0]
      ? `${s.antExpenses.merchants[0].merchant}: ${s.antExpenses.merchants[0].purchasesPerMonth} compras al mes.`
      : null,
    s.avoidableFees.length > 0
      ? `Pagaste ${m(round2(s.avoidableFees.reduce((a, f) => a + f.totalPeriod, 0)))} en comisiones e intereses.`
      : null,
  ].filter((x): x is string => x !== null);

  const headline =
    total > 0 ? `Puedes liberar ${m(total)} al mes sin tocar lo esencial` : "Tus finanzas van en orden este trimestre";
  const first = candidates[0];

  return {
    source: "RULES",
    health: healthFrom(s),
    headline,
    summary: summaryParts.join(" "),
    keyPoints: keyPoints.slice(0, 4),
    chatMessage: first
      ? `Revisé tus últimos 3 meses: ${headline.charAt(0).toLowerCase()}${headline.slice(1)}. Lo que más te ayuda: ${first.title.charAt(0).toLowerCase()}${first.title.slice(1)}. ¿Empezamos por ahí?`
      : "Revisé tus últimos 3 meses y no encontré fugas importantes. ¿Quieres que armemos un presupuesto o una meta de ahorro?",
    suggestedQuestions: [
      biggestJump ? `¿Por qué subió mi gasto en ${biggestJump.name.toLowerCase()}?` : "¿En qué gasto más cada mes?",
      "Ayúdame a armar un presupuesto realista",
      unused.length > 0 ? "Prepara las bajas de lo que no uso" : "¿Cómo puedo ahorrar más cada mes?",
    ],
    recommendations: candidates.map(({ key: _key, ...rest }) => rest),
  };
}
