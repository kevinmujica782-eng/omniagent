import { parseAmount, type AmountValue } from "./amounts";
import { addDays, isoDay, readDateToken, resolveDate, yearResolver, type DateToken } from "./dates";
import { clip, fold, squash } from "./text";
import type { AccountKind, DateOrder, Direction, RawRow, SignConvention, SkippedRow, StatementRow } from "./types";

// De filas crudas a movimientos válidos: fecha, monto positivo y sentido (cargo o abono).
// El sentido sale, en este orden, de: columnas separadas de cargos/abonos → marca CR/DR → columna de tipo →
// signo (con la convención del archivo) → saldos (lo que cambia entre dos saldos conocidos) → palabras clave →
// gasto por omisión (con aviso).

const MAX_DESCRIPTION = 300;
const DAY_MS = 86_400_000;
/** Movimientos sin sentido conocido entre dos saldos: hasta este número se prueban todas las combinaciones. */
const MAX_BALANCE_UNKNOWNS = 12;
/** Un estado de cuenta abarca un mes o un trimestre: fechas sin año repartidas en más tiempo delatan un año mal puesto. */
const MAX_YEARLESS_SPAN_DAYS = 100;

/** Palabras que casi siempre significan dinero que entra o que sale, en cualquier tipo de cuenta. */
const CREDIT_WORDS =
  /\b(nomina|salario|sueldo|payroll|direct deposit|deposito|abono|spei recibido|transferencia recibida|traspaso recibido|pago recibido|su pago|gracias por su pago|payment thank you|payment received|reembolso|devolucion|refund|bonificacion|cashback|intereses (ganados|a favor)|interest (paid|earned))\b/;
const DEBIT_WORDS =
  /\b(compra|retiro|cargo|comision|domiciliacion|spei enviado|transferencia enviada|pago de servicio|purchase|withdrawal|pos|atm|fee)\b/;

export function keywordDirection(description: string): Direction | null {
  const text = fold(description);
  if (CREDIT_WORDS.test(text)) return "CREDIT";
  if (DEBIT_WORDS.test(text)) return "DEBIT";
  return null;
}

/**
 * Valor de una columna "Tipo" ("Cargo", "Abono", "DEBIT", "CR", "Sale", "Payment"...). "Pago" es ambiguo: en
 * una tarjeta es tu pago (entra) y en una cuenta de débito es algo que pagaste (sale); por eso solo es una pista
 * que se usa si el signo y el saldo no deciden.
 */
export function typeDirection(value: string | null | undefined, kind: AccountKind): { direction: Direction; certain: boolean } | null {
  const text = fold(value ?? "");
  if (!text) return null;
  if (/^(c|cr|cre|credito|credit|abono|abonos|deposito|deposit|ingreso|entrada|haber|devolucion|reembolso|refund|return)$/.test(text)) {
    return { direction: "CREDIT", certain: true };
  }
  if (/^(d|dr|deb|debito|debit|cargo|cargos|retiro|withdrawal|egreso|salida|debe|compra|sale|purchase|fee|comision)$/.test(text)) {
    return { direction: "DEBIT", certain: true };
  }
  if (/^(pago|payment)$/.test(text)) return { direction: kind === "liability" ? "CREDIT" : "DEBIT", certain: false };
  return null;
}

/** Un monto con signo de la columna única, con su sentido si ya se conoce por la columna de tipo o una marca. */
export interface SignedRow {
  negative: boolean;
  description: string;
  known?: Direction | null;
}

/** Votos a favor de cada convención que salen de los saldos (ver balanceVotes). */
export interface SignVotes {
  negativeIsDebit: number;
  positiveIsDebit: number;
}

export interface SignDecision {
  convention: SignConvention;
  /** Sin pruebas suficientes, o con pistas en contra: la vista previa lo avisa. */
  guessed: boolean;
}

/**
 * Convención de signo del archivo.
 * - Pruebas: los saldos (peso 3 por movimiento), las filas cuyo sentido ya se sabe por la columna de tipo o la marca
 *   CR/DR (peso 2) y las palabras clave (peso 1; una nómina negativa delata que los negativos son abonos). Si una
 *   convención le saca 2 o más a la otra, decide.
 * - Si no: en cuentas de débito y ahorro casi todos los bancos exportan los cargos en negativo, aunque haya más
 *   depósitos que retiros. En tarjetas varía según el banco: decide el signo más frecuente (hay más compras que pagos).
 */
export function detectSignConvention(rows: SignedRow[], kind: AccountKind, balance?: SignVotes): SignDecision {
  let negativeIsDebit = balance?.negativeIsDebit ?? 0;
  let positiveIsDebit = balance?.positiveIsDebit ?? 0;
  for (const row of rows) {
    const hint = row.known ?? keywordDirection(row.description);
    if (!hint) continue;
    const weight = row.known ? 2 : 1;
    if (row.negative === (hint === "DEBIT")) negativeIsDebit += weight;
    else positiveIsDebit += weight;
  }
  if (Math.abs(negativeIsDebit - positiveIsDebit) >= 2) {
    return { convention: negativeIsDebit > positiveIsDebit ? "negative_is_debit" : "positive_is_debit", guessed: false };
  }
  let convention: SignConvention = "negative_is_debit";
  if (kind === "liability") {
    const negatives = rows.filter((row) => row.negative).length;
    convention = negatives > rows.length - negatives ? "negative_is_debit" : "positive_is_debit";
  }
  const support = convention === "negative_is_debit" ? negativeIsDebit : positiveIsDebit;
  const against = convention === "negative_is_debit" ? positiveIsDebit : negativeIsDebit;
  return { convention, guessed: against > support || (kind === "liability" && support === 0) };
}

export interface BuildInput {
  raw: RawRow[];
  kind: AccountKind;
  dateOrder: DateOrder;
  signConvention?: SignConvention;
  /** Fin del periodo del estado de cuenta (YYYY-MM-DD): completa el año de "15/ENE". */
  periodEnd?: string | null;
  /** Saldo anterior del resumen del PDF, para deducir el sentido de los primeros movimientos. */
  openingBalanceCents?: number | null;
  now: Date;
}

export interface BuildResult {
  rows: StatementRow[];
  skipped: SkippedRow[];
  warnings: string[];
  signConvention: SignConvention | null;
  closingBalanceCents: number | null;
}

type Resolved = {
  index: number;
  date: string;
  description: string;
  cents: number;
  direction: Direction | null;
  /** Monto con signo de la columna única (null si vino en columnas de cargo/abono). */
  negative: boolean | null;
  /** Pista débil de la columna de tipo ("Pago"), para cuando nada más decide. */
  typeHint: Direction | null;
  balanceCents: number | null;
  how: "column" | "marker" | "type" | "sign" | "balance" | "keyword" | "default";
  source: string;
};

function rowText(row: RawRow): string {
  return clip([row.date, row.description, row.amount, row.debit, row.credit, row.type, row.balance].filter(Boolean).join(" · "));
}

function signed(value: AmountValue | null): number | null {
  return value ? (value.negative ? -value.cents : value.cents) : null;
}

/** Cuánto mueve el saldo un movimiento: en débito un cargo lo baja; en una tarjeta lo sube (se debe más). */
function balanceEffect(direction: Direction, cents: number, kind: AccountKind): number {
  return (direction === "DEBIT") === (kind === "liability") ? cents : -cents;
}

/**
 * Votos de los saldos para la convención de signo: entre dos filas seguidas con saldo, la diferencia tiene que ser
 * el monto de la segunda con un signo u otro. Es la prueba más fuerte que trae un archivo.
 */
function balanceVotes(chronological: Resolved[], kind: AccountKind): SignVotes {
  const votes: SignVotes = { negativeIsDebit: 0, positiveIsDebit: 0 };
  for (let i = 1; i < chronological.length; i++) {
    const [before, row] = [chronological[i - 1], chronological[i]];
    if (before.balanceCents === null || row.balanceCents === null || row.negative === null) continue;
    const delta = row.balanceCents - before.balanceCents;
    // Con "negativo = cargo", un negativo es un cargo.
    const asNegativeIsDebit = balanceEffect(row.negative ? "DEBIT" : "CREDIT", row.cents, kind);
    if (Math.abs(delta - asNegativeIsDebit) <= 1) votes.negativeIsDebit += 3;
    else if (Math.abs(delta + asNegativeIsDebit) <= 1) votes.positiveIsDebit += 3;
  }
  return votes;
}

/**
 * Sentido de los movimientos que no lo traen, a partir de los saldos. Entre dos saldos conocidos, los movimientos
 * (con su signo) deben sumar la diferencia: se prueban las combinaciones de cargo y abono de los que no tienen
 * sentido y, si solo una cuadra, se aplica. Sirve con saldo en cada fila y con saldo solo al cierre del día.
 */
function inferFromBalances(chronological: Resolved[], opening: number | null, kind: AccountKind) {
  let previous = opening;
  let group: Resolved[] = [];
  for (const row of chronological) {
    group.push(row);
    if (row.balanceCents === null) continue;
    if (previous !== null) solveGroup(group, row.balanceCents - previous, kind);
    previous = row.balanceCents;
    group = [];
  }
}

function solveGroup(group: Resolved[], delta: number, kind: AccountKind) {
  let known = 0;
  const unknown: Resolved[] = [];
  for (const row of group) {
    if (row.direction === null) unknown.push(row);
    else known += balanceEffect(row.direction, row.cents, kind);
  }
  if (unknown.length === 0 || unknown.length > MAX_BALANCE_UNKNOWNS) return;
  const target = delta - known;
  let solution: number | null = null;
  for (let mask = 0; mask < 1 << unknown.length; mask++) {
    let sum = 0;
    for (let i = 0; i < unknown.length; i++) sum += balanceEffect(mask & (1 << i) ? "CREDIT" : "DEBIT", unknown[i].cents, kind);
    if (Math.abs(sum - target) > 1) continue;
    if (solution !== null) return; // más de una combinación cuadra: no se adivina
    solution = mask;
  }
  if (solution === null) return;
  unknown.forEach((row, i) => {
    row.direction = solution! & (1 << i) ? "CREDIT" : "DEBIT";
    row.how = "balance";
  });
}

export function buildRows(input: BuildInput): BuildResult {
  const today = isoDay(input.now);
  const latest = addDays(today, 2);
  const yearFor = yearResolver(input.periodEnd ?? today);
  const skipped: SkippedRow[] = [];
  const warnings: string[] = [];
  const resolved: Resolved[] = [];
  /** Filas de la columna única de montos: todas sirven para deducir la convención de signo. */
  const signedRows: (SignedRow & { index: number })[] = [];
  const yearlessDates: string[] = [];

  input.raw.forEach((row, index) => {
    const skip = (reason: string) => skipped.push({ source: row.source, reason, text: rowText(row) });
    if (row.rejected) return skip(row.rejected);
    const token: DateToken | null = readDateToken(row.date);
    if (!token) return skip(row.date.trim() ? `Fecha no reconocida: «${clip(row.date, 30)}»` : "Sin fecha");
    const date = resolveDate(token, input.dateOrder, yearFor);
    if (!date) return skip(`Fecha inválida: «${clip(row.date, 30)}»`);
    if (date < "2000-01-01") return skip(`Fecha fuera de rango: ${date}`);
    if (date > latest) return skip(`Fecha en el futuro: ${date}`);

    const values = { debit: row.debit, credit: row.credit, amount: row.amount, balance: row.balance };
    const parsed: Record<keyof typeof values, AmountValue | null> = { debit: null, credit: null, amount: null, balance: null };
    for (const key of Object.keys(values) as (keyof typeof values)[]) {
      const text = values[key]?.trim();
      if (!text || /^[-–—]+$/.test(text)) continue;
      const value = parseAmount(text);
      if (!value) {
        if (key === "balance") continue; // un saldo ilegible no invalida el movimiento
        return skip(`Monto no reconocido: «${clip(text, 30)}»`);
      }
      parsed[key] = value;
    }

    const description = squash(row.description).slice(0, MAX_DESCRIPTION) || "Sin descripción";
    const base = { index, date, description, typeHint: null, balanceCents: signed(parsed.balance), source: row.source };
    const debit = parsed.debit?.cents ?? 0;
    const credit = parsed.credit?.cents ?? 0;
    if (debit > 0 || credit > 0) {
      const net = credit - debit;
      if (net === 0) return skip("Cargo y abono se anulan");
      if (token.kind !== "full" && token.y === null) yearlessDates.push(date);
      resolved.push({ ...base, cents: Math.abs(net), direction: net > 0 ? "CREDIT" : "DEBIT", negative: null, how: "column" });
      return;
    }
    const amount = parsed.amount;
    if (!amount || amount.cents === 0) {
      return skip(parsed.debit || parsed.credit || amount ? "Monto en cero" : "Sin monto");
    }
    if (token.kind !== "full" && token.y === null) yearlessDates.push(date);
    const byType = typeDirection(row.type, input.kind);
    const known = amount.marker ? (amount.marker === "CR" ? "CREDIT" : "DEBIT") : byType?.certain ? byType.direction : null;
    signedRows.push({ index: resolved.length, negative: amount.negative, description, known });
    if (known) {
      resolved.push({ ...base, cents: amount.cents, direction: known, negative: amount.negative, how: amount.marker ? "marker" : "type" });
      return;
    }
    resolved.push({
      ...base,
      cents: amount.cents,
      direction: null,
      negative: amount.negative,
      typeHint: byType?.direction ?? null,
      how: "sign",
    });
  });

  // En orden cronológico (hay bancos que exportan del más nuevo al más viejo).
  const descending = resolved.length > 1 && resolved[0].date > resolved[resolved.length - 1].date;
  const chronological = descending ? [...resolved].reverse() : resolved;

  // Signo: solo informa si el archivo trae negativos; si todos son positivos, la columna no dice nada.
  let convention: SignConvention | null = null;
  if (signedRows.some((row) => row.negative)) {
    const decision: SignDecision = input.signConvention
      ? { convention: input.signConvention, guessed: false }
      : detectSignConvention(signedRows, input.kind, balanceVotes(chronological, input.kind));
    convention = decision.convention;
    if (decision.guessed) {
      warnings.push(
        `No hay pistas claras de qué son los montos negativos: los tomé como ${
          convention === "negative_is_debit" ? "gastos" : "ingresos o pagos"
        }. Cámbialo si no cuadra.`,
      );
    }
    for (const row of signedRows) {
      if (resolved[row.index].direction !== null) continue;
      const debit = convention === "negative_is_debit" ? row.negative : !row.negative;
      resolved[row.index].direction = debit ? "DEBIT" : "CREDIT";
    }
  }

  inferFromBalances(chronological, input.openingBalanceCents ?? null, input.kind);

  let guessed = 0;
  for (const row of resolved) {
    if (row.direction !== null) continue;
    const hint = row.typeHint ?? keywordDirection(row.description);
    row.direction = hint ?? "DEBIT";
    row.how = hint ? "keyword" : "default";
    if (!hint) guessed++;
  }
  if (guessed > 0) {
    warnings.push(
      guessed === 1
        ? "Un movimiento no indicaba si era cargo o abono: lo tomé como gasto."
        : `${guessed} movimientos no indicaban si eran cargo o abono: los tomé como gastos.`,
    );
  }
  if (yearlessDates.length > 0 && !input.periodEnd) {
    warnings.push("Las fechas no traen año y no encontré el periodo del estado de cuenta: supuse que son de los últimos 12 meses.");
  }
  if (yearlessDates.length > 1) {
    const sorted = [...yearlessDates].sort();
    const span = (Date.parse(sorted[sorted.length - 1]) - Date.parse(sorted[0])) / DAY_MS;
    if (span > MAX_YEARLESS_SPAN_DAYS) {
      warnings.push("Las fechas no traen año y quedaron repartidas en más de tres meses: revisa que el año de cada movimiento sea el correcto.");
    }
  }

  const withBalance = chronological.filter((row) => row.balanceCents !== null);
  const closingBalanceCents = withBalance.length > 0 ? withBalance[withBalance.length - 1].balanceCents : null;
  const rows: StatementRow[] = resolved
    .map((row) => ({
      date: row.date,
      description: row.description,
      amountCents: row.cents,
      direction: row.direction as Direction,
      balanceCents: row.balanceCents,
      source: row.source,
      order: descending ? -row.index : row.index,
    }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.order - b.order))
    .map(({ order: _order, ...row }) => row);

  return { rows, skipped, warnings, signConvention: convention, closingBalanceCents };
}
