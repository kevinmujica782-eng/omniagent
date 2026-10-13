import type { RawRow, ScanAccountType } from "./types";

// Une las páginas leídas con IA en una sola tabla de movimientos, con el mismo formato que sale de un PDF con texto
// (renglones con fecha, descripción y montos todavía como texto). Así la lectura con IA pasa por las mismas reglas
// de fechas, montos, sentido, resúmenes y duplicados que un PDF o un CSV. Puro: sin red ni base de datos.

/** Un renglón de la tabla de movimientos, transcrito tal como aparece. */
export interface ScanRow {
  /** Vacío si el renglón no repite la fecha (se toma la del renglón anterior, también entre páginas). */
  date: string;
  description: string;
  amount: string | null;
  debit: string | null;
  credit: string | null;
  type: string | null;
  balance: string | null;
  /** Algún dígito de la fecha o del monto no se leía con seguridad. */
  unclear: boolean;
}

/** Lo que devuelve la lectura con IA de una página (ya validado). */
export interface ScanPageResult {
  isStatement: boolean;
  legible: boolean;
  institution: string | null;
  accountType: ScanAccountType;
  accountLast4: string | null;
  currency: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  openingBalance: string | null;
  closingBalance: string | null;
  totalDebits: string | null;
  totalCredits: string | null;
  rows: ScanRow[];
}

/** Las páginas de un documento; `result` null = esa página no se pudo leer (falló la lectura). */
export interface ScanTranscription {
  pages: { page: number; result: ScanPageResult | null }[];
}

export interface AssembledScan {
  raw: RawRow[];
  periodStartText: string | null;
  periodEndText: string | null;
  openingBalanceText: string | null;
  closingBalanceText: string | null;
  totalDebitsText: string | null;
  totalCreditsText: string | null;
  pages: number;
  /** Páginas borrosas, cortadas o que fallaron: hay que pedir otra foto. */
  unreadablePages: number[];
  /** Páginas que no son del estado de cuenta (publicidad, condiciones): se ignoran sin avisar. */
  ignoredPages: number[];
  /** Movimientos con algún dígito dudoso: no se importan. */
  unclearRows: number;
  institution: string | null;
  accountType: ScanAccountType | null;
  last4: string | null;
  currency: string | null;
}

export const UNCLEAR_REASON = "No se leía bien en la imagen: revísalo en tu estado de cuenta y agrégalo a mano si hace falta";

const clean = (value: string | null | undefined) => (value ?? "").replace(/\s+/g, " ").trim();
const orNull = (value: string | null | undefined) => clean(value) || null;

export function assembleScan(transcription: ScanTranscription): AssembledScan {
  const pages = [...transcription.pages].sort((a, b) => a.page - b.page);
  const out: AssembledScan = {
    raw: [],
    periodStartText: null,
    periodEndText: null,
    openingBalanceText: null,
    closingBalanceText: null,
    totalDebitsText: null,
    totalCreditsText: null,
    pages: pages.length,
    unreadablePages: [],
    ignoredPages: [],
    unclearRows: 0,
    institution: null,
    accountType: null,
    last4: null,
    currency: null,
  };
  // La fecha del último renglón que la traía: los movimientos del mismo día no la repiten, ni al cambiar de página.
  let lastDate = "";

  for (const { page, result } of pages) {
    if (!result) {
      out.unreadablePages.push(page);
      continue;
    }
    if (!result.isStatement) {
      out.ignoredPages.push(page);
      continue;
    }
    if (!result.legible) out.unreadablePages.push(page);

    // El resumen suele estar en la primera página: se queda el primer valor que aparezca.
    out.periodStartText ??= orNull(result.periodStart);
    out.periodEndText ??= orNull(result.periodEnd);
    out.openingBalanceText ??= orNull(result.openingBalance);
    out.closingBalanceText ??= orNull(result.closingBalance);
    out.totalDebitsText ??= orNull(result.totalDebits);
    out.totalCreditsText ??= orNull(result.totalCredits);
    out.institution ??= orNull(result.institution);
    out.currency ??= orNull(result.currency);
    out.last4 ??= orNull(result.accountLast4);
    if (out.accountType === null && result.accountType !== "unknown") out.accountType = result.accountType;

    // Una página ilegible no aporta renglones: una cifra mal leída es peor que una que falta (se avisa y se pide otra foto).
    if (!result.legible) continue;

    result.rows.forEach((row, index) => {
      const date = clean(row.date) || lastDate;
      if (clean(row.date)) lastDate = clean(row.date);
      const raw: RawRow = {
        source: `página ${page}, renglón ${index + 1}`,
        date,
        description: clean(row.description),
        amount: orNull(row.amount),
        debit: orNull(row.debit),
        credit: orNull(row.credit),
        type: orNull(row.type),
        balance: orNull(row.balance),
      };
      if (row.unclear) {
        raw.rejected = UNCLEAR_REASON;
        out.unclearRows += 1;
      }
      out.raw.push(raw);
    });
  }
  return out;
}

/** ¿Alguna página es de un estado de cuenta? Si ninguna lo es, el documento no es lo que se esperaba. */
export function looksLikeStatement(scan: AssembledScan): boolean {
  return scan.ignoredPages.length < scan.pages;
}
