import Papa from "papaparse";
import { parseAmount } from "./amounts";
import { readDateToken } from "./dates";
import { statementError } from "./limits";
import { fold } from "./text";
import type { ColumnRef, ColumnRole, CsvMapping, RawRow } from "./types";

// CSV de bancos: encuentra la fila de encabezados (aunque antes vengan el nombre del banco, la cuenta o el
// periodo), reconoce las columnas en español e inglés y arma filas crudas. PapaParse separa los campos
// (comillas, comas dentro de comillas, saltos de línea); el delimitador se detecta aquí para que las líneas de
// presentación no lo confundan.

const DELIMITERS = [",", ";", "\t", "|"] as const;
const HEADER_SEARCH_ROWS = 40;
const SAMPLE_ROWS = 3;

/** Primeras filas con datos después de la fila `index` (los ejemplos de cada columna). */
function sampleAfter(rows: string[][], index: number): string[][] {
  return rows
    .slice(index + 1)
    .filter((row) => row.some((cell) => cell))
    .slice(0, SAMPLE_ROWS);
}

export interface CsvTable {
  raw: RawRow[];
  /** Saldo de una fila "Saldo final" (para archivos sin columna de saldo). */
  closingBalanceText: string | null;
  headers: string[] | null;
  /** Primeras filas con datos, para mostrar ejemplos al elegir columnas. */
  sample: string[][];
  columns: Partial<Record<ColumnRole, string>>;
  delimiter: string;
  warnings: string[];
}

function countOutsideQuotes(line: string, delimiter: string): number {
  let inQuotes = false;
  let count = 0;
  for (const ch of line) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (ch === delimiter && !inQuotes) count++;
  }
  return count;
}

/** El delimitador que parte más líneas en el mismo número de columnas (sin contar lo que va entre comillas). */
export function detectDelimiter(text: string): string {
  const lines = text
    .split(/\r\n|\n|\r/)
    .filter((line) => line.trim())
    .slice(0, 60);
  let best = { delimiter: ",", score: -1 };
  for (const delimiter of DELIMITERS) {
    const frequency = new Map<number, number>();
    for (const line of lines) {
      const count = countOutsideQuotes(line, delimiter);
      if (count > 0) frequency.set(count, (frequency.get(count) ?? 0) + 1);
    }
    let agreeing = 0;
    let columns = 0;
    for (const [count, times] of frequency) {
      if (times > agreeing || (times === agreeing && count > columns)) {
        agreeing = times;
        columns = count;
      }
    }
    const score = agreeing * 1000 + columns;
    if (score > best.score) best = { delimiter, score };
  }
  return best.delimiter;
}

function tokenize(text: string, delimiter: string): { rows: string[][]; quoteErrors: number } {
  const result = Papa.parse<string[]>(text, { delimiter, header: false, skipEmptyLines: false, dynamicTyping: false });
  const rows = result.data.map((row) => (Array.isArray(row) ? row.map((cell) => String(cell ?? "").trim()) : []));
  const quoteErrors = result.errors.filter((error) => error.type === "Quotes").length;
  return { rows, quoteErrors };
}

// Encabezados que usan los bancos para cada dato (ya sin acentos ni signos).
const SYNONYMS: Record<ColumnRole, string[]> = {
  date: [
    "fecha", "fecha operacion", "fecha de operacion", "fecha oper", "fecha movimiento", "fecha de movimiento",
    "fecha del movimiento", "fecha transaccion", "fecha de transaccion", "fecha compra", "fecha de compra",
    "fecha consumo", "fecha valor", "fecha aplicacion", "fecha de aplicacion", "fecha contable", "fecha cargo",
    "fecha liquidacion", "fecha de liquidacion", "fecha de valor", "f operacion", "f oper", "f valor", "f contable",
    "f movimiento", "f mov", "f aplicacion", "dia", "date", "transaction date", "trans date", "posting date",
    "posted date", "post date", "value date", "booking date",
  ],
  // En orden de preferencia: Chase trae "Details" (DEBIT/CREDIT) y "Description"; la buena es la segunda.
  description: [
    "descripcion", "concepto", "description", "descripcion del movimiento", "concepto del movimiento", "detalle",
    "detalles", "movimiento", "comercio", "establecimiento", "beneficiario", "glosa", "narrativa",
    "transaction description", "transaction details", "memo", "payee", "merchant", "name", "narrative", "particulars",
    "details",
  ],
  amount: [
    "monto", "importe", "cantidad", "valor", "monto transaccion", "importe transaccion", "amount",
    "transaction amount", "amt", "value",
  ],
  debit: [
    "cargo", "cargos", "retiro", "retiros", "debito", "debitos", "debe", "egreso", "egresos", "salida", "salidas",
    "debit", "debits", "debit amount", "withdrawal", "withdrawals", "money out", "paid out", "importe cargo", "monto cargo",
  ],
  credit: [
    "abono", "abonos", "deposito", "depositos", "credito", "creditos", "haber", "ingreso", "ingresos", "entrada",
    "entradas", "credit", "credits", "credit amount", "deposit", "deposits", "money in", "paid in", "importe abono",
    "monto abono",
  ],
  type: [
    "tipo", "tipo de movimiento", "tipo movimiento", "tipo de transaccion", "tipo transaccion", "naturaleza",
    "cargo abono", "abono cargo", "debito credito", "credito debito", "signo", "type", "transaction type", "dr cr",
    "cr dr", "debit credit",
  ],
  balance: [
    "saldo", "saldo disponible", "saldo disp", "saldo final", "saldo contable", "saldo operacion", "saldo liquidacion",
    "saldo actual", "balance", "running balance", "running bal", "available balance",
  ],
};
const ROLES = Object.keys(SYNONYMS) as ColumnRole[];
/** Columnas que se parecen a un dato pero no lo son ("Tipo de cambio" no es el tipo; "Cantidad de cuotas", un monto). */
const NOT_A_ROLE =
  /\b(tipo de cambio|exchange rate|hora|time|referencia|reference|folio|autorizacion|sucursal|branch|moneda|currency|categoria|category|cuotas?|installments?|plazo|meses|msi|tasa|rate|porcentaje|percent)\b/;
const MONEY_ROLES: ColumnRole[] = ["amount", "debit", "credit", "balance"];

function headerKey(cell: string): string {
  return fold(cell.replace(/\(.*?\)/g, " "))
    .replace(/\b(mxn|usd|eur|cop|clp|ars|pen|mn)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** 3 a 3.5 si es un sinónimo exacto (más cuanto antes aparece en la lista), 2 si empieza o termina igual, 1 si lo contiene. */
function roleScore(key: string, role: ColumnRole): number {
  if (!key || NOT_A_ROLE.test(key)) return 0;
  const synonyms = SYNONYMS[role];
  let best = 0;
  for (const [index, synonym] of synonyms.entries()) {
    if (key === synonym) return 3 + 0.5 * (1 - index / synonyms.length);
    if (key.startsWith(`${synonym} `) || key.endsWith(` ${synonym}`)) best = Math.max(best, 2);
    else if (` ${key} `.includes(` ${synonym} `)) best = Math.max(best, 1);
  }
  return best;
}

/** Asigna a cada dato su mejor columna; cada columna sirve para un solo dato. */
function assignRoles(headers: string[]): Partial<Record<ColumnRole, number>> {
  const candidates: { role: ColumnRole; column: number; score: number }[] = [];
  headers.forEach((header, column) => {
    const key = headerKey(header);
    // "Fecha valor" o "Value Date" se parecen a "valor"/"value" (montos), pero son fechas: si la columna se parece más
    // a una fecha que a dinero, no puede ser de dinero ni aunque la fecha ya la tenga otra columna. ("Saldo al día"
    // empata y se queda como saldo.)
    const dateScore = roleScore(key, "date");
    const dateLike = dateScore > 0 && MONEY_ROLES.every((role) => dateScore > roleScore(key, role));
    for (const role of ROLES) {
      if (dateLike && MONEY_ROLES.includes(role)) continue;
      const score = roleScore(key, role);
      if (score > 0) candidates.push({ role, column, score });
    }
  });
  candidates.sort((x, y) => y.score - x.score || x.column - y.column || ROLES.indexOf(x.role) - ROLES.indexOf(y.role));
  const roles: Partial<Record<ColumnRole, number>> = {};
  const used = new Set<number>();
  for (const candidate of candidates) {
    if (roles[candidate.role] !== undefined || used.has(candidate.column)) continue;
    roles[candidate.role] = candidate.column;
    used.add(candidate.column);
  }
  // Con columnas de cargos y de abonos, el monto con signo sobra (y una celda rara ahí tumbaría la fila entera).
  if (roles.debit !== undefined && roles.credit !== undefined) delete roles.amount;
  return roles;
}

const hasMoney = (roles: Partial<Record<ColumnRole, number>>) =>
  roles.amount !== undefined || roles.debit !== undefined || roles.credit !== undefined;

function findHeaderRow(rows: string[][]): { index: number; roles: Partial<Record<ColumnRole, number>> } | null {
  for (let i = 0; i < Math.min(rows.length, HEADER_SEARCH_ROWS); i++) {
    const roles = assignRoles(rows[i]);
    if (roles.date !== undefined && hasMoney(roles)) return { index: i, roles };
  }
  return null;
}

/** Dinero y no un número de referencia: lleva centavos, signo o símbolo de moneda. */
function looksLikeMoney(value: string): boolean {
  if (readDateToken(value) !== null || parseAmount(value) === null) return false;
  return /[.,]\d{1,2}\s*\)?\s*-?$/.test(value) || /^[-(−]/.test(value) || /[$€£]/.test(value);
}

/**
 * Sin encabezados: la columna de fechas es la que casi siempre trae fechas; las de dinero, las que casi
 * siempre traen montos; la descripción, la de texto más largo.
 */
function inferRolesByContent(rows: string[][]): Partial<Record<ColumnRole, number>> | null {
  // Desde la primera fila con una fecha: los títulos y la presentación no cuentan.
  const firstData = rows.findIndex((row) => row.some((cell) => readDateToken(cell) !== null));
  if (firstData < 0) return null;
  const sample = rows.slice(firstData).filter((row) => row.some((cell) => cell)).slice(0, 200);
  if (sample.length < 2) return null;
  const width = Math.max(...sample.map((row) => row.length));
  const stats = Array.from({ length: width }, (_, column) => {
    const values = sample.map((row) => row[column] ?? "").filter(Boolean);
    const dates = values.filter((value) => readDateToken(value) !== null).length;
    const money = values.filter(looksLikeMoney).length;
    const textLength = values.reduce((sum, value) => sum + value.length, 0) / Math.max(values.length, 1);
    return { column, filled: values.length, dates, money, textLength };
  });
  const date = stats.find((s) => s.filled >= sample.length * 0.6 && s.dates >= s.filled * 0.8);
  if (!date) return null;
  const moneyColumns = stats.filter(
    (s) => s.column !== date.column && s.filled >= sample.length * 0.1 && s.money >= s.filled * 0.9,
  );
  if (moneyColumns.length === 0) return null;
  const description = stats
    .filter((s) => s.column !== date.column && !moneyColumns.includes(s) && s.filled >= sample.length * 0.5)
    .sort((x, y) => y.textLength - x.textLength)[0];

  const roles: Partial<Record<ColumnRole, number>> = { date: date.column };
  if (description) roles.description = description.column;
  const [first, second, third] = moneyColumns.map((s) => s.column);
  const both = (x: number, y: number) => sample.filter((row) => row[x] && row[y]).length;
  const either = (x: number, y: number) => sample.filter((row) => row[x] || row[y]).length;
  if (second === undefined) {
    roles.amount = first;
  } else if (both(first, second) <= either(first, second) * 0.1) {
    // Nunca llenas a la vez: cargos y abonos.
    roles.debit = first;
    roles.credit = second;
    if (third !== undefined) roles.balance = third;
  } else {
    roles.amount = first;
    roles.balance = moneyColumns[moneyColumns.length - 1].column;
  }
  return roles;
}

/**
 * Con encabezados que no se reconocen, la fila justo antes de la primera fecha es la de títulos: se usa como
 * encabezado y no aparece como un movimiento con "fecha no reconocida".
 */
function titleRowBefore(rows: string[][], dateColumn: number): number {
  const firstData = rows.slice(0, HEADER_SEARCH_ROWS).findIndex((row) => readDateToken(row[dateColumn]) !== null);
  return firstData > 0 && rows[firstData - 1].some((cell) => cell) ? firstData - 1 : -1;
}

function columnLabel(headers: string[] | null, column: number): string {
  const header = headers?.[column]?.trim();
  return header ? header : `Columna ${column + 1}`;
}

/** Columnas elegidas a mano: por encabezado o por posición. Lo que no se indique queda como se detectó. */
function applyMapping(
  mapping: CsvMapping,
  rows: string[][],
  detected: { index: number; roles: Partial<Record<ColumnRole, number>> } | null,
): { index: number; roles: Partial<Record<ColumnRole, number>> } {
  const byName = Object.values(mapping).filter((ref): ref is string => typeof ref === "string");
  let index = detected?.index ?? -1;
  if (byName.length > 0) {
    const wanted = byName.map(headerKey);
    const found = rows
      .slice(0, HEADER_SEARCH_ROWS)
      .findIndex((row) => wanted.every((key) => row.some((cell) => headerKey(cell) === key)));
    if (found < 0) {
      const titles = detected ? detected.index : rows.findIndex((row) => row.filter(Boolean).length > 1);
      throw statementError("invalid_mapping", "No encontré en el archivo las columnas que elegiste.", {
        headers: titles >= 0 ? rows[titles] : [],
        sample: sampleAfter(rows, titles),
        missing: byName,
      });
    }
    index = found;
  } else if (index < 0 && typeof mapping.date === "number") {
    index = titleRowBefore(rows, mapping.date);
  }
  const headerRow = index >= 0 ? rows[index] : null;
  const width = Math.max(...rows.slice(0, 50).map((row) => row.length));
  const resolve = (ref: ColumnRef): number => {
    if (typeof ref === "number") {
      if (ref >= width) {
        throw statementError("invalid_mapping", `El archivo no tiene una columna ${ref + 1}.`, {
          headers: headerRow ?? [],
          sample: sampleAfter(rows, index),
        });
      }
      return ref;
    }
    return headerRow ? headerRow.findIndex((cell) => headerKey(cell) === headerKey(ref)) : -1;
  };

  const roles: Partial<Record<ColumnRole, number>> = { ...(index === detected?.index ? detected?.roles : {}) };
  // Un monto único y las columnas de cargos/abonos se excluyen: si eligen uno, se descarta lo detectado del otro.
  if (mapping.amount !== undefined) {
    delete roles.debit;
    delete roles.credit;
  }
  if (mapping.debit !== undefined || mapping.credit !== undefined) delete roles.amount;
  for (const role of ROLES) {
    const ref = mapping[role];
    if (ref === undefined) continue;
    const column = resolve(ref);
    if (column < 0) {
      throw statementError("invalid_mapping", `No encontré la columna «${ref}».`, { headers: headerRow ?? [], sample: sampleAfter(rows, index) });
    }
    for (const other of ROLES) if (roles[other] === column && other !== role) delete roles[other];
    roles[role] = column;
  }
  return { index, roles };
}

const SUMMARY_ROW = /^(total(es)?|subtotal|saldo (anterior|inicial|final|al corte|actual)|nuevo saldo|(opening|closing|ending|beginning|previous|new) balance|balance forward)\b/;
/** Filas de saldo con fecha ("01/02/2024, Saldo inicial, 10,000.00"): traen un saldo, no un movimiento. */
const BALANCE_ROW =
  /^(saldo (anterior|inicial|final|al corte|actual|del dia|al dia|disponible)|nuevo saldo|(opening|closing|ending|beginning|previous|new|starting) balance|balance forward)\b/;
const CLOSING_ROW = /^(saldo (final|al corte|actual)|nuevo saldo|(closing|ending|new) balance)\b/;
/** Totales con fecha. Exactos: "TOTAL PLAY TELECOM" es un comercio. */
const TOTAL_ROW =
  /^(totales?|subtotal)( (de )?(los )?(cargos|abonos|retiros|depositos|movimientos|compras|pagos|del periodo|del mes|debits|credits|withdrawals|deposits))?$/;

export function readCsv(text: string, mapping?: CsvMapping): CsvTable {
  const delimiter = detectDelimiter(text);
  const { rows, quoteErrors } = tokenize(text, delimiter);
  const nonEmpty = rows.filter((row) => row.some((cell) => cell));
  if (nonEmpty.length === 0) throw statementError("empty_file", "El archivo no tiene filas.");

  let header = findHeaderRow(rows);
  if (mapping && Object.keys(mapping).length > 0) {
    header = applyMapping(mapping, rows, header);
  } else if (!header) {
    const roles = inferRolesByContent(rows);
    header = roles ? { index: titleRowBefore(rows, roles.date!), roles } : null;
  }
  if (!header || header.roles.date === undefined || !hasMoney(header.roles)) {
    // La primera fila con varios datos hace de títulos; las siguientes, de ejemplo.
    const firstRow = nonEmpty.find((row) => row.filter(Boolean).length > 1) ?? nonEmpty[0];
    throw statementError("columns_not_found", "No encontré las columnas de fecha y monto. Elige cuáles son.", {
      headers: firstRow,
      sample: sampleAfter(rows, rows.indexOf(firstRow)),
    });
  }

  const headers = header.index >= 0 ? rows[header.index] : null;
  const { roles } = header;
  if (roles.description === undefined) {
    // Sin columna de descripción: la de texto más largo que no sea de fecha ni de dinero.
    const used = new Set(Object.values(roles));
    const body = rows.slice(header.index + 1, header.index + 201);
    let best: { column: number; length: number } | null = null;
    const width = Math.max(...body.map((row) => row.length), 0);
    for (let column = 0; column < width; column++) {
      if (used.has(column)) continue;
      const length = body.reduce((sum, row) => sum + (looksLikeMoney(row[column] ?? "") ? 0 : (row[column] ?? "").length), 0);
      if (length > 0 && (!best || length > best.length)) best = { column, length };
    }
    if (best) roles.description = best.column;
  }

  const raw: RawRow[] = [];
  let closingBalanceText: string | null = null;
  const headerKeys = headers?.map(headerKey).join("|");
  const cell = (row: string[], role: ColumnRole) => (roles[role] === undefined ? null : (row[roles[role]!] ?? ""));
  for (let i = header.index + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row.some((value) => value)) continue;
    if (headerKeys && row.map(headerKey).join("|") === headerKeys) continue; // encabezado repetido
    const date = cell(row, "date") ?? "";
    // "Total", "Saldo final"... escritos en la columna de la fecha: no son movimientos.
    if (!readDateToken(date) && SUMMARY_ROW.test(fold(row.filter(Boolean).join(" ")))) continue;
    const entry: RawRow = {
      source: `fila ${i + 1}`,
      date,
      description: cell(row, "description") ?? "",
      amount: cell(row, "amount"),
      debit: cell(row, "debit"),
      credit: cell(row, "credit"),
      type: cell(row, "type"),
      balance: cell(row, "balance"),
    };
    // Con fecha, pero de saldo o de totales: se omite (y queda a la vista entre las filas omitidas).
    const label = fold(entry.description);
    if (BALANCE_ROW.test(label) || TOTAL_ROW.test(label)) {
      if (CLOSING_ROW.test(label)) closingBalanceText = entry.balance || entry.amount || closingBalanceText;
      raw.push({ ...entry, rejected: "Fila de saldo o de totales: no es un movimiento" });
      continue;
    }
    raw.push(entry);
  }

  const columns: Partial<Record<ColumnRole, string>> = {};
  for (const role of ROLES) {
    const column = roles[role];
    if (column !== undefined) columns[role] = columnLabel(headers, column);
  }
  const warnings =
    quoteErrors > 0 ? ["El CSV tiene comillas sin cerrar: revisa en la vista previa que no falten movimientos."] : [];
  return { raw, closingBalanceText, headers, sample: sampleAfter(rows, header.index), columns, delimiter, warnings };
}
