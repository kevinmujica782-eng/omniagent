// Sin "server-only": la landing, la cuenta, el panel de Inicio y la hoja de mejora muestran estos límites.
export type PlanId = "FREE" | "PRO";

/** Funciones avanzadas de los agentes autónomos que dependen del plan (se validan en el servidor). */
export type AgentFeatureId = "mail_autopilot" | "monthly_report" | "hourly_prices" | "ai_alerts" | "advanced_model";

export interface PlanLimits {
  id: PlanId;
  name: string;
  /** Precio de referencia para la UI. El cobro real lo definen Stripe (web) y Google Play (Android). */
  price: string;
  period: string | null;
  priceLabel: string;
  monthlyMessages: number;
  watchlistItems: number;
  activeGoals: number;
  /** Formularios PDF leídos con IA al mes (después se rellenan con reglas). */
  monthlyFormReads: number;
  /** Páginas sin datos de producto leídas con IA al mes (para encontrar su precio). */
  monthlyPageReads: number;
  /** Páginas web nuevas que arma Omni al mes (los cambios a una página ya creada no cuentan). */
  monthlySites: number;
  /** Trabajos del motor en segundo plano corriendo a la vez (los que esperan una aprobación no cuentan). */
  parallelJobs: number;
  /** Cada cuánto revisa el agente cada precio (depende también de la frecuencia del cron). */
  priceCheckMinutes: number;
  /**
   * Cada cuánto revisa el agente el correo conectado, en segundo plano. 20 h en Gratis = "una vez al día"
   * (con margen para que un cron diario que se adelanta unos minutos no se salte días).
   */
  mailCheckHours: number;
  /** Tiempo mínimo entre análisis financieros pedidos a mano. */
  analysisCooldownMinutes: number;
  features: Record<AgentFeatureId, boolean>;
}

export const PLANS: Record<PlanId, PlanLimits> = {
  FREE: {
    id: "FREE",
    name: "Gratis",
    price: "$0",
    period: null,
    priceLabel: "Gratis",
    monthlyMessages: 40,
    watchlistItems: 3,
    activeGoals: 2,
    monthlyFormReads: 5,
    monthlyPageReads: 10,
    monthlySites: 1,
    parallelJobs: 1,
    priceCheckMinutes: 1440,
    mailCheckHours: 20,
    analysisCooldownMinutes: 12 * 60,
    features: { mail_autopilot: false, monthly_report: false, hourly_prices: false, ai_alerts: false, advanced_model: false },
  },
  PRO: {
    id: "PRO",
    name: "Pro",
    price: "$19.99",
    period: "al mes",
    priceLabel: "$19.99 al mes",
    monthlyMessages: 1500,
    watchlistItems: 50,
    activeGoals: 20,
    monthlyFormReads: 100,
    monthlyPageReads: 200,
    monthlySites: 20,
    parallelJobs: 3,
    priceCheckMinutes: 60,
    mailCheckHours: 3,
    analysisCooldownMinutes: 30,
    features: { mail_autopilot: true, monthly_report: true, hourly_prices: true, ai_alerts: true, advanced_model: true },
  },
};

/** Textos de cada función avanzada: la hoja de mejora, la cuenta y el panel de agentes usan los mismos. */
export const AGENT_FEATURES: Record<AgentFeatureId, { title: string; pro: string; free: string }> = {
  mail_autopilot: {
    title: "Correo en piloto automático",
    pro: "Omni revisa tu correo cada 3 horas y te trae los trámites nuevos sin que se lo pidas.",
    free: "Una revisión al día.",
  },
  monthly_report: {
    title: "Informe mensual automático",
    pro: "Cada mes Omni analiza tus gastos y te deja las recomendaciones listas.",
    free: "El análisis se hace cuando lo pides.",
  },
  hourly_prices: {
    title: "Precios cada hora",
    pro: "El agente de compras revisa tus precios cada hora para no perder ofertas cortas.",
    free: "Una revisión al día.",
  },
  ai_alerts: {
    title: "Alertas con contexto",
    pro: "Omni redacta cada oferta con su lectura: si es buen momento o conviene esperar.",
    free: "Alertas estándar.",
  },
  advanced_model: {
    title: "Modelo de IA más capaz",
    pro: "Respuestas y análisis más completos en el chat.",
    free: "Modelo rápido.",
  },
};

export const AGENT_FEATURE_ORDER: AgentFeatureId[] = ["mail_autopilot", "hourly_prices", "monthly_report", "ai_alerts", "advanced_model"];

/** "cada hora", "cada 3 horas", "una vez al día". */
export function cadenceText(minutes: number): string {
  if (minutes >= 20 * 60) return "una vez al día";
  if (minutes <= 60) return "cada hora";
  return `cada ${Math.round(minutes / 60)} horas`;
}

/** Beneficios legibles por plan (landing y cuenta). */
export function planFeatures(plan: PlanLimits): string[] {
  const n = (value: number) => value.toLocaleString("es-US");
  return [
    `${n(plan.monthlyMessages)} mensajes con Omni al mes`,
    `${plan.watchlistItems} precios vigilados, revisados ${cadenceText(plan.priceCheckMinutes)}`,
    `Correo revisado ${cadenceText(plan.mailCheckHours * 60)}`,
    `${plan.monthlyFormReads} formularios PDF rellenados con IA al mes`,
    plan.monthlySites === 1 ? "1 página web hecha por Omni al mes" : `${plan.monthlySites} páginas web hechas por Omni al mes`,
    `${plan.activeGoals} metas activas`,
    plan.features.monthly_report ? "Informe mensual automático de tus gastos" : "Análisis de gastos cuando lo pidas",
    ...(plan.features.ai_alerts ? ["Alertas de ofertas redactadas por Omni"] : []),
    ...(plan.features.advanced_model ? ["Modelo de IA más capaz"] : []),
  ];
}
