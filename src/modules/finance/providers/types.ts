// Contrato de un conector financiero, modelado sobre el flujo de Plaid:
// link token → (el usuario elige banco y cuentas) → public token → access token → cuentas → sync con cursor.

export type ProviderName = "sandbox" | "plaid";

export type ProviderAccountType = "CHECKING" | "SAVINGS" | "CREDIT_CARD" | "WALLET" | "OTHER";

export interface ProviderAccount {
  id: string;
  name: string;
  officialName: string | null;
  type: ProviderAccountType;
  subtype: string | null;
  mask: string | null;
  currency: string;
  /** En tarjetas de crédito: lo que se debe. */
  currentBalance: number | null;
  creditLimit: number | null;
}

export interface ProviderTransaction {
  id: string;
  accountId: string;
  postedAt: Date;
  /** Siempre positivo; `direction` indica si sale o entra. */
  amount: number;
  direction: "DEBIT" | "CREDIT";
  currency: string;
  merchantName: string | null;
  description: string;
  category: string;
  subcategory: string | null;
  pending: boolean;
}

export interface SyncPage {
  added: ProviderTransaction[];
  modified: ProviderTransaction[];
  removed: string[];
  nextCursor: string;
  hasMore: boolean;
}

export interface ExchangeResult {
  accessToken: string;
  itemId: string;
  institution: { id: string; name: string };
}

export interface FinancialProvider {
  name: ProviderName;
  createLinkToken(userId: string): Promise<{ linkToken: string; expiresAt: string }>;
  exchangePublicToken(userId: string, publicToken: string): Promise<ExchangeResult>;
  getAccounts(accessToken: string): Promise<ProviderAccount[]>;
  syncTransactions(accessToken: string, cursor: string | null): Promise<SyncPage>;
  /** Días desde el último uso por comercio (solo proveedores que tengan esa señal). */
  getUsageSignals?(accessToken: string): Promise<Record<string, number>>;
  /** Revoca el acceso en el proveedor al desconectar. */
  removeItem?(accessToken: string): Promise<void>;
}
