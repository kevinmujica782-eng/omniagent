// Lo que muestra la pantalla de Omni Pro: la comparación de planes y el trabajo que los agentes hacen solos.
// Todo sale de PLANS (el mismo lugar con el que el servidor valida los límites), así la pantalla nunca promete
// algo distinto de lo que se cobra y se entrega. Puro: lo usan la pantalla, la vista previa y las pruebas.
import type { PlanLimitDetails } from "@/lib/errors";
import { cadenceText, PLANS, type AgentFeatureId, type PlanLimits } from "./plans";

export type PaywallRowId = "messages" | "mail" | "prices" | "analysis" | "alerts" | "forms" | "goals" | "model" | "approvals";

export interface PaywallRow {
  id: PaywallRowId;
  label: string;
  /** Texto de cada plan, o `true` si la función está incluida (se muestra con una marca). */
  free: string | true;
  pro: string | true;
}

const n = (value: number) => value.toLocaleString("es-US");
const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** Filas de la comparación Gratis / Pro, en el orden en que se leen. */
export function paywallRows(free: PlanLimits = PLANS.FREE, pro: PlanLimits = PLANS.PRO): PaywallRow[] {
  const mail = (plan: PlanLimits) => capitalize(cadenceText(plan.mailCheckHours * 60));
  const prices = (plan: PlanLimits) => `${plan.watchlistItems}, ${cadenceText(plan.priceCheckMinutes)}`;
  const analysis = (plan: PlanLimits) => (plan.features.monthly_report ? "Informe mensual automático" : "Cuando lo pides");
  const alerts = (plan: PlanLimits) => (plan.features.ai_alerts ? "Con la lectura de Omni" : "Estándar");
  const model = (plan: PlanLimits) => (plan.features.advanced_model ? "El más capaz" : "Rápido");
  return [
    { id: "messages", label: "Mensajes con Omni", free: `${n(free.monthlyMessages)} al mes`, pro: `${n(pro.monthlyMessages)} al mes` },
    { id: "mail", label: "Revisión de tu correo", free: mail(free), pro: mail(pro) },
    { id: "prices", label: "Precios vigilados", free: prices(free), pro: prices(pro) },
    { id: "analysis", label: "Análisis de gastos", free: analysis(free), pro: analysis(pro) },
    { id: "alerts", label: "Alertas de ofertas", free: alerts(free), pro: alerts(pro) },
    { id: "forms", label: "Formularios con IA", free: `${n(free.monthlyFormReads)} al mes`, pro: `${n(pro.monthlyFormReads)} al mes` },
    { id: "goals", label: "Metas activas", free: n(free.activeGoals), pro: n(pro.activeGoals) },
    { id: "model", label: "Modelo de IA", free: model(free), pro: model(pro) },
    // En los dos planes: ninguna compra sale sin Permitir.
    { id: "approvals", label: "Compras con Permitir o Denegar", free: true, pro: true },
  ];
}

/** Revisiones que los agentes hacen solos en un día (el trabajo programado corre cada hora). */
export function autopilotPerDay(plan: PlanLimits): { prices: number; mail: number } {
  return {
    prices: Math.max(1, Math.floor((24 * 60) / plan.priceCheckMinutes)),
    mail: Math.max(1, Math.floor(24 / plan.mailCheckHours)),
  };
}

/** Lo mismo en un mes de 30 días: revisiones de cada precio y de tu correo que ya no haces tú. */
export function autopilotPerMonth(plan: PlanLimits): { prices: number; mail: number } {
  const day = autopilotPerDay(plan);
  return { prices: day.prices * 30, mail: day.mail * 30 };
}

const FEATURE_ROW: Record<AgentFeatureId, PaywallRowId> = {
  mail_autopilot: "mail",
  monthly_report: "analysis",
  hourly_prices: "prices",
  ai_alerts: "alerts",
  advanced_model: "model",
};

/** La fila que explica el límite con el que chocó la persona (para marcarla en la comparación). */
export function rowForLimit(limit: PlanLimitDetails["reason"] | string | null | undefined, feature: string | null | undefined): PaywallRowId | null {
  switch (limit) {
    case "messages":
      return "messages";
    case "watchlist":
    case "page_reads":
      return "prices";
    case "goals":
      return "goals";
    case "form_reads":
      return "forms";
  }
  return feature && feature in FEATURE_ROW ? FEATURE_ROW[feature as AgentFeatureId] : null;
}
