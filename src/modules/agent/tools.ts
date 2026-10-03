import "server-only";
import { conciergeTools } from "@/modules/concierge/concierge.tools";
import { financeTools } from "@/modules/finance/finance.tools";
import { goalsTools } from "@/modules/goals/goals.tools";
import { proceduresTools } from "@/modules/procedures/procedures.tools";
import { returnsTools } from "@/modules/returns/returns.tools";
import type { AgentTool } from "./registry";

/** Catálogo de herramientas del agente (function calling). Cada módulo aporta las suyas. */
export const ALL_TOOLS: AgentTool[] = [...financeTools, ...proceduresTools, ...conciergeTools, ...returnsTools, ...goalsTools];

const byName = new Map(ALL_TOOLS.map((tool) => [tool.name, tool]));

export function findTool(name: string): AgentTool | undefined {
  return byName.get(name);
}
