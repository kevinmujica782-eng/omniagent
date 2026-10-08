import "server-only";
import { conciergeTools } from "@/modules/concierge/concierge.tools";
import { engineTools } from "@/modules/engine/engine.tools";
import { financeTools } from "@/modules/finance/finance.tools";
import { goalsTools } from "@/modules/goals/goals.tools";
import { memoryTools } from "@/modules/memory/memory.tools";
import { proceduresTools } from "@/modules/procedures/procedures.tools";
import { returnsTools } from "@/modules/returns/returns.tools";
import { sitesTools } from "@/modules/sites/sites.tools";
import type { AgentTool } from "./registry";

/** Catálogo de herramientas del agente (function calling). Cada módulo aporta las suyas; el motor, las de segundo plano. */
export const ALL_TOOLS: AgentTool[] = [
  ...financeTools,
  ...proceduresTools,
  ...conciergeTools,
  ...returnsTools,
  ...goalsTools,
  ...memoryTools,
  ...engineTools,
  ...sitesTools,
];

const byName = new Map(ALL_TOOLS.map((tool) => [tool.name, tool]));

export function findTool(name: string): AgentTool | undefined {
  return byName.get(name);
}
