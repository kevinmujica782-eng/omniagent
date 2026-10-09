import "server-only";
import { z } from "zod";
import type { AIToolDefinition } from "@/modules/ai/ai.types";
import type { AgentModule } from "@/generated/prisma/enums";
import type { AgentCard } from "@/types/cards";

export interface ToolContext {
  userId: string;
  conversationId: string;
  currency: string;
  timezone: string;
  now: Date;
}

export interface ToolResult {
  /** Lo que recibe el modelo como tool_result (se serializa a JSON). */
  data: unknown;
  /** Lo que ve el usuario en el chat. */
  cards?: AgentCard[];
  /** Preguntas de seguimiento que se muestran como botones bajo la respuesta. */
  suggestions?: string[];
}

export interface AgentTool<S extends z.ZodType = z.ZodType> {
  name: string;
  description: string;
  module: AgentModule;
  input: S;
  // Declarado como método (bivariante) para poder agrupar herramientas con esquemas distintos.
  run(input: z.output<S>, ctx: ToolContext): Promise<ToolResult>;
}

export function defineTool<S extends z.ZodType>(tool: AgentTool<S>): AgentTool<S> {
  return tool;
}

/** La herramienta para el router de IA: el esquema zod como JSON Schema (cada adaptador lo ajusta a su API). */
export function toAITool(tool: AgentTool): AIToolDefinition {
  const schema = z.toJSONSchema(tool.input, { io: "input" }) as Record<string, unknown>;
  delete schema.$schema;
  return { name: tool.name, description: tool.description, parameters: schema };
}
