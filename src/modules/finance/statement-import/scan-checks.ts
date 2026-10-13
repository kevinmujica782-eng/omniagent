import { parseAmount } from "./amounts";
import type { AccountKind, RawRow, ScanAccountType, ScanCheck, StatementRow } from "./types";

// Comprobaciones de lo que leyó la IA, con los datos del propio documento: el saldo final, el saldo de cada renglón y
// los totales del resumen. Una cifra mal leída casi nunca cuadra con los saldos, así que se avisa antes de importar.
// Puro: sin red ni base de datos.

/** Hasta cuántos movimientos sin saldo entre dos saldos se prueban todas las combinaciones de cargo y abono. */
const MAX_GROUP = 12;

const money = (cents: number) =>
  (Math.abs(cents) / 100).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function signedCents(text: string | null | undefined): number | null {
  const value = parseAmount(text);
  return value ? (value.negative ? -value.cents : value.cents) : null;
}

/** Monto (sin signo) de un renglón: cargo y abono, o la columna única. null si no trae un monto legible. */
function rowAmount(row: RawRow): number | null {
  const debit = parseAmount(row.debit)?.cents ?? 0;
  const credit = parseAmount(row.credit)?.cents ?? 0;
  if (debit > 0 || credit > 0) return Math.abs(credit - debit);
  const amount = parseAmount(row.amount);
  return amount && amount.cents > 0 ? amount.cents : null;
}

/** ¿Alguna combinación de cargos y abonos con estos montos explica la diferencia de saldo (±1 centavo)? */
export function signsCanReach(amounts: number[], delta: number): boolean {
  if (amounts.length === 0) return Math.abs(delta) <= 1;
  if (amounts.length > MAX_GROUP) return true; // demasiados para probar: no se marca nada
  for (let mask = 0; mask < 1 << amounts.length; mask++) {
    let sum = 0;
    for (let i = 0; i < amounts.length; i++) sum += mask & (1 << i) ? amounts[i] : -amounts[i];
    if (Math.abs(sum - delta) <= 1) return true;
  }
  return false;
}

type Entry = { row: RawRow; amount: number | null; balance: number | null; rejected: boolean };

/**
 * Renglones que no cuadran con su saldo, en un sentido de lectura. En orden cronológico, el saldo de un renglón es el
 * anterior más los movimientos desde ahí; del más nuevo al más viejo, al revés. Un renglón omitido (dudoso) corta la
 * cadena: no se puede comprobar a través de él.
 */
function runningMismatches(entries: Entry[], newestFirst: boolean): { groups: number; bad: RawRow[] } {
  let anchor: number | null = null;
  let group: Entry[] = [];
  let groups = 0;
  const bad: RawRow[] = [];
  const close = (balance: number) => {
    if (anchor !== null && group.length > 0) {
      groups += 1;
      const delta = newestFirst ? anchor - balance : balance - anchor;
      if (!signsCanReach(group.map((entry) => entry.amount!), delta)) bad.push(newestFirst ? group[0].row : group[group.length - 1].row);
    }
    anchor = balance;
    group = [];
  };
  for (const entry of entries) {
    if (entry.rejected) {
      anchor = null;
      group = [];
      continue;
    }
    if (newestFirst) {
      if (entry.balance !== null) close(entry.balance);
      if (entry.amount !== null) group.push(entry);
    } else {
      if (entry.amount !== null) group.push(entry);
      if (entry.balance !== null) close(entry.balance);
    }
  }
  return { groups, bad };
}

/** Los saldos de cada renglón contra sus montos, en el sentido de lectura que mejor cuadra. */
export function checkRunningBalances(raw: RawRow[]): { groups: number; bad: RawRow[] } {
  const entries: Entry[] = raw.map((row) => ({
    row,
    amount: rowAmount(row),
    balance: signedCents(row.balance),
    rejected: Boolean(row.rejected),
  }));
  const forward = runningMismatches(entries, false);
  const backward = runningMismatches(entries, true);
  return backward.bad.length < forward.bad.length ? backward : forward;
}

/** Cuánto mueve el saldo un movimiento: en débito un cargo lo baja; en una tarjeta lo sube (se debe más). */
function balanceEffect(row: StatementRow, kind: AccountKind): number {
  return (row.direction === "DEBIT") === (kind === "liability") ? row.amountCents : -row.amountCents;
}

export interface ScanCheckInput {
  raw: RawRow[];
  rows: StatementRow[];
  kind: AccountKind;
  openingBalanceText: string | null;
  closingBalanceText: string | null;
  totalDebitsText: string | null;
  totalCreditsText: string | null;
}

export interface ScanCheckResult {
  checks: ScanCheck[];
  verified: boolean | null;
  warnings: string[];
}

export function checkScan(input: ScanCheckInput): ScanCheckResult {
  const checks: ScanCheck[] = [];
  const warnings: string[] = [];
  let failed = false;

  // 1. Saldo inicial + movimientos = saldo final.
  const opening = signedCents(input.openingBalanceText);
  const closing = signedCents(input.closingBalanceText);
  if (opening !== null && closing !== null && input.rows.length > 0) {
    checks.push("closing");
    const computed = input.rows.reduce((sum, row) => sum + balanceEffect(row, input.kind), opening);
    if (Math.abs(computed - closing) > 1) {
      failed = true;
      warnings.push(
        `Los movimientos no cuadran con el saldo final del documento (diferencia de ${money(computed - closing)}). Revisa los montos antes de importar o sube una foto más nítida.`,
      );
    }
  }

  // 2. El saldo de cada renglón.
  const running = checkRunningBalances(input.raw);
  if (running.groups > 0) {
    checks.push("running");
    if (running.bad.length > 0) {
      failed = true;
      const [first] = running.bad;
      const example = `«${first.description || first.date}» (${first.source})`;
      warnings.push(
        running.bad.length === 1
          ? `Un movimiento no cuadra con el saldo de su renglón: ${example}. Revisa su monto.`
          : `${running.bad.length} movimientos no cuadran con el saldo de su renglón, por ejemplo ${example}. Revisa esos montos.`,
      );
    }
  }

  // 3. Totales de cargos y abonos del resumen.
  const totals: { text: string | null; direction: StatementRow["direction"]; label: string }[] = [
    { text: input.totalDebitsText, direction: "DEBIT", label: "cargos" },
    { text: input.totalCreditsText, direction: "CREDIT", label: "abonos" },
  ];
  for (const total of totals) {
    const expected = signedCents(total.text);
    if (expected === null || input.rows.length === 0) continue;
    if (!checks.includes("totals")) checks.push("totals");
    const sum = input.rows.filter((row) => row.direction === total.direction).reduce((acc, row) => acc + row.amountCents, 0);
    if (Math.abs(sum - Math.abs(expected)) > 1) {
      failed = true;
      warnings.push(`La suma de los ${total.label} (${money(sum)}) no coincide con el total de ${total.label} del documento (${money(expected)}).`);
    }
  }

  return { checks, verified: checks.length === 0 ? null : !failed, warnings };
}

/** Avisos de lo que la IA vio en el documento frente a la cuenta elegida (tipo y moneda). */
export function scanTargetWarnings(
  scan: { accountType: ScanAccountType | null; currency: string | null },
  target: { kind: AccountKind; currency: string },
): string[] {
  const warnings: string[] = [];
  if (scan.accountType === "credit_card" && target.kind === "asset") {
    warnings.push("El documento parece de una tarjeta de crédito, pero elegiste una cuenta de débito: los cargos y abonos podrían quedar al revés.");
  } else if ((scan.accountType === "checking" || scan.accountType === "savings") && target.kind === "liability") {
    warnings.push("El documento parece de una cuenta de débito o ahorro, pero elegiste una tarjeta de crédito: los cargos y abonos podrían quedar al revés.");
  }
  if (scan.currency && scan.currency !== target.currency.toUpperCase()) {
    warnings.push(`El documento está en ${scan.currency} y la cuenta en ${target.currency.toUpperCase()}: revisa que sea la cuenta correcta.`);
  }
  return warnings;
}
