// Tipos del importador de estados de cuenta (CSV y PDF). Sin dependencias de servidor: los usan los lectores,
// el servicio, las pruebas y la interfaz.

export type StatementFormat = "csv" | "pdf";
export type Direction = "DEBIT" | "CREDIT";

/** Orden de día, mes y año en las fechas numéricas ("05/03/2024"). */
export type DateOrder = "DMY" | "MDY" | "YMD";

/** Cómo leer una sola columna de montos con signo. */
export type SignConvention = "negative_is_debit" | "positive_is_debit";

/**
 * Cuenta de activo (débito, ahorro, monedero) o de pasivo (tarjeta de crédito). Cambia el sentido del saldo:
 * en una tarjeta, una compra hace crecer lo que se debe.
 */
export type AccountKind = "asset" | "liability";

/** Columna del CSV: su encabezado (sin importar mayúsculas ni acentos) o su posición, empezando en 0. */
export type ColumnRef = string | number;

export type ColumnRole = "date" | "description" | "amount" | "debit" | "credit" | "type" | "balance";

export type CsvMapping = Partial<Record<ColumnRole, ColumnRef>>;

export interface ParseOptions {
  /** Columnas elegidas a mano; lo que no se indique se detecta solo. */
  mapping?: CsvMapping;
  dateOrder?: DateOrder;
  signConvention?: SignConvention;
  accountKind?: AccountKind;
  /** Contraseña del PDF. Solo se usa en memoria para abrirlo: nunca se guarda ni se registra. */
  password?: string;
  /** "Hoy", para descartar fechas futuras y completar años (las pruebas lo fijan). */
  now?: Date;
}

/** Movimiento tal como viene en el archivo, antes de validar. Los montos siguen siendo texto. */
export interface RawRow {
  /** Dónde está en el archivo ("fila 12", "página 2"), para explicar lo que se omite. */
  source: string;
  date: string;
  description: string;
  /** Monto con signo en una sola columna. */
  amount?: string | null;
  /** Columnas separadas de cargos y abonos. */
  debit?: string | null;
  credit?: string | null;
  /** Texto que dice si es cargo o abono ("Cargo", "Abono", "CR"...). */
  type?: string | null;
  balance?: string | null;
  /**
   * El lector la descartó (un total, un saldo, un renglón con monto que no parece movimiento): no se importa, pero
   * aparece entre las filas omitidas con este motivo, para que el usuario vea que no se perdió nada a escondidas.
   */
  rejected?: string;
}

/** Movimiento válido: fecha ISO, monto positivo en centavos y sentido. */
export interface StatementRow {
  /** YYYY-MM-DD */
  date: string;
  description: string;
  amountCents: number;
  direction: Direction;
  /** Saldo después del movimiento, si el archivo lo trae (con signo). */
  balanceCents: number | null;
  source: string;
}

export interface SkippedRow {
  source: string;
  reason: string;
  /** Texto de la fila (recortado) para que el usuario la reconozca. */
  text: string;
}

export interface StatementDetection {
  dateOrder: DateOrder;
  /** Las fechas no dejan saber si son día/mes o mes/día: se usó el orden más probable. */
  dateOrderAmbiguous: boolean;
  /** Solo cuando los montos vienen con signo en una sola columna. */
  signConvention: SignConvention | null;
  /** CSV: encabezado usado para cada dato. */
  columns: Partial<Record<ColumnRole, string>> | null;
  /** CSV: encabezados encontrados, para elegir columnas a mano. */
  headers: string[] | null;
  /** CSV: primeras filas con datos, como ejemplo de cada columna. */
  sample: string[][] | null;
  delimiter: string | null;
  encoding: string | null;
  pages: number | null;
}

export interface ParsedStatement {
  format: StatementFormat;
  /** En orden cronológico. */
  rows: StatementRow[];
  skipped: SkippedRow[];
  warnings: string[];
  periodStart: string | null;
  periodEnd: string | null;
  /** Saldo al cierre (del resumen del PDF o del último saldo por fila), con signo. */
  closingBalanceCents: number | null;
  detected: StatementDetection;
}
