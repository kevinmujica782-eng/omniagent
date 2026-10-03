import { isMoneyToken, parseAmount } from "./amounts";
import { findDatesInText, readDateToken } from "./dates";
import { fold, squash } from "./text";
import type { RawRow } from "./types";

// Lectura de la tabla de movimientos de un PDF a partir del texto y sus posiciones (sin dependencias: se prueba
// con posiciones de ejemplo). Las posiciones importan: en "Cargos | Abonos | Saldo" el mismo número significa cosas
// distintas según la columna, y eso se pierde si se lee el PDF como texto plano.

export interface PdfTextItem {
  page: number;
  str: string;
  /** Esquina inferior izquierda, en puntos (el origen de PDF está abajo a la izquierda). */
  x: number;
  y: number;
  width: number;
  /** Tamaño de la letra. */
  size: number;
}

interface Cell {
  text: string;
  x0: number;
  x1: number;
}

interface Line {
  page: number;
  y: number;
  size: number;
  cells: Cell[];
  text: string;
}

type Role = "date" | "date2" | "description" | "reference" | "debit" | "credit" | "amount" | "balance";

interface Column {
  role: Role;
  x0: number;
  x1: number;
}

export interface PdfStatement {
  raw: RawRow[];
  /** Fechas del periodo tal como aparecen en el PDF (se interpretan con el orden de fechas del archivo). */
  periodStartText: string | null;
  periodEndText: string | null;
  openingBalanceText: string | null;
  closingBalanceText: string | null;
  /** Caracteres de texto útil: casi cero significa PDF escaneado (imagen). */
  textChars: number;
}

// ── Líneas y celdas ──────────────────────────────────────────────────────────────────────────────────────

/** pdf.js a veces entrega varias columnas en un solo trozo separado por espacios ("15/01   OXXO   45.00"). */
function splitWideGaps(item: PdfTextItem): PdfTextItem[] {
  if (!/\S\s{3,}\S/.test(item.str)) return [item];
  const out: PdfTextItem[] = [];
  const charWidth = item.width / Math.max(item.str.length, 1);
  for (const match of item.str.matchAll(/\S+(?:\s{1,2}\S+)*/g)) {
    const start = match.index ?? 0;
    out.push({ ...item, str: match[0], x: item.x + start * charWidth, width: match[0].length * charWidth });
  }
  return out;
}

function toCells(items: PdfTextItem[]): Cell[] {
  const pieces = items.flatMap(splitWideGaps).sort((a, b) => a.x - b.x);
  const cells: Cell[] = [];
  for (const piece of pieces) {
    const text = squash(piece.str);
    if (!text) continue;
    const last = cells[cells.length - 1];
    const gap = last ? piece.x - last.x1 : Infinity;
    // Mismo campo solo si el hueco es de un espacio: dos columnas pegadas ("REFERENCIA" y "CARGOS") quedan
    // separadas. Partir de más no estorba: el texto de una misma columna se vuelve a unir al leer la tabla.
    if (last && gap < piece.size * 0.35) {
      last.text += gap > piece.size * 0.12 ? ` ${text}` : text;
      last.x1 = Math.max(last.x1, piece.x + piece.width);
    } else {
      cells.push({ text, x0: piece.x, x1: piece.x + piece.width });
    }
  }
  return cells;
}

/**
 * pdf.js une en un solo trozo textos separados por menos de ~0.6 em ("0091234567 1,500.00"). Los importes del
 * final se vuelven a separar; su borde derecho es exacto porque van alineados a la derecha.
 */
function splitTrailingMoney(cell: Cell): Cell[] {
  const tail: Cell[] = [];
  let current = cell;
  for (let guard = 0; guard < 3; guard++) {
    const match = /^(.*\S)\s+(\S+)$/.exec(current.text);
    if (!match || !isMoneyToken(match[2])) break;
    const perChar = (current.x1 - current.x0) / current.text.length;
    const start = current.x1 - perChar * match[2].length;
    tail.unshift({ text: match[2], x0: start, x1: current.x1 });
    current = { text: match[1].replace(/\s*(?:US\$|MX\$|\$)$/, ""), x0: current.x0, x1: start - perChar };
  }
  return current.text ? [current, ...tail] : tail;
}

export function buildLines(items: PdfTextItem[]): Line[] {
  const sorted = items
    .filter((item) => item.str.trim())
    .sort((a, b) => a.page - b.page || b.y - a.y || a.x - b.x);
  const groups: { page: number; y: number; size: number; items: PdfTextItem[] }[] = [];
  for (const item of sorted) {
    const current = groups[groups.length - 1];
    const tolerance = current ? Math.max(2, Math.min(current.size, item.size) * 0.45) : 0;
    if (current && current.page === item.page && Math.abs(current.y - item.y) <= tolerance) {
      current.items.push(item);
      current.size = Math.max(current.size, item.size);
    } else {
      groups.push({ page: item.page, y: item.y, size: item.size, items: [item] });
    }
  }
  return groups.map((group) => {
    const cells = toCells(group.items).flatMap(splitTrailingMoney);
    return { page: group.page, y: group.y, size: group.size, cells, text: cells.map((cell) => cell.text).join(" ") };
  });
}

// ── Encabezados de la tabla ──────────────────────────────────────────────────────────────────────────────

const HEADER_ROLES: [Role, RegExp][] = [
  ["date", /^(fecha|fecha (de )?(la )?(oper|operacion|mov|movimiento|transaccion|compra|consumo|cargo|valor|aplicacion|contable)|f oper(acion)?|dia|date|trans(action)? date|post(ing|ed)? date)$/],
  ["date2", /^(fecha (de )?(liq|liquidacion|aplicacion|registro)|liq|oper|posting|post date)$/],
  ["description", /^(descripcion|concepto|detalle|detalles|movimiento|movimientos|descripcion del movimiento|concepto del movimiento|comercio|establecimiento|description|details|transaction( description| details)?|merchant|payee|narrative|glosa)$/],
  ["reference", /^(referencia|ref|folio|autorizacion|no de referencia|reference|cod|codigo|clave|sucursal)$/],
  ["debit", /^(cargos?|retiros?|debitos?|debe|egresos?|salidas?|debits?|withdrawals?|money out|paid out|charges?)$/],
  ["credit", /^(abonos?|depositos?|creditos?|haber|ingresos?|entradas?|credits?|deposits?|money in|paid in|payments?( and credits)?)$/],
  ["amount", /^(monto|importe|cantidad|valor|amount|monto mxn|importe mxn|importe en pesos)$/],
  ["balance", /^(saldo|saldos|saldo operacion|saldo liquidacion|saldo disponible|balance|running balance|operacion|liquidacion)$/],
];
const MONEY_ROLES = new Set<Role>(["debit", "credit", "amount", "balance"]);

function roleOf(text: string): Role | null {
  const key = fold(text);
  for (const [role, re] of HEADER_ROLES) if (re.test(key)) return role;
  return null;
}

/**
 * Títulos de una celda: uno solo, o varios que pdf.js juntó ("REFERENCIA CARGOS"). En ese caso se separan por
 * palabras (lo más largo que sea un título) y su posición se estima por caracteres.
 */
function headerColumns(cell: Cell): Column[] {
  const role = roleOf(cell.text);
  if (role) return [{ role, x0: cell.x0, x1: cell.x1 }];
  const words = [...cell.text.matchAll(/\S+/g)].map((m) => ({ start: m.index ?? 0, end: (m.index ?? 0) + m[0].length }));
  if (words.length < 2 || words.length > 8) return [];
  const perChar = (cell.x1 - cell.x0) / cell.text.length;
  const out: Column[] = [];
  for (let i = 0; i < words.length; ) {
    let next = i + 1;
    for (let j = words.length; j > i; j--) {
      const found = roleOf(cell.text.slice(words[i].start, words[j - 1].end));
      if (found) {
        out.push({ role: found, x0: cell.x0 + words[i].start * perChar, x1: cell.x0 + words[j - 1].end * perChar });
        next = j;
        break;
      }
    }
    i = next;
  }
  return out;
}

/** Encabezados de la tabla (a veces en dos renglones: "FECHA" arriba de "OPER  LIQ"). */
function detectHeader(line: Line, previous: Line | undefined): Column[] | null {
  // Un renglón con importes no es de títulos ("Cargos del mes 1,234.56").
  if (line.cells.some((cell) => isMoneyToken(cell.text))) return null;
  const columns: Column[] = [];
  const add = (source: Line) => {
    for (const cell of source.cells) columns.push(...headerColumns(cell));
  };
  add(line);
  // Un renglón de títulos es casi todo títulos; una frase que menciona "fecha" y "cargos" no lo es.
  const covered = columns.reduce((sum, column) => sum + (column.x1 - column.x0), 0);
  const width = line.cells.reduce((sum, cell) => sum + (cell.x1 - cell.x0), 0);
  if (columns.length === 0 || covered < width * 0.6) return null;
  const hasMoney = columns.some((column) => MONEY_ROLES.has(column.role) && column.role !== "balance");
  if (!hasMoney) return null;
  if (!columns.some((column) => column.role === "date") && previous && previous.page === line.page && previous.y - line.y < line.size * 2.2) {
    add(previous);
  }
  columns.sort((a, b) => a.x0 - b.x0);
  // "FECHA" encima de "OPER  LIQ": la primera subcolumna (operación) es la fecha del movimiento.
  const spanning = columns.find((column) => column.role === "date");
  const under = spanning ? columns.filter((column) => column.role === "date2" && overlap(column, spanning) > 0) : [];
  if (spanning && under.length > 0) {
    under[0].role = "date";
    columns.splice(columns.indexOf(spanning), 1);
  }
  // Al menos: fecha, y cargos/abonos/importe. Si "OPER" quedó como la única fecha, es la de operación.
  if (!columns.some((column) => column.role === "date")) {
    const operation = columns.find((column) => column.role === "date2");
    if (!operation) return null;
    operation.role = "date";
  }
  return columns;
}

function overlap(a: { x0: number; x1: number }, b: { x0: number; x1: number }): number {
  return Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
}

/** La columna de cada celda: la que más se le encima; si ninguna, la más cercana. */
function columnFor(cell: Cell, columns: Column[]): Column {
  let best = columns[0];
  let bestScore = -Infinity;
  for (const column of columns) {
    const shared = overlap(cell, column);
    const score = shared > 0 ? shared : -Math.min(Math.abs(cell.x0 - column.x1), Math.abs(column.x0 - cell.x1));
    if (score > bestScore) {
      bestScore = score;
      best = column;
    }
  }
  return best;
}

// ── Renglones que no son movimientos ─────────────────────────────────────────────────────────────────────

const OPENING = /^(saldo (anterior|inicial)|saldo al inicio( del periodo)?|(opening|beginning|previous) balance|balance forward)$/;
const CLOSING =
  /^(saldo (final|al corte|actual|nuevo)|nuevo saldo|saldo al final( del periodo)?|saldo deudor( total)?|saldo total|(ending|closing|new) balance)$/;
const SUMMARY =
  /^(total(es)?( de)?( los)?( cargos| abonos| retiros| depositos| movimientos| compras| pagos| comisiones)?|subtotal|saldo promedio( diario)?|saldo minimo|pago minimo( requerido)?|pago para no generar intereses|minimum payment( due)?|limite de credito|credit limit|credito disponible|available credit|fecha limite de pago|payment due date|total (debits|credits|withdrawals|deposits))$/;
const FOOTER = /^(pagina|page|hoja) \d+( de| of) \d+$|^\d+ (de|of) \d+$/;
/**
 * Renglones SIN fecha que empiezan así son del resumen ("TOTAL DE INTERESES DEL PERIODO", "PAGO MÍNIMO A CUBRIR",
 * "SALDO DEUDOR TOTAL"). Solo sin fecha: "06/FEB TOTAL PLAY TELECOM" es una compra.
 */
const SUMMARY_PREFIX =
  /^(total|totales|subtotal|saldo|pago minimo|pago para no generar|pago sin intereses|pago total|limite de credito|credito disponible|fecha limite|fecha de corte|minimum payment|new balance|previous balance|credit limit|available credit|payment due|interest charged|fees charged)\b/;
/** Un renglón real tiene unas pocas celdas; miles delatan un PDF hecho para trabar el lector. */
const MAX_CELLS_PER_LINE = 150;
const MAX_DESCRIPTION_CHARS = 300;

/** Texto de la línea sin fechas ni montos, para compararlo con los renglones de resumen. */
function labelOf(line: Line): string {
  return fold(line.cells.filter((cell) => !isMoneyToken(cell.text) && !readDateToken(cell.text)).map((cell) => cell.text).join(" "));
}

function lastMoney(line: Line): string | null {
  const money = line.cells.filter((cell) => isMoneyToken(cell.text));
  return money.length > 0 ? money[money.length - 1].text : null;
}

// ── Fecha al inicio de un texto ("15/01 OXXO", "15 ENE", "ENE 15") ───────────────────────────────────────

const LEADING_DATE =
  /^(\d{4}[/.\-]\d{1,2}[/.\-]\d{1,2}|\d{1,2}[/.\-]\d{1,2}(?:[/.\-]\d{2,4})?|\d{1,2}[/.\-\s][A-Za-z]{3,4}\.?(?:[/.\-\s]\d{2,4})?|[A-Za-z]{3}\.?\s\d{1,2}(?:,?\s\d{4})?)(?=\s|$)/;

function leadingDate(text: string): { date: string; rest: string } | null {
  const match = LEADING_DATE.exec(text.trim());
  if (!match || !readDateToken(match[1])) return null;
  return { date: match[1], rest: text.trim().slice(match[0].length).trim() };
}

// ── Periodo ──────────────────────────────────────────────────────────────────────────────────────────────

const PERIOD_WORDS = /\b(periodo|period|del|desde|from|opening|apertura)\b/;
const CUT_WORDS = /\b(fecha de corte|corte|closing date|statement date|statement closing date|fecha del estado)\b/;
/** La misma palabra en el texto original, para tomar la fecha que la sigue (no la "fecha límite de pago" de al lado). */
const CUT_WORDS_RAW = /(fecha\s+de\s+corte|corte|closing\s+date|statement\s+date|fecha\s+del\s+estado)/i;

function findPeriod(lines: Line[]): { start: string | null; end: string | null } {
  let cut: string | null = null;
  // Solo renglones sin importes: así un movimiento ("PAGO DEL SERVICIO 02/ENE 03/ENE 150.00") no pasa por periodo.
  const firstPages = lines.filter((line) => line.page <= 2 && !line.cells.some((cell) => isMoneyToken(cell.text)));
  for (let i = 0; i < firstPages.length; i++) {
    const line = firstPages[i];
    const key = fold(line.text);
    let dates = findDatesInText(line.text);
    if (dates.length < 2 && /\b(periodo|period)\b/.test(key) && firstPages[i + 1]) {
      dates = dates.concat(findDatesInText(firstPages[i + 1].text));
    }
    // "Del 01/01 al 31/01", "Opening/Closing Date 12/15/23 - 01/14/24": de la primera a la última fecha.
    if (dates.length >= 2 && PERIOD_WORDS.test(key)) return { start: dates[0], end: dates[dates.length - 1] };
    if (!cut && dates.length >= 1 && CUT_WORDS.test(key)) {
      const at = CUT_WORDS_RAW.exec(line.text);
      cut = (at ? findDatesInText(line.text.slice(at.index + at[0].length))[0] : undefined) ?? dates[0];
    }
  }
  return { start: null, end: cut };
}

// ── Movimientos ──────────────────────────────────────────────────────────────────────────────────────────

interface Draft {
  row: RawRow;
  line: Line;
  extra: number;
}

const MAX_CONTINUATION_LINES = 3;

export function readStatementLayout(items: PdfTextItem[], kind: "asset" | "liability" = "asset"): PdfStatement {
  const lines = buildLines(items);
  const textChars = items.reduce((sum, item) => sum + item.str.replace(/\s/g, "").length, 0);
  const period = findPeriod(lines);
  const raw: RawRow[] = [];
  let opening: string | null = null;
  let closing: string | null = null;

  let columns: Column[] | null = null;
  let draft: Draft | null = null;
  let lastDate: string | null = null;
  let lastLine: Line | null = null;
  const orphanLines: Line[] = [];

  const flush = () => {
    if (draft) raw.push(draft.row);
    draft = null;
  };
  const near = (a: Line | null, b: Line, factor: number) => a !== null && a.page === b.page && a.y - b.y <= b.size * factor;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.cells.length > MAX_CELLS_PER_LINE) continue;
    const header = detectHeader(line, lines[i - 1]);
    if (header) {
      flush();
      columns = header;
      // Encabezado repetido en otra página: el primer renglón sin fecha sigue siendo del mismo día.
      lastLine = line;
      continue;
    }
    const label = labelOf(line);
    if (OPENING.test(label) || CLOSING.test(label) || SUMMARY.test(label) || FOOTER.test(fold(line.text))) {
      if (OPENING.test(label) && opening === null) opening = lastMoney(line);
      if (CLOSING.test(label)) closing = lastMoney(line) ?? closing;
      flush();
      lastLine = null;
      continue;
    }
    if (!columns) {
      orphanLines.push(line);
      continue;
    }

    const { date, description, money } = readRow(line, columns);
    const hasAmount = money.debit !== undefined || money.credit !== undefined || money.amount !== undefined;
    // Lo que se descarta con monto o fecha queda entre las filas omitidas: nada se pierde a escondidas.
    const reject = (reason: string) => raw.push({ ...rowFrom(line, date ?? "", description, money), rejected: reason });

    if (date && hasAmount) {
      flush();
      draft = { row: rowFrom(line, date, description, money), line, extra: 0 };
      lastDate = date;
      lastLine = line;
    } else if (!date && hasAmount && SUMMARY_PREFIX.test(label)) {
      // Totales y datos del resumen, a menudo justo debajo de la tabla.
      flush();
      reject("Renglón del resumen del estado de cuenta: no es un movimiento");
      lastLine = null;
    } else if (
      !date &&
      hasAmount &&
      description.length > 0 &&
      lastDate &&
      near(lastLine, line, 3.2) &&
      alignedWithDescription(line, columns)
    ) {
      // Varios movimientos del mismo día: la fecha solo aparece en el primero.
      flush();
      draft = { row: rowFrom(line, lastDate, description, money), line, extra: 0 };
      lastLine = line;
    } else if (
      !hasAmount &&
      !date &&
      draft &&
      description.length > 0 &&
      draft.extra < MAX_CONTINUATION_LINES &&
      near(lastLine, line, 2.4) &&
      alignedWithDescription(line, columns)
    ) {
      // La descripción sigue en el renglón de abajo.
      draft.row.description = squash(`${draft.row.description} ${description.join(" ")}`).slice(0, MAX_DESCRIPTION_CHARS);
      draft.extra++;
      lastLine = line;
    } else {
      flush();
      if (hasAmount) reject("Renglón con monto que no parece un movimiento");
      else if (date) reject("Renglón con fecha pero sin un monto reconocible");
      if (hasAmount || date) lastLine = null;
    }
  }
  flush();

  // Sin encabezados reconocibles: renglones que empiezan con fecha y terminan con montos.
  if (raw.length === 0 && orphanLines.length > 0) raw.push(...readWithoutHeader(orphanLines, kind));

  return {
    raw,
    periodStartText: period.start,
    periodEndText: period.end,
    openingBalanceText: opening,
    closingBalanceText: closing,
    textChars,
  };
}

type MoneyRole = "debit" | "credit" | "amount" | "balance";

/**
 * Dentro de una columna de cargos, abonos, importe o saldo también valen los enteros sin centavos ("790", "15.990"
 * en pesos chilenos): ahí no hay referencias ni folios con los que confundirlos.
 */
function isColumnMoney(text: string): boolean {
  return isMoneyToken(text) || /^[-−–]?\s*\$?\s*\d{1,3}(?:[.,]\d{3})*$/.test(text.trim());
}

/** Lee un renglón con encabezados: cada celda a su columna y, dentro de una columna, el texto se une. */
function readRow(line: Line, columns: Column[]): { date: string | null; description: string[]; money: Partial<Record<MoneyRole, string>> } {
  const byColumn = new Map<Column, string[]>();
  for (const cell of line.cells) {
    const column = columnFor(cell, columns);
    const texts = byColumn.get(column);
    if (texts) texts.push(cell.text);
    else byColumn.set(column, [cell.text]);
  }
  let date: string | null = null;
  const description: string[] = [];
  const money: Partial<Record<MoneyRole, string>> = {};
  for (const column of columns) {
    const texts = byColumn.get(column);
    if (!texts) continue;
    const text = squash(texts.join(" "));
    if (column.role === "date") {
      const lead: { date: string; rest: string } | null = date === null ? leadingDate(text) : null;
      if (lead) {
        date = lead.date;
        // Lo que sigue a la fecha, sin una segunda fecha pegada ("02/ENE 02/ENE").
        const rest = leadingDate(lead.rest)?.rest ?? lead.rest;
        if (rest) description.push(rest);
      } else if (!readDateToken(text)) {
        description.push(text);
      }
    } else if (column.role === "date2") {
      if (!readDateToken(text)) description.push(text);
    } else if (column.role === "description") {
      description.push(text);
    } else if (MONEY_ROLES.has(column.role)) {
      // "$" y "1,234.56" pueden llegar en trozos separados.
      const value = texts.find((piece) => isColumnMoney(piece)) ?? (isColumnMoney(text) ? text : undefined);
      if (value) money[column.role as MoneyRole] ??= value;
    }
    // Referencias, folios y códigos no forman parte de la descripción.
  }
  return { date, description, money };
}

/**
 * Un renglón que continúa la descripción empieza bajo la columna de descripción; el texto legal que viene
 * después de la tabla suele empezar en el margen, bajo la fecha.
 */
function alignedWithDescription(line: Line, columns: Column[]): boolean {
  const description = columns.find((column) => column.role === "description");
  return !description || line.cells[0].x0 >= description.x0 - line.size;
}

function rowFrom(line: Line, date: string, description: string[], money: Partial<Record<MoneyRole, string>>): RawRow {
  return {
    source: `página ${line.page}`,
    date,
    description: squash(description.join(" ")),
    debit: money.debit ?? null,
    credit: money.credit ?? null,
    amount: money.amount ?? null,
    balance: money.balance ?? null,
  };
}

/**
 * Plan B sin encabezados: renglones que empiezan con fecha y traen importes.
 * - Saldo: en un renglón con dos importes, el último. Su columna se reconoce por el borde derecho (los números van
 *   alineados a la derecha), así que un renglón con un solo importe en esa columna trae el saldo y no el monto: se
 *   omite en lugar de importar el saldo como si fuera el movimiento.
 * - Si los montos forman dos columnas, la de la izquierda son cargos y la de la derecha abonos (así los ordenan casi
 *   todos los bancos); si los saldos dicen lo contrario, se invierten.
 */
function readWithoutHeader(lines: Line[], kind: "asset" | "liability"): RawRow[] {
  type Candidate = { page: number; date: string; description: string; money: Cell[]; extra: number };
  const candidates: Candidate[] = [];
  let last: Candidate | null = null;
  let lastLine: Line | null = null;
  for (const line of lines) {
    // La fecha puede venir en dos trozos ("15" y "ENE").
    let lead = line.cells[0] ? leadingDate(line.cells[0].text) : null;
    let consumed = 1;
    if (!lead && line.cells.length >= 2) {
      lead = leadingDate(`${line.cells[0].text} ${line.cells[1].text}`);
      consumed = 2;
    }
    const rest = line.cells.slice(consumed);
    const moneyCells = line.cells.filter((cell) => isMoneyToken(cell.text));
    if (lead && moneyCells.length > 0) {
      const texts = [lead.rest, ...rest.filter((cell) => !isMoneyToken(cell.text)).map((cell) => cell.text)];
      // Una segunda fecha al inicio (liquidación) no es descripción.
      const cleaned = texts.filter(Boolean).join(" ").replace(/^\d{1,2}[/.\-](?:\d{1,2}|[A-Za-z]{3})(?:[/.\-]\d{2,4})?\s+/, "");
      last = { page: line.page, date: lead.date, description: squash(cleaned).slice(0, MAX_DESCRIPTION_CHARS), money: moneyCells, extra: 0 };
      candidates.push(last);
      lastLine = line;
    } else if (
      last &&
      lastLine &&
      moneyCells.length === 0 &&
      !lead &&
      last.extra < MAX_CONTINUATION_LINES &&
      lastLine.page === line.page &&
      lastLine.y - line.y <= line.size * 2.4
    ) {
      last.description = squash(`${last.description} ${line.text}`).slice(0, MAX_DESCRIPTION_CHARS);
      last.extra++;
      lastLine = line;
    } else {
      last = null;
      lastLine = null;
    }
  }
  if (candidates.length === 0) return [];

  const edges = candidates
    .filter((c) => c.money.length >= 2)
    .map((c) => c.money[c.money.length - 1].x1)
    .sort((a, b) => a - b);
  const balanceEdge = edges.length > 0 ? edges[Math.floor(edges.length / 2)] : null;
  const rows = candidates.map((candidate) => {
    const { money } = candidate;
    if (money.length >= 2) return { candidate, amount: money[money.length - 2], balance: money[money.length - 1].text };
    const only = money[0];
    if (balanceEdge !== null && Math.abs(only.x1 - balanceEdge) <= 3) return { candidate, amount: null, balance: only.text };
    return { candidate, amount: only, balance: null };
  });

  // ¿Dos columnas de montos? Se agrupan sus bordes derechos.
  const amountEdges = rows.flatMap((row) => (row.amount ? [row.amount.x1] : [])).sort((a, b) => a - b);
  let split = 0;
  let widest = 0;
  for (let i = 1; i < amountEdges.length; i++) {
    if (amountEdges[i] - amountEdges[i - 1] > widest) {
      widest = amountEdges[i] - amountEdges[i - 1];
      split = (amountEdges[i] + amountEdges[i - 1]) / 2;
    }
  }
  const leftShare = amountEdges.length > 0 ? amountEdges.filter((edge) => edge < split).length / amountEdges.length : 0;
  const twoColumns = widest > 25 && leftShare >= 0.1 && leftShare <= 0.9;

  let leftIsDebit = true;
  if (twoColumns) {
    let agree = 0;
    let disagree = 0;
    for (let i = 1; i < rows.length; i++) {
      const before = rows[i - 1].balance ? parseAmount(rows[i - 1].balance) : null;
      const after = rows[i].balance ? parseAmount(rows[i].balance) : null;
      const amount = rows[i].amount;
      if (!before || !after || !amount) continue;
      const delta = (after.negative ? -after.cents : after.cents) - (before.negative ? -before.cents : before.cents);
      if (delta === 0) continue;
      const wentDown = kind === "liability" ? delta > 0 : delta < 0;
      if ((amount.x1 < split) === wentDown) agree++;
      else disagree++;
    }
    leftIsDebit = agree >= disagree;
  }

  return rows.map(({ candidate, amount, balance }) => {
    const row: RawRow = { source: `página ${candidate.page}`, date: candidate.date, description: candidate.description, balance };
    if (!amount) return { ...row, rejected: "Solo trae el saldo, sin el monto del movimiento" };
    if (twoColumns) {
      if ((amount.x1 < split) === leftIsDebit) row.debit = amount.text;
      else row.credit = amount.text;
    } else {
      row.amount = amount.text;
    }
    return row;
  });
}
