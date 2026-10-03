import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { audit } from "@/lib/audit";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { prisma } from "@/lib/db";
import { AppError, Errors } from "@/lib/errors";
import { log } from "@/lib/log";
import { isUuid } from "@/lib/validation";
import type { BankConnectionView, LinkResultView, LinkSessionView } from "@/types/cards";
import { listAccounts, refreshRecurringCharges } from "./finance.service";
import { activeProviderName, getProvider } from "./providers";
import { createSandboxPublicToken } from "./providers/sandbox";
import {
  DEFAULT_DEMO_INSTITUTIONS,
  findSandboxInstitution,
  sandboxAccountId,
  sandboxInstitutionViews,
} from "./providers/sandbox-catalog";
import type { ProviderAccount, ProviderName, ProviderTransaction } from "./providers/types";

// Enlace y sincronización de cuentas: el mismo flujo para el sandbox y para Plaid.

const BANK_PROVIDERS = ["BANK_DEMO", "BANK_AGGREGATOR"] as const;
const MAX_PAGES = 40;

type ConnectionMeta = {
  provider: ProviderName;
  institutionId: string;
  institutionName: string;
  cursor: string | null;
};

function readMeta(value: unknown): ConnectionMeta {
  const meta = (value ?? {}) as Partial<ConnectionMeta>;
  return {
    provider: meta.provider === "plaid" ? "plaid" : "sandbox",
    institutionId: meta.institutionId ?? "",
    institutionName: meta.institutionName ?? "",
    cursor: meta.cursor ?? null,
  };
}

export async function createLinkSession(userId: string): Promise<LinkSessionView> {
  const name = activeProviderName();
  const { linkToken, expiresAt } = await getProvider(name).createLinkToken(userId);
  return name === "sandbox"
    ? { provider: "sandbox", linkToken, expiresAt, institutions: sandboxInstitutionViews(userId) }
    : { provider: "plaid", linkToken, expiresAt };
}

export type CompleteLinkInput =
  | { provider: "sandbox"; linkToken: string; institutionId: string; accountIds: string[] }
  | { provider: "plaid"; publicToken: string; accountIds?: string[] };

async function upsertAccounts(
  userId: string,
  connectionId: string,
  institutionName: string,
  accounts: ProviderAccount[],
  simulated: boolean,
) {
  for (const account of accounts) {
    const data = {
      connectionId,
      institutionName,
      name: account.name,
      type: account.type,
      subtype: account.subtype,
      mask: account.mask ? account.mask.slice(-4) : null,
      currentBalance: account.currentBalance,
      creditLimit: account.creditLimit,
    };
    await prisma.financialAccount.upsert({
      where: { userId_externalId: { userId, externalId: account.id } },
      create: { userId, externalId: account.id, currency: account.currency, isSimulated: simulated, ...data },
      update: data,
    });
  }
}

/** Termina la conexión: canjea el token, guarda cuentas elegidas e importa 90 días de movimientos. */
export async function completeLink(userId: string, input: CompleteLinkInput): Promise<LinkResultView> {
  const provider = getProvider(input.provider);
  const publicToken =
    input.provider === "sandbox"
      ? createSandboxPublicToken(userId, input.linkToken, input.institutionId, input.accountIds)
      : input.publicToken;
  const exchange = await provider.exchangePublicToken(userId, publicToken);

  const meta: ConnectionMeta = {
    provider: input.provider,
    institutionId: exchange.institution.id,
    institutionName: exchange.institution.name,
    cursor: null,
  };
  const providerEnum = input.provider === "sandbox" ? "BANK_DEMO" : "BANK_AGGREGATOR";
  const connection = await prisma.integrationConnection.upsert({
    where: {
      userId_provider_externalAccountId: { userId, provider: providerEnum, externalAccountId: exchange.itemId },
    },
    create: {
      userId,
      provider: providerEnum,
      externalAccountId: exchange.itemId,
      displayName: exchange.institution.name,
      scopes: ["accounts:read", "transactions:read"],
      accessTokenEncrypted: encryptSecret(exchange.accessToken),
      status: "ACTIVE",
      metadata: meta as unknown as Prisma.InputJsonValue,
    },
    update: {
      displayName: exchange.institution.name,
      accessTokenEncrypted: encryptSecret(exchange.accessToken),
      status: "ACTIVE",
      metadata: meta as unknown as Prisma.InputJsonValue,
    },
  });

  const accounts = await provider.getAccounts(exchange.accessToken);
  const wanted = input.accountIds?.length ? accounts.filter((a) => input.accountIds!.includes(a.id)) : accounts;
  await upsertAccounts(userId, connection.id, exchange.institution.name, wanted, input.provider === "sandbox");
  // Si al reconectar dejó de compartir una cuenta, se borra con sus movimientos.
  await prisma.financialAccount.deleteMany({
    where: { userId, connectionId: connection.id, externalId: { notIn: wanted.map((a) => a.id) } },
  });

  const sync = await syncConnection(userId, connection.id);
  await audit({
    userId,
    actor: "user",
    action: "finance.connection.linked",
    entity: "integration_connection",
    entityId: connection.id,
    metadata: { provider: input.provider, institution: exchange.institution.name, accounts: wanted.length },
  });
  return { connectionId: connection.id, institution: exchange.institution, accounts: wanted.length, ...sync };
}

/** Sincronización incremental con cursor (added / modified / removed), saldos y cargos recurrentes. */
export async function syncConnection(userId: string, connectionId: string) {
  if (!isUuid(connectionId)) throw Errors.notFound("La conexión");
  const connection = await prisma.integrationConnection.findFirst({
    where: { id: connectionId, userId, provider: { in: [...BANK_PROVIDERS] } },
  });
  if (!connection?.accessTokenEncrypted) throw Errors.notFound("La conexión");

  const meta = readMeta(connection.metadata);
  const provider = getProvider(meta.provider);
  const accessToken = decryptSecret(connection.accessTokenEncrypted);
  const accounts = await prisma.financialAccount.findMany({
    where: { userId, connectionId },
    select: { id: true, externalId: true },
  });
  const byExternal = new Map(accounts.map((account) => [account.externalId ?? "", account.id]));

  const toRow = (tx: ProviderTransaction) => {
    const accountId = byExternal.get(tx.accountId);
    if (!accountId) return null; // cuenta que el usuario no compartió
    return {
      userId,
      accountId,
      externalId: tx.id,
      postedAt: tx.postedAt,
      amount: tx.amount,
      direction: tx.direction,
      currency: tx.currency,
      merchantName: tx.merchantName,
      description: tx.description,
      category: tx.category,
      subcategory: tx.subcategory,
      pending: tx.pending,
    };
  };

  let cursor = meta.cursor;
  const counts = { added: 0, modified: 0, removed: 0 };
  try {
    for (let page = 0; page < MAX_PAGES; page++) {
      const result = await provider.syncTransactions(accessToken, cursor);

      const added = result.added.map(toRow).filter((row): row is NonNullable<typeof row> => row !== null);
      if (added.length > 0) {
        counts.added += (await prisma.transaction.createMany({ data: added, skipDuplicates: true })).count;
      }
      for (const tx of result.modified) {
        const row = toRow(tx);
        if (!row) continue;
        const { userId: _u, accountId, externalId, ...data } = row;
        counts.modified += (await prisma.transaction.updateMany({ where: { accountId, externalId }, data })).count;
      }
      if (result.removed.length > 0) {
        counts.removed += (
          await prisma.transaction.deleteMany({
            where: { userId, externalId: { in: result.removed }, account: { connectionId } },
          })
        ).count;
      }

      cursor = result.nextCursor;
      if (!result.hasMore) break;
    }
  } catch (error) {
    if (error instanceof AppError && error.status === 401) {
      await prisma.integrationConnection.update({ where: { id: connectionId }, data: { status: "EXPIRED" } });
    }
    throw error;
  }

  const fresh = await provider.getAccounts(accessToken).catch(() => [] as ProviderAccount[]);
  for (const account of fresh) {
    const id = byExternal.get(account.id);
    if (id) {
      await prisma.financialAccount.update({
        where: { id },
        data: { currentBalance: account.currentBalance, creditLimit: account.creditLimit },
      });
    }
  }

  await prisma.integrationConnection.update({
    where: { id: connectionId },
    data: {
      status: "ACTIVE",
      lastSyncedAt: new Date(),
      metadata: { ...meta, cursor } as unknown as Prisma.InputJsonValue,
    },
  });

  const signals = provider.getUsageSignals ? await provider.getUsageSignals(accessToken).catch(() => ({})) : {};
  await refreshRecurringCharges(userId, signals);
  return counts;
}

export async function syncAllConnections(userId: string) {
  const connections = await prisma.integrationConnection.findMany({
    where: { userId, provider: { in: [...BANK_PROVIDERS] }, status: "ACTIVE" },
    select: { id: true },
  });
  const totals = { connections: 0, added: 0, modified: 0, removed: 0, errors: 0 };
  for (const connection of connections) {
    try {
      const result = await syncConnection(userId, connection.id);
      totals.connections += 1;
      totals.added += result.added;
      totals.modified += result.modified;
      totals.removed += result.removed;
    } catch (error) {
      totals.errors += 1;
      console.error("[finance] no se pudo sincronizar", connection.id, error);
    }
  }
  return totals;
}

/** "Probar con datos de ejemplo": conecta Banco Ceiba (nómina y ahorros) y Tarjeta Aurora en el sandbox. */
export async function connectDemoAccounts(userId: string) {
  const { linkToken } = await getProvider("sandbox").createLinkToken(userId);
  const results = [];
  for (const institutionId of DEFAULT_DEMO_INSTITUTIONS) {
    const institution = findSandboxInstitution(institutionId);
    if (!institution) continue;
    results.push(
      await completeLink(userId, {
        provider: "sandbox",
        linkToken,
        institutionId,
        accountIds: institution.accounts.map((tpl) => sandboxAccountId(institutionId, tpl.id)),
      }),
    );
  }
  return {
    connections: results.length,
    accounts: results.reduce((sum, r) => sum + r.accounts, 0),
    added: results.reduce((sum, r) => sum + r.added, 0),
  };
}

export async function disconnectConnection(userId: string, connectionId: string) {
  if (!isUuid(connectionId)) throw Errors.notFound("La conexión");
  const connection = await prisma.integrationConnection.findFirst({
    where: { id: connectionId, userId, provider: { in: [...BANK_PROVIDERS] } },
  });
  if (!connection) throw Errors.notFound("La conexión");

  const meta = readMeta(connection.metadata);
  const provider = getProvider(meta.provider);
  if (provider.removeItem && connection.accessTokenEncrypted) {
    await provider.removeItem(decryptSecret(connection.accessTokenEncrypted)).catch((error) => {
      console.error("[finance] no se pudo revocar el acceso en el proveedor", error);
    });
  }

  // Borra las cuentas (y en cascada sus movimientos) y la conexión.
  await prisma.financialAccount.deleteMany({ where: { userId, connectionId } });
  await prisma.integrationConnection.delete({ where: { id: connectionId } });
  await refreshRecurringCharges(userId);
  await audit({
    userId,
    actor: "user",
    action: "finance.connection.removed",
    entity: "integration_connection",
    entityId: connectionId,
  });
  return { removed: true };
}

/**
 * Al eliminar la cuenta: revoca en el proveedor (Plaid) el acceso de cada conexión bancaria, para que el banco
 * deje de compartir datos. Los datos locales se borran después en cascada. Devuelve cuántas se revocaron; no lanza.
 */
export async function revokeBankAccess(userId: string): Promise<number> {
  const connections = await prisma.integrationConnection.findMany({
    where: { userId, provider: { in: [...BANK_PROVIDERS] }, accessTokenEncrypted: { not: null } },
  });
  let revoked = 0;
  for (const connection of connections) {
    const provider = getProvider(readMeta(connection.metadata).provider);
    if (!provider.removeItem || !connection.accessTokenEncrypted) continue;
    try {
      await provider.removeItem(decryptSecret(connection.accessTokenEncrypted));
      revoked++;
    } catch (error) {
      log.warn("finance.revoke_failed", { connectionId: connection.id, error });
    }
  }
  return revoked;
}

export async function listBankConnections(userId: string): Promise<BankConnectionView[]> {
  const [connections, accounts] = await Promise.all([
    prisma.integrationConnection.findMany({
      where: { userId, provider: { in: [...BANK_PROVIDERS] } },
      orderBy: { createdAt: "asc" },
    }),
    listAccounts(userId),
  ]);
  return connections.map((connection) => {
    const meta = readMeta(connection.metadata);
    return {
      id: connection.id,
      institutionName: connection.displayName ?? meta.institutionName,
      provider: meta.provider,
      status: connection.status,
      lastSyncedAt: connection.lastSyncedAt?.toISOString() ?? null,
      accounts: accounts.filter((account) => account.connectionId === connection.id),
    };
  });
}
