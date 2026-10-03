import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
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

/** Convierte el esquema zod en el JSON Schema que espera la API de Claude (function calling). */
export function toAnthropicTool(tool: AgentTool): Anthropic.Tool {
  const schema = z.toJSONSchema(tool.input, { io: "input" }) as Record<string, unknown>;
  delete schema.$schema;
  return {
    name: tool.name,
    description: tool.description,
    input_schema: schema as unknown as Anthropic.Tool["input_schema"],
  };
}
