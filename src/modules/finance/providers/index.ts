import "server-only";
import { env } from "@/lib/env";
import { plaidProvider } from "./plaid";
import { sandboxProvider } from "./sandbox";
import type { FinancialProvider, ProviderName } from "./types";

/** Conector activo para nuevas conexiones (FINANCE_PROVIDER). Las conexiones existentes guardan el suyo. */
export function activeProviderName(): ProviderName {
  return env().FINANCE_PROVIDER;
}

export function getProvider(name: ProviderName): FinancialProvider {
  return name === "plaid" ? plaidProvider : sandboxProvider;
}
