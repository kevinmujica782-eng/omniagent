import "server-only";
import type { FinancialAccount, StatementImport } from "@/generated/prisma/client";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { AppError, Errors } from "@/lib/errors";
import { ACCOUNT_TYPE_LABEL } from "@/lib/finance-copy";
import { log } from "@/lib/log";
import { isUuid } from "@/lib/validation";
import type {
  StatementAccountView,
  StatementImportResultView,
  StatementImportView,
  StatementPreviewView,
} from "@/types/cards";
import { TRANSFER_CATEGORY } from "../categories";
import { accountView, refreshRecurringCharges } from "../finance.service";
import { centsToDecimal } from "./amounts";
import { categorize } from "./categorize";
import { isoDay } from "./dates";
import { fingerprintRows } from "./fingerprint";
import { statementError } from "./limits";
import { parseScan, parseStatement } from "./parse";
import { scanTargetWarnings } from "./scan-checks";
import { deleteScan, loadScanTranscription } from "./scan.service";
import type { AccountKind, ParsedStatement } from "./types";
import type { StatementOptions, StatementUpload } from "./upload";

// Estados de cuenta en PDF o CSV para bancos sin conexión directa. Los movimientos van a una cuenta manual (sin
// connectionId) para no mezclarse con lo que sincroniza el banco. El archivo no se guarda: se lee en memoria y
// solo quedan los movimientos, cada uno ligado a su importación para poder deshacerla. Las fotos y los PDF escaneados
// se leen antes con IA (scan.service.ts); aquí llega lo transcrito, con `options.scanId`.

const SAMPLE_ROWS = 12;
const SKIPPED_ROWS = 25;
const INSERT_CHUNK = 1_000;
const HISTORY_PER_ACCOUNT = 24;

type AccountRow = Pick<FinancialAccount, "id" | "type" | "currency">;
type NewAccount = NonNullable<StatementOptions["newAccount"]>;
type Target = { account: AccountRow | null; newAccount: NewAccount | null; kind: AccountKind; currency: string };

const ACCOUNT_SELECT = { id: true, type: true, currency: true, connectionId: true } as const;

function kindOf(type: string): AccountKind {
  return type === "CREDIT_CARD" ? "liability" : "asset";
}

async function profileCurrency(userId: string): Promise<string> {
  const profile = await prisma.profile.findUnique({ where: { id: userId }, select: { currency: true } });
  return profile?.currency ?? "USD";
}

/** Cuenta destino: una manual del usuario o los datos de una nueva. Nunca una que se sincroniza con el banco. */
async function resolveTarget(userId: string, options: StatementOptions, forImport: boolean): Promise<Target> {
  if (options.accountId) {
    const account = await prisma.financialAccount.findFirst({ where: { id: options.accountId, userId }, select: ACCOUNT_SELECT });
    if (!account) throw Errors.notFound("La cuenta");
    if (account.connectionId) {
      throw new AppError(
        409,
        "account_synced",
        "Esa cuenta se actualiza sola desde tu banco. Importa el estado de cuenta en otra cuenta para no duplicar movimientos.",
      );
    }
    return { account, newAccount: null, kind: kindOf(account.type), currency: account.currency };
  }
  if (options.newAccount) {
    const currency = options.newAccount.currency ?? (await profileCurrency(userId));
    return { account: null, newAccount: options.newAccount, kind: kindOf(options.newAccount.type), currency };
  }
  if (forImport) throw Errors.badRequest("Elige la cuenta del estado de cuenta o escribe el banco de una cuenta nueva.");
  return { account: null, newAccount: null, kind: "asset", currency: await profileCurrency(userId) };
}

/** Lee el archivo, o lo transcrito por la IA si viene `scanId`. */
async function read(userId: string, upload: StatementUpload, target: Target): Promise<{ parsed: ParsedStatement; fileName: string }> {
  const { mapping, dateOrder, signConvention, password, scanId } = upload.options;
  if (scanId) {
    const scan = await loadScanTranscription(userId, scanId);
    const parsed = parseScan(scan.transcription, { dateOrder, signConvention, accountKind: target.kind });
    // Lo que la IA vio en el documento frente a la cuenta elegida (tarjeta o débito, moneda).
    const chosen = target.account !== null || target.newAccount !== null;
    const extra = chosen && parsed.scan ? scanTargetWarnings(parsed.scan, { kind: target.kind, currency: target.currency }) : [];
    return { parsed: extra.length > 0 ? { ...parsed, warnings: [...extra, ...parsed.warnings] } : parsed, fileName: scan.fileName };
  }
  if (!upload.bytes) throw statementError("file_required", "Adjunta tu estado de cuenta en PDF o CSV.");
  const parsed = await parseStatement(
    { bytes: upload.bytes, fileName: upload.fileName, mimeType: upload.mimeType },
    { mapping, dateOrder, signConvention, password, accountKind: target.kind },
  );
  return { parsed, fileName: upload.fileName };
}

/** Comercio, categoría e identificador estable de cada movimiento. */
function enrich(parsed: ParsedStatement) {
  const ids = fingerprintRows(parsed.rows);
  return parsed.rows.map((row, i) => ({ ...row, ...categorize(row.description, row.direction), externalId: ids[i] }));
}

const toMoney = (cents: number) => cents / 100;
const dbDate = (iso: string | null) => (iso ? new Date(`${iso}T00:00:00Z`) : null);

function importView(row: StatementImport): StatementImportView {
  return {
    id: row.id,
    fileName: row.fileName,
    status: row.status,
    periodStart: row.periodStart ? isoDay(row.periodStart) : null,
    periodEnd: row.periodEnd ? isoDay(row.periodEnd) : null,
    rowsImported: row.rowsImported,
    error: row.error,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Lee el archivo y muestra lo que se importaría. No guarda nada (tampoco crea la cuenta nueva). */
export async function previewStatement(userId: string, upload: StatementUpload): Promise<StatementPreviewView> {
  const target = await resolveTarget(userId, upload.options, false);
  const { parsed, fileName } = await read(userId, upload, target);
  const rows = enrich(parsed);
  const duplicates = target.account
    ? await prisma.transaction.count({
        where: { accountId: target.account.id, externalId: { in: rows.map((row) => row.externalId) } },
      })
    : null;

  let spending = 0;
  let income = 0;
  for (const row of rows) {
    if (row.category === TRANSFER_CATEGORY) continue;
    if (row.direction === "DEBIT") spending += row.amountCents;
    else income += row.amountCents;
  }
  const { detected, scan } = parsed;
  return {
    fileName,
    format: parsed.format,
    currency: target.currency,
    periodStart: parsed.periodStart,
    periodEnd: parsed.periodEnd,
    count: rows.length,
    duplicates,
    spending: toMoney(spending),
    income: toMoney(income),
    detected: {
      dateOrder: detected.dateOrder,
      dateOrderAmbiguous: detected.dateOrderAmbiguous,
      signConvention: detected.signConvention,
      columns: detected.columns,
      headers: detected.headers,
      sample: detected.sample,
      pages: detected.pages,
    },
    warnings: parsed.warnings,
    sample: rows.slice(0, SAMPLE_ROWS).map((row) => ({
      date: row.date,
      description: row.description,
      merchantName: row.merchantName,
      category: row.category,
      amount: toMoney(row.amountCents),
      direction: row.direction,
    })),
    skippedCount: parsed.skipped.length,
    skipped: parsed.skipped.slice(0, SKIPPED_ROWS),
    scan:
      scan && upload.options.scanId
        ? {
            scanId: upload.options.scanId,
            pages: scan.pages,
            unreadablePages: scan.unreadablePages,
            checks: scan.checks,
            verified: scan.verified,
            institution: scan.institution,
            accountType: scan.accountType === "unknown" ? null : scan.accountType,
            last4: scan.last4,
            currency: scan.currency,
          }
        : null,
  };
}

/**
 * Importa los movimientos. Subir otra vez el mismo estado de cuenta (o uno que se encima con el anterior) no
 * duplica nada: cada movimiento tiene un identificador estable, único por cuenta.
 */
export async function importStatement(userId: string, upload: StatementUpload): Promise<StatementImportResultView> {
  const target = await resolveTarget(userId, upload.options, true);
  const { parsed, fileName } = await read(userId, upload, target);
  const rows = enrich(parsed);

  // La cuenta nueva se crea solo cuando el archivo ya se leyó bien.
  const created = target.account === null;
  const account: AccountRow =
    target.account ??
    (await prisma.financialAccount.create({
      data: {
        userId,
        institutionName: target.newAccount!.institutionName,
        name: target.newAccount!.name ?? ACCOUNT_TYPE_LABEL[target.newAccount!.type],
        type: target.newAccount!.type,
        // Los últimos 4 dígitos que leyó la IA, si la persona no los escribió.
        mask: target.newAccount!.mask ?? parsed.scan?.last4 ?? null,
        currency: target.currency,
      },
      select: { id: true, type: true, currency: true },
    }));

  const statement = await prisma.statementImport.create({
    data: {
      userId,
      accountId: account.id,
      fileName,
      status: "PROCESSING",
      periodStart: dbDate(parsed.periodStart),
      periodEnd: dbDate(parsed.periodEnd),
    },
    select: { id: true },
  });

  let imported = 0;
  try {
    const data = rows.map((row) => ({
      userId,
      accountId: account.id,
      statementImportId: statement.id,
      externalId: row.externalId,
      // Mediodía UTC, como los movimientos de Plaid: la fecha no cambia de día en ninguna zona horaria.
      postedAt: new Date(`${row.date}T12:00:00Z`),
      amount: centsToDecimal(row.amountCents),
      direction: row.direction,
      currency: account.currency,
      merchantName: row.merchantName,
      description: row.description,
      category: row.category,
      subcategory: row.subcategory,
    }));
    for (let i = 0; i < data.length; i += INSERT_CHUNK) {
      imported += (await prisma.transaction.createMany({ data: data.slice(i, i + INSERT_CHUNK), skipDuplicates: true })).count;
    }
  } catch (error) {
    // Nada a medias: se borra lo insertado (y la cuenta, si se acababa de crear).
    if (created) {
      await prisma.financialAccount.delete({ where: { id: account.id } }).catch(() => undefined);
    } else {
      await prisma.transaction.deleteMany({ where: { statementImportId: statement.id } }).catch(() => undefined);
      await prisma.statementImport
        .update({ where: { id: statement.id }, data: { status: "FAILED", error: "No se pudieron guardar los movimientos." } })
        .catch(() => undefined);
    }
    throw error;
  }

  const duplicates = rows.length - imported;
  if (imported === 0) {
    // Todo ya estaba importado: no queda una importación vacía en el historial.
    await prisma.statementImport.delete({ where: { id: statement.id } });
  } else {
    await prisma.statementImport.update({ where: { id: statement.id }, data: { status: "PARSED", rowsImported: imported } });
    await updateBalance(account.id, statement.id, parsed);
    // Suscripciones y cargos recurrentes con los movimientos nuevos (si falla, la importación ya quedó).
    await refreshRecurringCharges(userId).catch((error: unknown) => log.warn("finance.statement.recurring_failed", { userId, error }));
  }
  await audit({
    userId,
    actor: "user",
    action: "finance.statement.imported",
    entity: "statement_import",
    entityId: statement.id,
    metadata: { format: parsed.format, rows: rows.length, imported, duplicates, skipped: parsed.skipped.length },
  });
  // Lo transcrito por la IA ya quedó como movimientos: se borra.
  if (upload.options.scanId) {
    await deleteScan(userId, upload.options.scanId).catch((error: unknown) => log.warn("finance.scan.delete_failed", { error }));
  }
  return {
    importId: imported > 0 ? statement.id : null,
    accountId: account.id,
    imported,
    duplicates,
    skipped: parsed.skipped.length,
    periodStart: parsed.periodStart,
    periodEnd: parsed.periodEnd,
    warnings: parsed.warnings,
  };
}

/** El saldo de la cuenta es el del estado de cuenta más reciente: subir uno más viejo no lo pisa. */
async function updateBalance(accountId: string, importId: string, parsed: ParsedStatement) {
  if (parsed.closingBalanceCents === null || !parsed.periodEnd) return;
  const newer = await prisma.statementImport.findFirst({
    where: { accountId, id: { not: importId }, status: "PARSED", periodEnd: { gt: dbDate(parsed.periodEnd)! } },
    select: { id: true },
  });
  if (newer) return;
  await prisma.financialAccount.update({
    where: { id: accountId },
    data: { currentBalance: centsToDecimal(parsed.closingBalanceCents) },
  });
}

/** Cuentas manuales con sus importaciones, de la más reciente a la más antigua. */
export async function listStatementAccounts(userId: string): Promise<StatementAccountView[]> {
  const accounts = await prisma.financialAccount.findMany({
    where: { userId, connectionId: null },
    orderBy: { createdAt: "asc" },
    include: { statementImports: { orderBy: { createdAt: "desc" }, take: HISTORY_PER_ACCOUNT } },
  });
  return accounts.map(({ statementImports, ...account }) => ({
    account: accountView(account),
    imports: statementImports.map(importView),
  }));
}

/**
 * Deshace una importación: borra sus movimientos (en cascada) y, si la cuenta manual queda vacía, también la
 * cuenta. Si era el estado más reciente, el saldo de la cuenta deja de mostrarse en lugar de quedar desactualizado.
 */
export async function deleteStatementImport(userId: string, importId: string) {
  if (!isUuid(importId)) throw Errors.notFound("La importación");
  const statement = await prisma.statementImport.findFirst({
    where: { id: importId, userId },
    select: { id: true, accountId: true, periodEnd: true },
  });
  if (!statement) throw Errors.notFound("La importación");

  const removed = await prisma.transaction.count({ where: { statementImportId: statement.id } });
  await prisma.statementImport.delete({ where: { id: statement.id } });

  let accountRemoved = false;
  if (statement.accountId) {
    const account = await prisma.financialAccount.findFirst({
      where: { id: statement.accountId, userId, connectionId: null },
      select: { id: true, _count: { select: { transactions: true, statementImports: true } } },
    });
    if (account && account._count.transactions === 0 && account._count.statementImports === 0) {
      await prisma.financialAccount.delete({ where: { id: account.id } });
      accountRemoved = true;
    } else if (account && statement.periodEnd) {
      const newer = await prisma.statementImport.findFirst({
        where: { accountId: account.id, status: "PARSED", periodEnd: { gte: statement.periodEnd } },
        select: { id: true },
      });
      if (!newer) await prisma.financialAccount.update({ where: { id: account.id }, data: { currentBalance: null } });
    }
  }

  await refreshRecurringCharges(userId).catch((error: unknown) => log.warn("finance.statement.recurring_failed", { userId, error }));
  await audit({
    userId,
    actor: "user",
    action: "finance.statement.removed",
    entity: "statement_import",
    entityId: statement.id,
    metadata: { removed, accountRemoved },
  });
  return { removed, accountRemoved };
}
