import { parseAmount, type AmountValue } from "./amounts";
import { readCsv } from "./csv";
import { addDays, inferDateOrder, isoDay, readDateToken, resolveDate, yearResolver, type DateToken } from "./dates";
import { MAX_STATEMENT_ROWS, statementError } from "./limits";
import { extractPdfText } from "./pdf";
import { readStatementLayout } from "./pdf-layout";
import { buildRows, type BuildResult } from "./rows";
import { decodeText, sniffFormat } from "./sniff";
import type { DateOrder, ParseOptions, ParsedStatement, StatementDetection, StatementFormat } from "./types";

// Punto de entrada del importador: detecta el formato, lee el archivo y devuelve movimientos validados.
// No toca la base de datos (lo usa el servicio para la vista previa y para importar).

export interface StatementFile {
  bytes: Uint8Array;
  fileName: string;
  mimeType?: string | null;
}

const ORDER_LABEL: Record<DateOrder, string> = { DMY: "día/mes/año", MDY: "mes/día/año", YMD: "año-mes-día" };

function signedCents(value: AmountValue | null): number | null {
  return value ? (value.negative ? -value.cents : value.cents) : null;
}

function checkRowCount(count: number) {
  if (count > MAX_STATEMENT_ROWS) {
    throw statementError(
      "too_many_rows",
      `El archivo tiene más de ${MAX_STATEMENT_ROWS.toLocaleString("es-MX")} movimientos. Divídelo por periodos más cortos.`,
    );
  }
}

type OrderChoice = { order: DateOrder; ambiguous: boolean; chosen: boolean };

/**
 * Orden de las fechas: el que eligió el usuario o el que se deduce. La ambigüedad describe los datos, no la
 * elección: así la vista previa sigue ofreciendo el cambio después de elegir.
 */
function dateOrderFor(tokens: (DateToken | null)[], options: ParseOptions): OrderChoice {
  const inferred = inferDateOrder(tokens.filter((token): token is DateToken => token !== null));
  return options.dateOrder
    ? { order: options.dateOrder, ambiguous: inferred.ambiguous, chosen: true }
    : { ...inferred, chosen: false };
}

function finish(input: {
  format: StatementFormat;
  built: BuildResult;
  warnings: string[];
  order: OrderChoice;
  detected: Omit<StatementDetection, "dateOrder" | "dateOrderAmbiguous" | "signConvention">;
  period: { start: string | null; end: string | null };
  closingBalanceCents: number | null;
}): ParsedStatement {
  const { built, order } = input;
  if (built.rows.length === 0) {
    throw statementError(
      "no_transactions_found",
      input.format === "pdf"
        ? "No encontré la tabla de movimientos en el PDF. Si tu banco lo permite, descarga el estado de cuenta en CSV."
        : "No encontré movimientos válidos en el archivo. Revisa que las columnas de fecha y monto sean las correctas.",
      // Con encabezados, la interfaz abre el selector de columnas: casi siempre es una columna equivocada.
      { skipped: built.skipped.slice(0, 5), headers: input.detected.headers, sample: input.detected.sample },
    );
  }
  const first = built.rows[0].date;
  const last = built.rows[built.rows.length - 1].date;
  const warnings = [...input.warnings];
  if (order.ambiguous && !order.chosen) {
    warnings.unshift(
      `No se distingue si las fechas son día/mes o mes/día: las leí como ${ORDER_LABEL[order.order]}. Cámbialo si no cuadran.`,
    );
  }
  return {
    format: input.format,
    rows: built.rows,
    skipped: built.skipped,
    warnings,
    periodStart: input.period.start && input.period.start < first ? input.period.start : first,
    periodEnd: input.period.end && input.period.end > last ? input.period.end : last,
    closingBalanceCents: input.closingBalanceCents,
    detected: {
      ...input.detected,
      dateOrder: order.order,
      dateOrderAmbiguous: order.ambiguous,
      signConvention: built.signConvention,
    },
  };
}

export async function parseStatement(file: StatementFile, options: ParseOptions = {}): Promise<ParsedStatement> {
  const now = options.now ?? new Date();
  const kind = options.accountKind ?? "asset";
  const format = sniffFormat(file.bytes, file.fileName, file.mimeType ?? "");

  if (format === "csv") {
    const { text, encoding } = decodeText(file.bytes);
    const table = readCsv(text, options.mapping);
    checkRowCount(table.raw.length);
    const order = dateOrderFor(table.raw.map((row) => readDateToken(row.date)), options);
    const built = buildRows({ raw: table.raw, kind, dateOrder: order.order, signConvention: options.signConvention, now });
    return finish({
      format,
      built,
      warnings: [...table.warnings, ...built.warnings],
      order,
      detected: {
        columns: table.columns,
        headers: table.headers,
        sample: table.sample,
        delimiter: table.delimiter,
        encoding,
        pages: null,
      },
      period: { start: null, end: null },
      closingBalanceCents: built.closingBalanceCents ?? signedCents(parseAmount(table.closingBalanceText)),
    });
  }

  const { pages, items } = await extractPdfText(file.bytes, options.password);
  const layout = readStatementLayout(items, kind);
  if (layout.textChars < 20) {
    throw statementError(
      "scanned_pdf",
      "Este PDF es una imagen escaneada y no tiene texto que se pueda leer. Descarga el estado de cuenta digital (PDF o CSV) desde tu banca en línea.",
    );
  }
  checkRowCount(layout.raw.length);

  const startToken = readDateToken(layout.periodStartText);
  const endToken = readDateToken(layout.periodEndText);
  const order = dateOrderFor([...layout.raw.map((row) => readDateToken(row.date)), startToken, endToken], options);
  const today = isoDay(now);
  let periodEnd = endToken ? resolveDate(endToken, order.order, yearResolver(today)) : null;
  if (periodEnd && periodEnd > addDays(today, 31)) periodEnd = null; // no era el periodo
  let periodStart = startToken ? resolveDate(startToken, order.order, yearResolver(periodEnd ?? today)) : null;
  if (periodStart && periodEnd && periodStart > periodEnd) periodStart = null;

  const built = buildRows({
    raw: layout.raw,
    kind,
    dateOrder: order.order,
    signConvention: options.signConvention,
    periodEnd,
    openingBalanceCents: signedCents(parseAmount(layout.openingBalanceText)),
    now,
  });
  return finish({
    format,
    built,
    warnings: built.warnings,
    order,
    detected: { columns: null, headers: null, sample: null, delimiter: null, encoding: null, pages },
    period: { start: periodStart, end: periodEnd },
    closingBalanceCents: signedCents(parseAmount(layout.closingBalanceText)) ?? built.closingBalanceCents,
  });
}
