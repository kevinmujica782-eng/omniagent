import "server-only";
import { env, requireEnv } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { categoryFromPlaid } from "../categories";
import type { FinancialProvider, ProviderAccountType, ProviderTransaction } from "./types";

// Adaptador de Plaid (https://plaid.com/docs/api/). Se activa con FINANCE_PROVIDER=plaid + PLAID_CLIENT_ID/SECRET.
// En la web, la ventana de conexión usa Plaid Link (script oficial) en lugar de la del sandbox.

const HOSTS = { sandbox: "https://sandbox.plaid.com", production: "https://production.plaid.com" } as const;

type PlaidError = { error_code?: string; error_message?: string; display_message?: string | null };

type PlaidAccount = {
  account_id: string;
  name: string;
  official_name: string | null;
  mask: string | null;
  type: string;
  subtype: string | null;
  balances: { current: number | null; limit: number | null; iso_currency_code: string | null };
};

type PlaidTransaction = {
  transaction_id: string;
  account_id: string;
  amount: number;
  iso_currency_code: string | null;
  date: string;
  authorized_date: string | null;
  name: string | null;
  merchant_name: string | null;
  pending: boolean;
  personal_finance_category?: { primary: string; detailed: string } | null;
};

async function plaid<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const clientId = requireEnv("PLAID_CLIENT_ID", "Plaid");
  const secret = requireEnv("PLAID_SECRET", "Plaid");
  const res = await fetch(`${HOSTS[env().PLAID_ENV]}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Plaid-Version": "2020-09-14" },
    body: JSON.stringify({ client_id: clientId, secret, ...body }),
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as T & PlaidError;
  if (!res.ok) {
    console.error(`[plaid] ${path} ${json.error_code ?? res.status}: ${json.error_message ?? ""}`);
    throw new AppError(502, "plaid_error", json.display_message ?? "El banco no respondió. Inténtalo en unos minutos.");
  }
  return json;
}

function accountType(type: string, subtype: string | null): ProviderAccountType {
  if (type === "credit") return "CREDIT_CARD";
  if (type === "depository" && subtype === "savings") return "SAVINGS";
  if (type === "depository") return "CHECKING";
  return "OTHER";
}

function toTransaction(tx: PlaidTransaction): ProviderTransaction {
  const { category, subcategory } = categoryFromPlaid(
    tx.personal_finance_category?.primary,
    tx.personal_finance_category?.detailed,
  );
  const description = tx.name ?? tx.merchant_name ?? "Movimiento";
  return {
    id: tx.transaction_id,
    accountId: tx.account_id,
    postedAt: new Date(`${tx.authorized_date ?? tx.date}T12:00:00Z`),
    // Plaid: monto positivo = sale dinero; negativo = entra.
    amount: Math.abs(tx.amount),
    direction: tx.amount >= 0 ? "DEBIT" : "CREDIT",
    currency: tx.iso_currency_code ?? "USD",
    merchantName: tx.merchant_name ?? tx.name,
    description,
    category,
    subcategory,
    pending: tx.pending,
  };
}

export const plaidProvider: FinancialProvider = {
  name: "plaid",

  async createLinkToken(userId) {
    const config = env();
    const res = await plaid<{ link_token: string; expiration: string }>("/link/token/create", {
      client_name: "OmniAgent",
      language: "es",
      country_codes: config.PLAID_COUNTRY_CODES.split(",").map((c) => c.trim().toUpperCase()),
      user: { client_user_id: userId },
      products: ["transactions"],
      transactions: { days_requested: 90 },
      ...(config.PLAID_WEBHOOK_URL ? { webhook: config.PLAID_WEBHOOK_URL } : {}),
    });
    return { linkToken: res.link_token, expiresAt: res.expiration };
  },

  async exchangePublicToken(_userId, publicToken) {
    const exchange = await plaid<{ access_token: string; item_id: string }>("/item/public_token/exchange", {
      public_token: publicToken,
    });
    const item = await plaid<{ item: { institution_id: string | null } }>("/item/get", {
      access_token: exchange.access_token,
    });
    let name = "Tu banco";
    const institutionId = item.item.institution_id ?? "desconocida";
    if (item.item.institution_id) {
      const institution = await plaid<{ institution: { name: string } }>("/institutions/get_by_id", {
        institution_id: item.item.institution_id,
        country_codes: env().PLAID_COUNTRY_CODES.split(",").map((c) => c.trim().toUpperCase()),
      }).catch(() => null);
      name = institution?.institution.name ?? name;
    }
    return { accessToken: exchange.access_token, itemId: exchange.item_id, institution: { id: institutionId, name } };
  },

  async getAccounts(accessToken) {
    const res = await plaid<{ accounts: PlaidAccount[] }>("/accounts/get", { access_token: accessToken });
    return res.accounts.map((account) => ({
      id: account.account_id,
      name: account.name,
      officialName: account.official_name,
      type: accountType(account.type, account.subtype),
      subtype: account.subtype,
      mask: account.mask,
      currency: account.balances.iso_currency_code ?? "USD",
      currentBalance: account.balances.current,
      creditLimit: account.balances.limit,
    }));
  },

  async syncTransactions(accessToken, cursor) {
    const res = await plaid<{
      added: PlaidTransaction[];
      modified: PlaidTransaction[];
      removed: { transaction_id: string }[];
      next_cursor: string;
      has_more: boolean;
    }>("/transactions/sync", {
      access_token: accessToken,
      count: 500,
      ...(cursor ? { cursor } : {}),
    });
    return {
      added: res.added.map(toTransaction),
      modified: res.modified.map(toTransaction),
      removed: res.removed.map((r) => r.transaction_id),
      nextCursor: res.next_cursor,
      hasMore: res.has_more,
    };
  },

  async removeItem(accessToken) {
    await plaid<{ request_id: string }>("/item/remove", { access_token: accessToken });
  },
};
