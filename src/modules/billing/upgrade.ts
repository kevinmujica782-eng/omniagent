// Qué mostrar cuando alguien del plan Gratis choca con un límite (puro: lo usan el chat, la API y las pruebas).
import type { PlanLimitDetails } from "@/lib/errors";
import type { UpgradeCard } from "@/types/cards";
import { AGENT_FEATURES, cadenceText, PLANS, type AgentFeatureId } from "./plans";

const PRO = PLANS.PRO;
const n = (value: number) => value.toLocaleString("es-US");

type Topic = "mail" | "prices" | "report" | "messages" | "forms" | "goals";

/** El beneficio que responde a lo que se acabó y el tema que cubre (para no repetirlo después). */
function specific(details: Pick<PlanLimitDetails, "reason" | "feature">): { line: string; topic: Topic } | null {
  switch (details.reason) {
    case "messages":
      return { line: `${n(PRO.monthlyMessages)} mensajes con Omni al mes`, topic: "messages" };
    case "watchlist":
      return { line: `${PRO.watchlistItems} precios vigilados, revisados ${cadenceText(PRO.priceCheckMinutes)}`, topic: "prices" };
    case "goals":
      return { line: `${PRO.activeGoals} metas activas`, topic: "goals" };
    case "form_reads":
      return { line: `${PRO.monthlyFormReads} formularios PDF rellenados con IA al mes`, topic: "forms" };
    case "page_reads":
      return { line: `${PRO.monthlyPageReads} páginas de tiendas leídas con IA al mes`, topic: "prices" };
    case "feature": {
      const feature = details.feature as AgentFeatureId | undefined;
      if (!feature || !(feature in AGENT_FEATURES)) return null;
      const topic: Topic = feature === "mail_autopilot" ? "mail" : feature === "monthly_report" ? "report" : feature === "hourly_prices" ? "prices" : "messages";
      return { line: AGENT_FEATURES[feature].pro, topic };
    }
    default:
      return null;
  }
}

/** Beneficio de Pro que responde justo a lo que se acabó; luego, los agentes en piloto automático. */
export function upgradeHighlights(details: Pick<PlanLimitDetails, "reason" | "feature">): string[] {
  const first = specific(details);
  const general: { line: string; topic: Topic }[] = [
    { line: `Correo revisado ${cadenceText(PRO.mailCheckHours * 60)}`, topic: "mail" },
    { line: `Precios revisados ${cadenceText(PRO.priceCheckMinutes)}`, topic: "prices" },
    { line: "Informe mensual automático de tus gastos", topic: "report" },
  ];
  const rest = general.filter((g) => g.topic !== first?.topic).map((g) => g.line);
  return [...(first ? [first.line] : []), ...rest].slice(0, 3);
}

export function upgradeCard(reason: string, details: Pick<PlanLimitDetails, "reason" | "feature">): UpgradeCard {
  return {
    kind: "upgrade",
    reason,
    feature: details.feature ?? null,
    highlights: upgradeHighlights(details),
    priceLabel: PRO.priceLabel,
  };
}
