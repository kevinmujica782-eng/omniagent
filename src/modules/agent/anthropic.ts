import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { requireEnv } from "@/lib/env";

let client: Anthropic | undefined;

export function anthropic(): Anthropic {
  client ??= new Anthropic({
    apiKey: requireEnv("ANTHROPIC_API_KEY", "El agente de IA"),
    maxRetries: 2,
    timeout: 60_000,
  });
  return client;
}
