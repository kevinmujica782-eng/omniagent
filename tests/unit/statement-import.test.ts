import { PDFDict, PDFDocument, PDFName, StandardFonts, rgb } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { centsToDecimal, isMoneyToken, parseAmount } from "@/modules/finance/statement-import/amounts";
import { categorize, merchantFromDescription } from "@/modules/finance/statement-import/categorize";
import { detectDelimiter } from "@/modules/finance/statement-import/csv";
import { findDatesInText, inferDateOrder, readDateToken, resolveDate, yearResolver, type DateToken } from "@/modules/finance/statement-import/dates";
import { fingerprintRows } from "@/modules/finance/statement-import/fingerprint";
import { parseStatement } from "@/modules/finance/statement-import/parse";
import { readStatementLayout, type PdfTextItem } from "@/modules/finance/statement-import/pdf-layout";
import { buildRows, detectSignConvention } from "@/modules/finance/statement-import/rows";
import { decodeText, sniffFormat } from "@/modules/finance/statement-import/sniff";
import type { ParseOptions, ParsedStatement } from "@/modules/finance/statement-import/types";

// Importador de estados de cuenta: montos, fechas, CSV de varios bancos, PDF reales generados con pdf-lib
// (con columnas, sin encabezados, protegidos, escaneados y dañados), categorías y deduplicación.

const NOW = new Date("2024-03-10T12:00:00Z");

const utf8 = (text: string) => new TextEncoder().encode(text);
/** Windows-1252 para los caracteres de español (todos caben en un byte). */
const latin1 = (text: string) => Uint8Array.from(text, (ch) => ch.charCodeAt(0));

function csv(text: string | Uint8Array, options: ParseOptions = {}): Promise<ParsedStatement> {
  const bytes = typeof text === "string" ? utf8(text) : text;
  return parseStatement({ bytes, fileName: "estado.csv", mimeType: "text/csv" }, { now: NOW, ...options });
}

function pdfFile(bytes: Uint8Array, options: ParseOptions = {}): Promise<ParsedStatement> {
  return parseStatement({ bytes, fileName: "estado.pdf", mimeType: "application/pdf" }, { now: NOW, ...options });
}

async function errorOf(run: () => unknown): Promise<{ code: string; details?: unknown } | null> {
  try {
    await run();
  } catch (error) {
    const { code, details } = error as { code?: string; details?: unknown };
    return { code: code ?? "unknown", details };
  }
  return null;
}

const summary = (statement: ParsedStatement) =>
  statement.rows.map((row) => `${row.date} ${row.direction === "DEBIT" ? "-" : "+"}${centsToDecimal(row.amountCents)} ${row.description}`);

// ── PDF de prueba: cada renglón es [y, celdas]; una celda es [x, texto] o [x, texto, "der"] (alineada a la derecha).
type PdfCell = [number, string] | [number, string, "der"];
type PdfLine = [number, PdfCell[]];

/** `wordByWord` dibuja cada palabra por separado, como hacen algunos generadores de PDF. */
async function makePdf(pages: PdfLine[][], { size = 9, wordByWord = false } = {}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const lines of pages) {
    const page = doc.addPage([612, 792]);
    for (const [y, cells] of lines) {
      for (const [x, text, align] of cells) {
        let cursor = align === "der" ? x - font.widthOfTextAtSize(text, size) : x;
        for (const piece of wordByWord ? text.split(" ") : [text]) {
          page.drawText(piece, { x: cursor, y, size, font });
          cursor += font.widthOfTextAtSize(`${piece} `, size);
        }
      }
    }
  }
  return doc.save();
}

/**
 * Al estilo de BBVA: "FECHA" sobre "OPER  LIQ" y "SALDO" sobre "OPERACIÓN  LIQUIDACIÓN", columnas tan juntas que
 * pdf.js une "REFERENCIA" con "CARGOS" y las dos fechas, y el saldo solo en el último movimiento del día.
 */
const TWO_ROW_HEADER_STATEMENT: PdfLine[][] = [
  [
    [760, [[40, "Estado de Cuenta"], [400, "Periodo DEL 01/01/2024 AL 31/01/2024"]]],
    [720, [[40, "FECHA"], [500, "SALDO"]]],
    [710, [[30, "OPER"], [60, "LIQ"], [95, "COD."], [130, "DESCRIPCIÓN"], [300, "REFERENCIA"], [390, "CARGOS", "der"], [440, "ABONOS", "der"], [500, "OPERACIÓN", "der"], [560, "LIQUIDACIÓN", "der"]]],
    [695, [[30, "02/ENE"], [60, "02/ENE"], [95, "T17"], [130, "SPEI ENVIADO BANORTE"], [300, "0091234567"], [390, "1,500.00", "der"]]],
    [683, [[130, "RENTA ENERO"]]],
    [671, [[30, "02/ENE"], [60, "02/ENE"], [95, "A15"], [130, "STARBUCKS COFFEE PLAZA"], [390, "$89.00", "der"], [500, "18,411.00", "der"], [560, "18,411.00", "der"]]],
    [659, [[30, "Nota: la fecha de los cargos puede variar según tu zona horaria"]]],
    [647, [[30, "05/ENE"], [60, "05/ENE"], [95, "N06"], [130, "PAGO DE NOMINA"], [440, "12,000.00", "der"], [500, "30,411.00", "der"], [560, "30,411.00", "der"]]],
  ],
];

const HEADER: PdfCell[] = [[40, "FECHA"], [90, "DESCRIPCIÓN"], [290, "REFERENCIA"], [420, "CARGOS", "der"], [490, "ABONOS", "der"], [560, "SALDO", "der"]];

/** Cuenta de cheques al estilo de los bancos mexicanos: fechas sin año, dos páginas, cargos/abonos/saldo. */
const CHECKING_STATEMENT: PdfLine[][] = [
  [
    [760, [[40, "BANCO EJEMPLO, S.A."]]],
    [745, [[40, "ESTADO DE CUENTA - CUENTA DE CHEQUES"]]],
    [730, [[40, "PERIODO: DEL 01/02/2024 AL 29/02/2024"]]],
    [700, HEADER],
    [685, [[90, "SALDO ANTERIOR"], [560, "10,000.00", "der"]]],
    [670, [[40, "01/FEB"], [90, "DEPOSITO NOMINA EMPRESA SA"], [290, "REF 123456"], [490, "15,000.00", "der"], [560, "25,000.00", "der"]]],
    [655, [[40, "02/FEB"], [90, "OXXO SUC CENTRO"], [420, "45.50", "der"], [560, "24,954.50", "der"]]],
    [640, [[40, "03/FEB"], [90, "COMPRA NETFLIX.COM"], [420, "219.00", "der"], [560, "24,735.50", "der"]]],
    [628, [[90, "MEXICO CDMX"]]],
    [613, [[40, "05/FEB"], [90, "SPEI ENVIADO RENTA DEPTO"], [420, "8,500.00", "der"], [560, "16,235.50", "der"]]],
    [598, [[90, "OXXO SUC NORTE"], [420, "38.00", "der"], [560, "16,197.50", "der"]]],
    [583, [[40, "06/FEB"], [90, "TOTAL PLAY TELECOM"], [420, "599.00", "der"], [560, "15,598.50", "der"]]],
    [571, [[40, "Consulte comisiones y condiciones en www.banco-ejemplo.mx"]]],
    [540, [[270, "Página 1 de 2"]]],
  ],
  [
    [760, [[40, "BANCO EJEMPLO, S.A."]]],
    [730, HEADER],
    [715, [[40, "10/FEB"], [90, "COMISION POR MANEJO DE CUENTA"], [420, "150.00", "der"], [560, "15,448.50", "der"]]],
    [700, [[40, "12/FEB"], [90, "IVA COMISION"], [420, "24.00", "der"], [560, "15,424.50", "der"]]],
    [685, [[40, "15/FEB"], [90, "UBER *TRIP HELP.UBER.COM"], [420, "120.00", "der"], [560, "15,304.50", "der"]]],
    [670, [[40, "20/FEB"], [90, "STARBUCKS COFFEE 1234"], [420, "85.00", "der"], [560, "15,219.50", "der"]]],
    [655, [[40, "29/FEB"], [90, "DEVOLUCION AMAZON MX"], [490, "350.00", "der"], [560, "15,569.50", "der"]]],
    [640, [[90, "SALDO FINAL"], [560, "15,569.50", "der"]]],
    [625, [[90, "TOTAL DE CARGOS"], [420, "9,780.50", "der"]]],
    [600, [[40, "Este documento es una representación impresa de un CFDI."]]],
  ],
];

/** Tarjeta de crédito: una sola columna de importes, pagos en negativo y fecha de corte. */
const CARD_STATEMENT: PdfLine[][] = [
  [
    [740, [[40, "TARJETA DE CRÉDITO ORO"]]],
    [725, [[40, "Fecha de corte: 15/02/2024"]]],
    [700, [[40, "FECHA"], [110, "CONCEPTO"], [540, "IMPORTE", "der"]]],
    [685, [[40, "16/01/2024"], [110, "AMAZON MX MARKETPLACE"], [540, "1,299.00", "der"]]],
    [670, [[40, "18/01/2024"], [110, "PAYPAL *SPOTIFY P1234ABCD"], [540, "129.00", "der"]]],
    [655, [[40, "25/01/2024"], [110, "SU PAGO GRACIAS"], [540, "-5,000.00", "der"]]],
    [640, [[40, "02/02/2024"], [110, "RESTAURANTE LA CASA DE TOÑO"], [540, "640.00", "der"]]],
    [625, [[40, "15/02/2024"], [110, "INTERESES ORDINARIOS"], [540, "210.35", "der"]]],
    [610, [[40, "15/02/2024"], [110, "IVA INTERESES"], [540, "33.66", "der"]]],
    [580, [[110, "SALDO AL CORTE"], [540, "12,345.67", "der"]]],
    [565, [[110, "PAGO MÍNIMO"], [540, "617.28", "der"]]],
  ],
];

/** Sin encabezados: fecha, descripción, importe y saldo (el sentido sale del saldo). */
const NO_HEADER_STATEMENT: PdfLine[][] = [
  [
    [740, [[40, "ESTADO DE CUENTA"]]],
    [725, [[40, "Del 01/01/2024 al 31/01/2024"]]],
    [700, [[40, "Saldo anterior"], [520, "1,045.00", "der"]]],
    [685, [[40, "02/01/2024 DEPOSITO EFECTIVO"], [450, "500.00", "der"], [520, "1,545.00", "der"]]],
    [670, [[40, "03/01/2024"], [100, "FARMACIA GUADALAJARA"], [450, "120.00", "der"], [520, "1,425.00", "der"]]],
    [655, [[40, "05/01/2024"], [100, "CINEPOLIS PLAZA"], [450, "180.00", "der"], [520, "1,245.00", "der"]]],
    [640, [[40, "07/01/2024"], [100, "TRANSFERENCIA RECIBIDA"], [450, "2,000.00", "der"], [520, "3,245.00", "der"]]],
  ],
];

/** Sin encabezados, con cargos y abonos en columnas distintas. `cargosAt`/`abonosAt` = borde derecho de cada una. */
function twoColumnStatement(cargosAt: number, abonosAt: number): PdfLine[][] {
  return [
    [
      [700, [[40, "Saldo inicial"], [540, "5,000.00", "der"]]],
      [685, [[40, "02/03/2024"], [100, "PAGO TELCEL"], [cargosAt, "350.00", "der"], [540, "4,650.00", "der"]]],
      [670, [[40, "04/03/2024"], [100, "SPEI RECIBIDO CLIENTE"], [abonosAt, "1,200.00", "der"], [540, "5,850.00", "der"]]],
      [655, [[40, "05/03/2024"], [100, "OXXO"], [cargosAt, "62.00", "der"], [540, "5,788.00", "der"]]],
    ],
  ];
}

describe("montos", () => {
  it("lee formatos de distintos bancos", () => {
    expect(parseAmount("1,234.56")).toEqual({ cents: 123456, negative: false, marker: null });
    expect(parseAmount("1.234,56")).toEqual({ cents: 123456, negative: false, marker: null });
    expect(parseAmount("-45.50")).toEqual({ cents: 4550, negative: true, marker: null });
    expect(parseAmount("(45.50)")).toEqual({ cents: 4550, negative: true, marker: null });
    expect(parseAmount("45.50-")).toEqual({ cents: 4550, negative: true, marker: null });
    expect(parseAmount("$ -1,000.00")).toEqual({ cents: 100000, negative: true, marker: null });
    expect(parseAmount("-$1,000.00")).toEqual({ cents: 100000, negative: true, marker: null });
    expect(parseAmount("MXN 1,000")).toEqual({ cents: 100000, negative: false, marker: null });
    expect(parseAmount("1,200.00 CR")).toEqual({ cents: 120000, negative: false, marker: "CR" });
    expect(parseAmount("1,200.00DR")).toEqual({ cents: 120000, negative: false, marker: "DR" });
    expect(parseAmount("15.990")).toEqual({ cents: 1599000, negative: false, marker: null });
    expect(parseAmount("1.250.000")).toEqual({ cents: 125000000, negative: false, marker: null });
    expect(parseAmount("45,5")).toEqual({ cents: 4550, negative: false, marker: null });
    expect(parseAmount("1 234,56")).toEqual({ cents: 123456, negative: false, marker: null });
    expect(parseAmount("12.3456")).toEqual({ cents: 1235, negative: false, marker: null });
    expect(parseAmount("0.00")).toEqual({ cents: 0, negative: false, marker: null });
  });

  it("rechaza lo que no es un monto", () => {
    expect(parseAmount("")).toBeNull();
    expect(parseAmount("abc")).toBeNull();
    expect(parseAmount("12/01/2024")).toBeNull();
    expect(parseAmount("1,23,456")).toBeNull();
    expect(parseAmount("9999999999999.00")).toBeNull();
  });

  it("distingue importes de referencias en un PDF", () => {
    expect(isMoneyToken("1,234.56")).toBe(true);
    expect(isMoneyToken("-5,000.00")).toBe(true);
    expect(isMoneyToken("$15.990")).toBe(true);
    expect(isMoneyToken("123456")).toBe(false);
    expect(isMoneyToken("12 MSI")).toBe(false);
    expect(isMoneyToken("15/01/2024")).toBe(false);
  });

  it("convierte centavos a decimal exacto", () => {
    expect(centsToDecimal(4550)).toBe("45.50");
    expect(centsToDecimal(5)).toBe("0.05");
    expect(centsToDecimal(-123456)).toBe("-1234.56");
  });
});

describe("fechas", () => {
  it("reconoce formatos numéricos y con nombre de mes", () => {
    expect(readDateToken("2024-03-05")).toEqual({ kind: "full", y: 2024, m: 3, d: 5 });
    expect(readDateToken("2024-03-05T10:22:11Z")).toEqual({ kind: "full", y: 2024, m: 3, d: 5 });
    expect(readDateToken("05/03/2024")).toEqual({ kind: "numeric", a: 5, b: 3, y: 2024 });
    expect(readDateToken("5-3-24")).toEqual({ kind: "numeric", a: 5, b: 3, y: 2024 });
    expect(readDateToken("15/ENE")).toEqual({ kind: "named", m: 1, d: 15, y: null });
    expect(readDateToken("15-ene-24")).toEqual({ kind: "named", m: 1, d: 15, y: 2024 });
    expect(readDateToken("15 de enero de 2024")).toEqual({ kind: "named", m: 1, d: 15, y: 2024 });
    expect(readDateToken("Jan 15, 2024")).toEqual({ kind: "named", m: 1, d: 15, y: 2024 });
    expect(readDateToken("SET 3")).toEqual({ kind: "named", m: 9, d: 3, y: null });
    expect(readDateToken("OXXO")).toBeNull();
    expect(readDateToken("123456")).toBeNull();
  });

  it("decide día/mes con todo el archivo", () => {
    const tokens = (values: string[]) => values.map((v) => readDateToken(v)).filter((t): t is DateToken => t !== null);
    expect(inferDateOrder(tokens(["05/02/2024", "13/02/2024"]))).toEqual({ order: "DMY", ambiguous: false });
    expect(inferDateOrder(tokens(["01/15/2024", "02/03/2024"]))).toEqual({ order: "MDY", ambiguous: false });
    // Todos ≤ 12: en día/mes van en orden (1, 3, 7 de febrero); en mes/día saltarían de enero a julio y de vuelta.
    expect(inferDateOrder(tokens(["01/02/2024", "03/02/2024", "07/02/2024", "02/02/2024", "08/02/2024"]))).toMatchObject({ order: "DMY", ambiguous: true });
    expect(inferDateOrder(tokens(["2024-01-05"]))).toEqual({ order: "YMD", ambiguous: false });
  });

  it("completa el año de fechas sin año con el periodo", () => {
    const yearFor = yearResolver("2024-01-14");
    expect(resolveDate({ kind: "named", m: 12, d: 20, y: null }, "DMY", yearFor)).toBe("2023-12-20");
    expect(resolveDate({ kind: "named", m: 1, d: 5, y: null }, "DMY", yearFor)).toBe("2024-01-05");
    expect(resolveDate({ kind: "numeric", a: 31, b: 2, y: 2024 }, "DMY", yearFor)).toBeNull(); // 31 de febrero
    expect(resolveDate({ kind: "numeric", a: 2, b: 29, y: 2024 }, "MDY", yearFor)).toBe("2024-02-29");
  });

  it("encuentra fechas en el texto del periodo", () => {
    expect(findDatesInText("PERIODO: DEL 01/02/2024 AL 29/02/2024")).toEqual(["01/02/2024", "29/02/2024"]);
    expect(findDatesInText("Del 1 de enero al 31 de enero de 2024")).toEqual(["1 de enero", "31 de enero de 2024"]);
    expect(findDatesInText("Statement period: Jan 1, 2024 - Jan 31, 2024")).toEqual(["Jan 1, 2024", "Jan 31, 2024"]);
  });
});

describe("tipo de archivo", () => {
  it("detecta el formato por el contenido y rechaza lo que no sirve", async () => {
    expect(sniffFormat(utf8("Fecha,Monto\n"), "estado.csv", "application/vnd.ms-excel")).toBe("csv");
    expect(sniffFormat(utf8("%PDF-1.7\n..."), "estado.csv", "text/csv")).toBe("pdf");
    expect((await errorOf(() => sniffFormat(new Uint8Array(), "a.csv")))?.code).toBe("empty_file");
    expect((await errorOf(() => sniffFormat(utf8("hola"), "estado.pdf", "application/pdf")))?.code).toBe("corrupted_file");
    expect((await errorOf(() => sniffFormat(Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 1, 2]), "estado.csv")))?.code).toBe("unsupported_file_type");
    expect((await errorOf(() => sniffFormat(utf8("x"), "estado.xlsx")))?.code).toBe("unsupported_file_type");
    expect((await errorOf(() => sniffFormat(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]), "foto.png")))?.code).toBe("unsupported_file_type");
    expect((await errorOf(() => sniffFormat(utf8("OFXHEADER:100"), "estado.ofx")))?.code).toBe("unsupported_file_type");
    const binary = Uint8Array.from({ length: 400 }, (_, i) => (i * 7) % 32);
    expect((await errorOf(() => sniffFormat(binary, "estado.csv")))?.code).toBe("corrupted_file");
    expect((await errorOf(() => sniffFormat(new Uint8Array(5 * 1024 * 1024), "estado.csv")))?.code).toBe("file_too_large");
  });

  it("decodifica UTF-8 con BOM, Windows-1252 y UTF-16", () => {
    expect(decodeText(Uint8Array.from([0xef, 0xbb, 0xbf, ...utf8("Descripción")]))).toEqual({ text: "Descripción", encoding: "utf-8" });
    expect(decodeText(latin1("Descripción"))).toEqual({ text: "Descripción", encoding: "windows-1252" });
    const utf16 = Uint8Array.from([0xff, 0xfe, ...[..."Año"].flatMap((ch) => [ch.charCodeAt(0), 0])]);
    expect(decodeText(utf16)).toEqual({ text: "Año", encoding: "utf-16le" });
  });

  it("detecta el delimitador aunque haya renglones de presentación", () => {
    expect(detectDelimiter("Banco Ejemplo\nCuenta 1234\nFecha;Concepto;Cargo\n01-03-2024;Compra;1.234,56\n02-03-2024;Pago;450,00\n")).toBe(";");
    expect(detectDelimiter('Fecha,Descripcion,Monto\n01/02/2024,"OXXO, SUC 1","-1,234.50"\n')).toBe(",");
    expect(detectDelimiter("Date\tDescription\tAmount\n01/02/2024\tOXXO\t-5.00\n")).toBe("\t");
  });
});

describe("CSV", () => {
  it("lee un CSV en español con renglones de presentación y montos con signo", async () => {
    const statement = await csv(
      "﻿Banco Ejemplo,,\nCuenta: ****1234,,\nFecha,Descripción,Monto\n" +
        "05/02/2024,OXXO SUC CENTRO,-45.50\n06/02/2024,DEPOSITO NOMINA,\"15,000.00\"\n07/02/2024,NETFLIX.COM,-219.00\n" +
        "13/02/2024,STARBUCKS COFFEE,-85.00\nTotal,,\"14,650.50\"\n",
    );
    expect(summary(statement)).toEqual([
      "2024-02-05 -45.50 OXXO SUC CENTRO",
      "2024-02-06 +15000.00 DEPOSITO NOMINA",
      "2024-02-07 -219.00 NETFLIX.COM",
      "2024-02-13 -85.00 STARBUCKS COFFEE",
    ]);
    expect(statement.skipped).toEqual([]);
    expect(statement.detected).toMatchObject({
      dateOrder: "DMY",
      dateOrderAmbiguous: false,
      signConvention: "negative_is_debit",
      columns: { date: "Fecha", description: "Descripción", amount: "Monto" },
      delimiter: ",",
      encoding: "utf-8",
    });
    expect(statement.periodStart).toBe("2024-02-05");
    expect(statement.periodEnd).toBe("2024-02-13");
  });

  it("lee Windows-1252, punto y coma, coma decimal y columnas de cargo y abono", async () => {
    const statement = await csv(
      latin1("Fecha;Concepto;Cargo;Abono;Saldo\n01-03-2024;Compra Soriana;1.234,56;;8.765,44\n02-03-2024;Abono nómina;;20.000,00;28.765,44\n03-03-2024;Pago CFE;450,00;;28.315,44\n"),
    );
    expect(summary(statement)).toEqual(["2024-03-01 -1234.56 Compra Soriana", "2024-03-02 +20000.00 Abono nómina", "2024-03-03 -450.00 Pago CFE"]);
    expect(statement.detected).toMatchObject({ encoding: "windows-1252", delimiter: ";", signConvention: null });
    expect(statement.closingBalanceCents).toBe(2831544);
  });

  it("lee un CSV estadounidense de tarjeta (mes/día, columna Type con Payment)", async () => {
    const text =
      "Transaction Date,Post Date,Description,Category,Type,Amount,Memo\n" +
      "01/15/2024,01/16/2024,STARBUCKS STORE 1234,Food & Drink,Sale,-5.75,\n" +
      "01/17/2024,01/17/2024,AMAZON MKTPL*2K3L45,Shopping,Sale,-45.99,\n" +
      "01/20/2024,01/20/2024,Payment Thank You-Mobile,,Payment,500.00,\n" +
      "01/22/2024,01/23/2024,UBER   *TRIP,Travel,Sale,-23.10,\n";
    // Aunque la cuenta se registre como de débito, el pago de la tarjeta entra (manda el signo, no "Payment").
    for (const accountKind of ["liability", "asset"] as const) {
      const statement = await csv(text, { accountKind });
      expect(summary(statement)).toEqual([
        "2024-01-15 -5.75 STARBUCKS STORE 1234",
        "2024-01-17 -45.99 AMAZON MKTPL*2K3L45",
        "2024-01-20 +500.00 Payment Thank You-Mobile",
        "2024-01-22 -23.10 UBER *TRIP",
      ]);
      expect(statement.detected).toMatchObject({ dateOrder: "MDY", columns: { date: "Transaction Date", description: "Description", type: "Type", amount: "Amount" } });
    }
  });

  it("deduce la convención de signo de una tarjeta con cargos positivos", async () => {
    const statement = await csv(
      "Date,Description,Amount\n01/05/2024,NETFLIX.COM,15.49\n01/09/2024,WHOLE FOODS MARKET,82.30\n01/14/2024,AUTOPAY PAYMENT - THANK YOU,-500.00\n01/19/2024,SHELL OIL 1234,40.00\n",
      { accountKind: "liability" },
    );
    expect(statement.detected.signConvention).toBe("positive_is_debit");
    expect(statement.rows.map((row) => row.direction)).toEqual(["DEBIT", "DEBIT", "CREDIT", "DEBIT"]);
    // Y se puede corregir a mano desde la vista previa.
    const flipped = await csv(
      "Date,Description,Amount\n01/05/2024,NETFLIX.COM,15.49\n01/14/2024,AUTOPAY PAYMENT - THANK YOU,-500.00\n",
      { signConvention: "negative_is_debit" },
    );
    expect(flipped.rows.map((row) => row.direction)).toEqual(["CREDIT", "DEBIT"]);
  });

  it("usa el saldo para el sentido de montos sin signo, aunque el archivo venga del más nuevo al más viejo", async () => {
    const statement = await csv(
      "Fecha,Descripcion,Importe,Saldo\n20/02/2024,RETIRO CAJERO,500.00,4500.00\n18/02/2024,DEPOSITO,1000.00,5000.00\n" +
        "15/02/2024,FARMACIA SAN PABLO,250.00,4000.00\n12/02/2024,CINEMEX,300.00,4250.00\n",
    );
    expect(summary(statement)).toEqual([
      "2024-02-12 -300.00 CINEMEX",
      "2024-02-15 -250.00 FARMACIA SAN PABLO",
      "2024-02-18 +1000.00 DEPOSITO",
      "2024-02-20 -500.00 RETIRO CAJERO",
    ]);
    expect(statement.closingBalanceCents).toBe(450000);
    // El primero no tiene saldo anterior con qué comparar: se toma como gasto y se avisa.
    expect(statement.warnings).toContain("Un movimiento no indicaba si era cargo o abono: lo tomé como gasto.");
  });

  it("con fechas ambiguas, respeta el orden elegido y sigue ofreciendo el cambio", async () => {
    // Las dos lecturas dejan los movimientos en orden: 1, 2 y 3 de febrero, o 2 de enero, febrero y marzo.
    const text = "Fecha,Descripcion,Monto\n01/02/2024,OXXO,-45.50\n02/02/2024,NOMINA,9000.00\n03/02/2024,SPOTIFY,-129.00\n";
    const guessed = await csv(text);
    expect(guessed.detected).toMatchObject({ dateOrder: "DMY", dateOrderAmbiguous: true });
    expect(guessed.rows.map((row) => row.date)).toEqual(["2024-02-01", "2024-02-02", "2024-02-03"]);
    expect(guessed.warnings[0]).toMatch(/día\/mes o mes\/día/);
    const chosen = await csv(text, { dateOrder: "MDY" });
    expect(chosen.rows.map((row) => row.date)).toEqual(["2024-01-02", "2024-02-02", "2024-03-02"]);
    expect(chosen.detected).toMatchObject({ dateOrder: "MDY", dateOrderAmbiguous: true });
    expect(chosen.warnings).toEqual([]);
  });

  it("lee un CSV sin encabezados por su contenido", async () => {
    const statement = await csv("05/02/2024,OXXO,-45.50\n06/02/2024,NOMINA,15000.00\n07/02/2024,SPOTIFY,-129.00\n");
    expect(summary(statement)).toEqual(["2024-02-05 -45.50 OXXO", "2024-02-06 +15000.00 NOMINA", "2024-02-07 -129.00 SPOTIFY"]);
  });

  it("toma como títulos la fila antes de la primera fecha si no reconoce los encabezados", async () => {
    const statement = await csv("F. Oper,Movimiento Detalle,Pesos\n05/02/2024,OXXO,-45.50\n06/02/2024,NOMINA,15000.00\n");
    expect(statement.rows).toHaveLength(2);
    expect(statement.skipped).toEqual([]);
  });

  it("respeta las columnas elegidas por nombre o por posición", async () => {
    const text = "Fecha,Fecha valor,Concepto,Referencia,Importe\n01/03/2024,02/03/2024,OXXO,111,-45.00\n";
    const byName = await csv(text, { mapping: { date: "Fecha valor", description: "Referencia" } });
    expect(summary(byName)).toEqual(["2024-03-02 -45.00 111"]);
    const byIndex = await csv("A,B,C\n01/03/2024,OXXO,-45.00\n", { mapping: { date: 0, description: 1, amount: 2 } });
    expect(summary(byIndex)).toEqual(["2024-03-01 -45.00 OXXO"]);
    expect(byIndex.skipped).toEqual([]);
  });

  it("explica las columnas que faltan para que el usuario las elija", async () => {
    const missing = await errorOf(() => csv("Concepto,Monto\nOXXO,-45.00\n"));
    expect(missing).toMatchObject({ code: "columns_not_found", details: { headers: ["Concepto", "Monto"] } });
    const wrong = await errorOf(() => csv("Fecha,Concepto,Monto\n01/03/2024,OXXO,-45.00\n", { mapping: { date: "Fecha de corte" } }));
    expect(wrong).toMatchObject({ code: "invalid_mapping" });
    const outOfRange = await errorOf(() => csv("Fecha,Concepto,Monto\n01/03/2024,OXXO,-45.00\n", { mapping: { amount: 9 } }));
    expect(outOfRange).toMatchObject({ code: "invalid_mapping" });
  });

  it("omite filas inválidas y dice por qué", async () => {
    const statement = await csv(
      "Fecha,Descripcion,Monto\n01/03/2024,OXXO,-45.00\n31/02/2024,FECHA IMPOSIBLE,-10.00\n02/03/2024,MONTO RARO,abc\n" +
        "15/04/2024,EN EL FUTURO,-5.00\n03/03/2024,SIN MONTO,\nayer,SIN FECHA,-1.00\n04/03/2024,\"COMPRA \"\"ESPECIAL\"\", SUC 1\",\"-1,234.50\"\n",
    );
    expect(summary(statement)).toEqual(["2024-03-01 -45.00 OXXO", '2024-03-04 -1234.50 COMPRA "ESPECIAL", SUC 1']);
    expect(statement.skipped.map((s) => `${s.source}: ${s.reason}`)).toEqual([
      "fila 3: Fecha inválida: «31/02/2024»",
      "fila 4: Monto no reconocido: «abc»",
      "fila 5: Fecha en el futuro: 2024-04-15",
      "fila 6: Sin monto",
      "fila 7: Fecha no reconocida: «ayer»",
    ]);
  });

  it("ignora encabezados repetidos y ordena un archivo que va del más nuevo al más viejo", async () => {
    const statement = await csv("Fecha,Concepto,Importe\n20/02/2024,OXXO,-50.00\n18/02/2024,NOMINA,9000.00\nFecha,Concepto,Importe\n15/02/2024,CFE,-450.00\n");
    expect(summary(statement)).toEqual(["2024-02-15 -450.00 CFE", "2024-02-18 +9000.00 NOMINA", "2024-02-20 -50.00 OXXO"]);
    expect(statement.skipped).toEqual([]);
  });

  it("procesa el máximo de filas en poco tiempo y rechaza lo que lo excede", async () => {
    const lines = (count: number) =>
      ["Fecha,Descripcion,Monto", ...Array.from({ length: count }, (_, i) => `${String((i % 28) + 1).padStart(2, "0")}/02/2024,COMPRA ${i % 37},-${(i % 500) + 1}.25`)].join("\n");
    const started = Date.now();
    expect((await csv(lines(5_000))).rows).toHaveLength(5_000);
    expect(Date.now() - started).toBeLessThan(5_000);
    expect((await errorOf(() => csv(lines(5_001))))?.code).toBe("too_many_rows");
  });

  it("rechaza archivos sin movimientos", async () => {
    const empty = await errorOf(() => csv("Fecha,Descripcion,Monto\nayer,OXXO,-45.00\n"));
    expect(empty?.code).toBe("no_transactions_found");
  });

  it("lee CSV de Excel en UTF-16 separado por tabuladores", async () => {
    const text = "Fecha\tDescripción\tMonto\r\n05/02/2024\tOXXO\t-45.50\r\n";
    const bytes = Uint8Array.from([0xff, 0xfe, ...[...text].flatMap((ch) => [ch.charCodeAt(0) & 0xff, ch.charCodeAt(0) >> 8])]);
    const statement = await csv(bytes);
    expect(summary(statement)).toEqual(["2024-02-05 -45.50 OXXO"]);
    expect(statement.detected).toMatchObject({ encoding: "utf-16le", delimiter: "\t" });
  });
});

describe("PDF", () => {
  it("lee un estado de cuenta de cheques con columnas, dos páginas y fechas sin año", async () => {
    const statement = await pdfFile(await makePdf(CHECKING_STATEMENT));
    expect(summary(statement)).toEqual([
      "2024-02-01 +15000.00 DEPOSITO NOMINA EMPRESA SA",
      "2024-02-02 -45.50 OXXO SUC CENTRO",
      "2024-02-03 -219.00 COMPRA NETFLIX.COM MEXICO CDMX",
      "2024-02-05 -8500.00 SPEI ENVIADO RENTA DEPTO",
      "2024-02-05 -38.00 OXXO SUC NORTE",
      "2024-02-06 -599.00 TOTAL PLAY TELECOM",
      "2024-02-10 -150.00 COMISION POR MANEJO DE CUENTA",
      "2024-02-12 -24.00 IVA COMISION",
      "2024-02-15 -120.00 UBER *TRIP HELP.UBER.COM",
      "2024-02-20 -85.00 STARBUCKS COFFEE 1234",
      "2024-02-29 +350.00 DEVOLUCION AMAZON MX",
    ]);
    expect(statement.periodStart).toBe("2024-02-01");
    expect(statement.periodEnd).toBe("2024-02-29");
    expect(statement.closingBalanceCents).toBe(1556950);
    expect(statement.rows.map((row) => row.balanceCents)).toEqual([2500000, 2495450, 2473550, 1623550, 1619750, 1559850, 1544850, 1542450, 1530450, 1521950, 1556950]);
    expect(statement.detected).toMatchObject({ pages: 2, dateOrder: "DMY", signConvention: null });
    expect(statement.warnings).toEqual([]);
  });

  it("lee títulos en dos renglones, columnas pegadas y fechas dobles (formato BBVA)", async () => {
    const statement = await pdfFile(await makePdf(TWO_ROW_HEADER_STATEMENT, { size: 8 }));
    expect(summary(statement)).toEqual([
      "2024-01-02 -1500.00 SPEI ENVIADO BANORTE RENTA ENERO",
      "2024-01-02 -89.00 STARBUCKS COFFEE PLAZA",
      "2024-01-05 +12000.00 PAGO DE NOMINA",
    ]);
    expect(statement.rows.map((row) => row.balanceCents)).toEqual([null, 1841100, 3041100]);
    expect(statement.closingBalanceCents).toBe(3041100);
  });

  it("lee PDF dibujados palabra por palabra y con símbolo de moneda", async () => {
    const pages: PdfLine[][] = [
      [
        [700, [[40, "Fecha"], [100, "Descripción del movimiento"], [420, "Retiros", "der"], [500, "Depósitos", "der"], [570, "Saldo", "der"]]],
        [685, [[40, "03/01/2024"], [100, "COMPRA EN LIVERPOOL INSURGENTES"], [420, "$2,499.00", "der"], [570, "$7,501.00", "der"]]],
        [670, [[40, "04/01/2024"], [100, "DEPOSITO EN EFECTIVO SUCURSAL"], [500, "$1,000.00", "der"], [570, "$8,501.00", "der"]]],
      ],
    ];
    const statement = await pdfFile(await makePdf(pages, { wordByWord: true }));
    expect(summary(statement)).toEqual(["2024-01-03 -2499.00 COMPRA EN LIVERPOOL INSURGENTES", "2024-01-04 +1000.00 DEPOSITO EN EFECTIVO SUCURSAL"]);
  });

  it("lee una tarjeta de crédito con pagos en negativo", async () => {
    const statement = await pdfFile(await makePdf(CARD_STATEMENT), { accountKind: "liability" });
    expect(summary(statement)).toEqual([
      "2024-01-16 -1299.00 AMAZON MX MARKETPLACE",
      "2024-01-18 -129.00 PAYPAL *SPOTIFY P1234ABCD",
      "2024-01-25 +5000.00 SU PAGO GRACIAS",
      "2024-02-02 -640.00 RESTAURANTE LA CASA DE TOÑO",
      "2024-02-15 -210.35 INTERESES ORDINARIOS",
      "2024-02-15 -33.66 IVA INTERESES",
    ]);
    expect(statement.detected.signConvention).toBe("positive_is_debit");
    expect(statement.closingBalanceCents).toBe(1234567);
    expect(statement.periodEnd).toBe("2024-02-15");
    expect(statement.periodStart).toBe("2024-01-16");
  });

  it("sin encabezados, deduce cargos y abonos con el saldo", async () => {
    const statement = await pdfFile(await makePdf(NO_HEADER_STATEMENT));
    expect(summary(statement)).toEqual([
      "2024-01-02 +500.00 DEPOSITO EFECTIVO",
      "2024-01-03 -120.00 FARMACIA GUADALAJARA",
      "2024-01-05 -180.00 CINEPOLIS PLAZA",
      "2024-01-07 +2000.00 TRANSFERENCIA RECIBIDA",
    ]);
    expect(statement.periodStart).toBe("2024-01-01");
    expect(statement.periodEnd).toBe("2024-01-31");
    expect(statement.warnings).toEqual([]);
  });

  it("sin encabezados, separa columnas de cargos y abonos y las verifica con el saldo", async () => {
    const expected = ["2024-03-02 -350.00 PAGO TELCEL", "2024-03-04 +1200.00 SPEI RECIBIDO CLIENTE", "2024-03-05 -62.00 OXXO"];
    expect(summary(await pdfFile(await makePdf(twoColumnStatement(400, 470))))).toEqual(expected);
    // Abonos a la izquierda y cargos a la derecha: los saldos obligan a invertirlas.
    expect(summary(await pdfFile(await makePdf(twoColumnStatement(470, 400))))).toEqual(expected);
  });

  it("pide la contraseña de un PDF protegido y lo abre con ella", async () => {
    const bytes = Uint8Array.from(Buffer.from(PROTECTED_PDF_BASE64, "base64"));
    expect((await errorOf(() => pdfFile(bytes)))?.code).toBe("pdf_password_required");
    expect((await errorOf(() => pdfFile(bytes, { password: "0000" })))?.code).toBe("pdf_password_incorrect");
    const statement = await pdfFile(bytes, { password: "1234" });
    expect(summary(statement)).toEqual(["2024-02-02 -45.50 OXXO SUC CENTRO", "2024-02-03 +9000.00 DEPOSITO NOMINA"]);
  });

  it("reconoce un PDF escaneado, uno dañado y uno demasiado largo", async () => {
    const scanned = await PDFDocument.create();
    scanned.addPage([612, 792]).drawRectangle({ x: 40, y: 40, width: 500, height: 700, color: rgb(0.9, 0.9, 0.9) });
    expect((await errorOf(async () => pdfFile(await scanned.save())))?.code).toBe("scanned_pdf");

    const valid = await makePdf(CARD_STATEMENT);
    expect((await errorOf(() => pdfFile(valid.slice(0, 400))))?.code).toBe("corrupted_file");
    expect((await errorOf(() => pdfFile(utf8("%PDF-1.7\nesto no es un PDF de verdad\n%%EOF"))))?.code).toBe("corrupted_file");

    const long = await PDFDocument.create();
    for (let i = 0; i < 61; i++) long.addPage([612, 792]);
    expect((await errorOf(async () => pdfFile(await long.save())))?.code).toBe("too_many_pages");
  });

  it("corta a tiempo un PDF pequeño que se expande a cientos de miles de trozos de texto", async () => {
    // 12 KB comprimidos, 250 000 renglones al leerlo. Antes de cancelar bien el flujo de pdf.js, esto colgaba
    // la solicitud: doc.destroy() esperaba para siempre a la tarea que seguía viva.
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.addPage([612, 792]);
    page.drawText("x", { x: 10, y: 10, size: 1, font });
    const fontKey = page.node.Resources()?.lookup(PDFName.of("Font"), PDFDict).keys()[0]?.asString();
    const ops = ["BT", `${fontKey} 1 Tf`, "0 790 Td"];
    for (let i = 0; i < 250_000; i++) ops.push("(a) Tj", "0 -0.003 Td");
    ops.push("ET");
    page.node.addContentStream(doc.context.register(doc.context.flateStream(ops.join("\n"))));
    expect((await errorOf(async () => pdfFile(await doc.save())))?.code).toBe("too_many_rows");
  }, 30_000);

  it("dice que no encontró movimientos en un PDF con texto pero sin tabla", async () => {
    const letter = await makePdf([[[700, [[40, "Estimado cliente: le informamos que su tarjeta fue enviada a su domicilio."]]]]]);
    expect((await errorOf(() => pdfFile(letter)))?.code).toBe("no_transactions_found");
  });
});

describe("comercio y categoría", () => {
  it("usa la taxonomía de OmniAgent y nombres canónicos", () => {
    expect(categorize("OXXO SUC CENTRO", "DEBIT")).toEqual({ merchantName: "OXXO", category: "Café y antojos", subcategory: null });
    expect(categorize("OXXO GAS SUC 123", "DEBIT")).toEqual({ merchantName: "OXXO Gas", category: "Transporte", subcategory: null });
    expect(categorize("COMPRA NETFLIX.COM MEXICO CDMX", "DEBIT")).toEqual({ merchantName: "Netflix", category: "Entretenimiento", subcategory: "video" });
    expect(categorize("PAYPAL *SPOTIFY P1234ABCD", "DEBIT")).toEqual({ merchantName: "Spotify", category: "Entretenimiento", subcategory: "musica" });
    expect(categorize("UBER *TRIP HELP.UBER.COM", "DEBIT")).toMatchObject({ merchantName: "Uber", category: "Transporte" });
    expect(categorize("UBER *EATS PENDING", "DEBIT")).toMatchObject({ merchantName: "Uber Eats", category: "Restaurantes" });
    expect(categorize("DEPOSITO NOMINA EMPRESA SA", "CREDIT")).toMatchObject({ category: "Ingresos" });
    expect(categorize("SPEI RECIBIDO CLIENTE", "CREDIT")).toMatchObject({ category: "Ingresos" });
    expect(categorize("SPEI ENVIADO JUAN PEREZ", "DEBIT")).toMatchObject({ category: "Transferencias" });
    expect(categorize("SPEI ENVIADO RENTA DEPTO", "DEBIT")).toMatchObject({ category: "Vivienda" });
    expect(categorize("SU PAGO GRACIAS", "CREDIT")).toMatchObject({ category: "Transferencias" });
    expect(categorize("RETIRO CAJERO ATM 1234", "DEBIT")).toMatchObject({ merchantName: "Retiro de efectivo", category: "Transferencias" });
    expect(categorize("COMISION POR MANEJO DE CUENTA", "DEBIT")).toMatchObject({ category: "Comisiones e intereses" });
    expect(categorize("INTERESES ORDINARIOS", "DEBIT")).toMatchObject({ category: "Comisiones e intereses" });
    expect(categorize("TOTAL PLAY TELECOM", "DEBIT")).toMatchObject({ category: "Servicios" });
    expect(categorize("SMART FIT POLANCO", "DEBIT")).toMatchObject({ category: "Cuidado personal", subcategory: "gimnasio" });
    expect(categorize("DEVOLUCION AMAZON MX", "CREDIT")).toMatchObject({ merchantName: "Amazon", category: "Compras" });
    expect(categorize("TIENDITA DOÑA LUPE", "DEBIT")).toMatchObject({ category: "Otros" });
  });

  it("limpia la descripción del banco para nombrar al comercio", () => {
    expect(merchantFromDescription("COMPRA POS 1234 TACOS EL GUERO SUC CENTRO")).toBe("Tacos el Guero");
    expect(merchantFromDescription("TST* LA PARROQUIA DE VERACRUZ")).toBe("La Parroquia de Veracruz");
    expect(merchantFromDescription("FERRETERIA LOPEZ SA DE CV")).toBe("Ferreteria Lopez");
    expect(merchantFromDescription("CARGO DOMICILIACION GIMNASIO ATLAS REF 99812")).toBe("Gimnasio Atlas");
    expect(merchantFromDescription("BBVA COMISION 01/02/2024")).toBe("BBVA Comision");
    expect(merchantFromDescription("SPEI ENVIADO JUAN PEREZ REF 0099")).toBe("Juan Perez");
    expect(merchantFromDescription("DEPOSITO NOMINA EMPRESA SA")).toBe("Nomina Empresa");
    expect(merchantFromDescription("IVA COMISION")).toBe("IVA Comision");
    expect(merchantFromDescription("12345")).toBe("12345");
  });
});

describe("dirección y deduplicación", () => {
  it("vota la convención de signo con palabras clave antes que con la mayoría", () => {
    // Más abonos que cargos, pero las palabras clave dicen que los negativos son cargos.
    const rows = [
      { negative: false, description: "DEPOSITO NOMINA" },
      { negative: false, description: "DEPOSITO CLIENTE" },
      { negative: false, description: "ABONO TRANSFERENCIA" },
      { negative: true, description: "COMPRA OXXO" },
    ];
    expect(detectSignConvention(rows, "asset")).toEqual({ convention: "negative_is_debit", guessed: false });
  });

  it("en débito, negativo = gasto aunque haya más depósitos; en tarjetas sin pistas, avisa", () => {
    const savings = [
      { negative: false, description: "TRASPASO DESDE CTA 1234" },
      { negative: false, description: "TRASPASO DESDE CTA 1234" },
      { negative: true, description: "TRASPASO A CTA 5678" },
    ];
    expect(detectSignConvention(savings, "asset")).toEqual({ convention: "negative_is_debit", guessed: false });
    expect(detectSignConvention(savings, "liability")).toEqual({ convention: "positive_is_debit", guessed: true });
  });

  it("toma columnas de cargo/abono por encima de todo y anula filas que se compensan", () => {
    const built = buildRows({
      raw: [
        { source: "fila 2", date: "01/03/2024", description: "AJUSTE", debit: "10.00", credit: "10.00" },
        { source: "fila 3", date: "02/03/2024", description: "COMPRA", debit: "-25.00", credit: "" },
      ],
      kind: "asset",
      dateOrder: "DMY",
      now: NOW,
    });
    expect(built.rows.map((row) => `${row.direction} ${row.amountCents}`)).toEqual(["DEBIT 2500"]);
    expect(built.skipped.map((s) => s.reason)).toEqual(["Cargo y abono se anulan"]);
  });

  it("genera identificadores estables que distinguen movimientos idénticos", () => {
    const row = { date: "2024-03-01", description: "OXXO", amountCents: 4500, direction: "DEBIT" as const, balanceCents: null, source: "fila 2" };
    const first = fingerprintRows([row, row, { ...row, description: "oxxo" }]);
    const again = fingerprintRows([row, row]);
    expect(first[0]).toBe(again[0]);
    expect(first[1]).toBe(again[1]);
    expect(first[0]).not.toBe(first[1]);
    // Mayúsculas y signos no cambian el movimiento: es el tercer OXXO idéntico del día.
    expect(new Set(first).size).toBe(3);
    expect(first[0]).toMatch(/^stmt_[\w-]{32}$/);
  });
});

// Casos que encontró la revisión independiente: cada uno importaba números equivocados o perdía filas sin avisar.
describe("casos reales (regresiones)", () => {
  it("PDF de tarjeta: los totales debajo de la tabla no son movimientos", async () => {
    const statement = await pdfFile(
      await makePdf([
        [
          [725, [[40, "Fecha de corte: 15/02/2024"]]],
          [700, [[40, "FECHA"], [110, "CONCEPTO"], [540, "IMPORTE", "der"]]],
          [685, [[40, "16/01/2024"], [110, "AMAZON MX MARKETPLACE"], [540, "1,299.00", "der"]]],
          [670, [[40, "25/01/2024"], [110, "SU PAGO GRACIAS"], [540, "-5,000.00", "der"]]],
          [655, [[40, "02/02/2024"], [110, "RESTAURANTE LA CASA"], [540, "640.00", "der"]]],
          [640, [[40, "15/02/2024"], [110, "INTERESES ORDINARIOS"], [540, "210.35", "der"]]],
          [625, [[110, "TOTAL DE INTERESES DEL PERIODO"], [540, "210.35", "der"]]],
          [610, [[110, "PAGO MÍNIMO A CUBRIR"], [540, "617.28", "der"]]],
          [595, [[110, "SALDO DEUDOR TOTAL"], [540, "12,345.67", "der"]]],
          [580, [[110, "TOTAL CARGOS DEL PERIODO"], [540, "9,999.99", "der"]]],
        ],
      ]),
      { accountKind: "liability" },
    );
    expect(summary(statement)).toEqual([
      "2024-01-16 -1299.00 AMAZON MX MARKETPLACE",
      "2024-01-25 +5000.00 SU PAGO GRACIAS",
      "2024-02-02 -640.00 RESTAURANTE LA CASA",
      "2024-02-15 -210.35 INTERESES ORDINARIOS",
    ]);
    // Los dudosos quedan a la vista entre las omitidas; el saldo deudor es el saldo al corte.
    expect(statement.skipped.map((row) => row.reason)).toEqual(Array(3).fill("Renglón del resumen del estado de cuenta: no es un movimiento"));
    expect(statement.closingBalanceCents).toBe(1234567);
  });

  it("PDF con «Opening/Closing Date» que cruza el año", async () => {
    const statement = await pdfFile(
      await makePdf([
        [
          [745, [[40, "Opening/Closing Date"], [200, "12/15/23 - 01/14/24"]]],
          [700, [[40, "Date"], [100, "Description"], [540, "Amount", "der"]]],
          [685, [[40, "12/18"], [100, "AMAZON.COM*AB12CD"], [540, "45.99", "der"]]],
          [670, [[40, "12/27"], [100, "SHELL OIL 57444"], [540, "38.20", "der"]]],
          [655, [[40, "01/05"], [100, "AUTOMATIC PAYMENT - THANK YOU"], [540, "-500.00", "der"]]],
          [640, [[40, "01/09"], [100, "NETFLIX.COM"], [540, "15.49", "der"]]],
        ],
      ]),
      { accountKind: "liability", now: new Date("2024-02-01T12:00:00Z") },
    );
    expect(summary(statement)).toEqual([
      "2023-12-18 -45.99 AMAZON.COM*AB12CD",
      "2023-12-27 -38.20 SHELL OIL 57444",
      "2024-01-05 +500.00 AUTOMATIC PAYMENT - THANK YOU",
      "2024-01-09 -15.49 NETFLIX.COM",
    ]);
    expect([statement.periodStart, statement.periodEnd]).toEqual(["2023-12-15", "2024-01-14"]);
  });

  it("PDF en pesos chilenos: montos sin centavos, también menores a mil", async () => {
    const withHeader = await pdfFile(
      await makePdf([
        [
          [700, [[40, "FECHA"], [100, "DESCRIPCIÓN"], [420, "CARGOS", "der"], [490, "ABONOS", "der"], [560, "SALDO", "der"]]],
          [685, [[40, "15/02/2024"], [100, "METRO RED"], [420, "$790", "der"], [560, "$99.210", "der"]]],
          [670, [[40, "16/02/2024"], [100, "COMPRA LIDER"], [420, "$15.990", "der"], [560, "$83.220", "der"]]],
          [655, [[40, "17/02/2024"], [100, "CAFE"], [420, "950", "der"], [560, "$82.270", "der"]]],
          [640, [[40, "20/02/2024"], [100, "TRANSFERENCIA RECIBIDA"], [490, "$500", "der"], [560, "$82.770", "der"]]],
        ],
      ]),
    );
    expect(summary(withHeader)).toEqual([
      "2024-02-15 -790.00 METRO RED",
      "2024-02-16 -15990.00 COMPRA LIDER",
      "2024-02-17 -950.00 CAFE",
      "2024-02-20 +500.00 TRANSFERENCIA RECIBIDA",
    ]);
    expect(withHeader.closingBalanceCents).toBe(8277000);

    // Sin encabezados: el saldo nunca se toma como monto.
    const headerless = await pdfFile(
      await makePdf([
        [
          [685, [[40, "15/02/2024"], [100, "METRO RED"], [420, "$790", "der"], [560, "$99.210", "der"]]],
          [670, [[40, "16/02/2024"], [100, "COMPRA LIDER"], [420, "$15.990", "der"], [560, "$83.220", "der"]]],
          [655, [[40, "17/02/2024"], [100, "CAFE"], [420, "$950", "der"], [560, "$82.270", "der"]]],
          [640, [[40, "18/02/2024"], [100, "COMPRA JUMBO"], [420, "$12.300", "der"], [560, "$69.970", "der"]]],
        ],
      ]),
    );
    expect(summary(headerless)).toEqual([
      "2024-02-15 -790.00 METRO RED",
      "2024-02-16 -15990.00 COMPRA LIDER",
      "2024-02-17 -950.00 CAFE",
      "2024-02-18 -12300.00 COMPRA JUMBO",
    ]);
  });

  it("PDF sin encabezados con el saldo solo al cierre del día: deduce cargos y abonos por grupo", async () => {
    const statement = await pdfFile(
      await makePdf([
        [
          [725, [[40, "Periodo del 01/02/2024 al 29/02/2024"]]],
          [700, [[40, "Saldo anterior"], [540, "10,000.00", "der"]]],
          [685, [[40, "05/02/2024"], [100, "OXXO SUC CENTRO"], [450, "45.50", "der"]]],
          [670, [[40, "05/02/2024"], [100, "STARBUCKS"], [450, "89.00", "der"]]],
          [655, [[40, "05/02/2024"], [100, "NETFLIX.COM"], [450, "219.00", "der"], [540, "9,646.50", "der"]]],
          [640, [[40, "07/02/2024"], [100, "UBER TRIP"], [450, "120.00", "der"]]],
          [625, [[40, "07/02/2024"], [100, "PAGO CLIENTE ACME"], [450, "2,000.00", "der"], [540, "11,526.50", "der"]]],
        ],
      ]),
    );
    expect(summary(statement)).toEqual([
      "2024-02-05 -45.50 OXXO SUC CENTRO",
      "2024-02-05 -89.00 STARBUCKS",
      "2024-02-05 -219.00 NETFLIX.COM",
      "2024-02-07 -120.00 UBER TRIP",
      "2024-02-07 +2000.00 PAGO CLIENTE ACME",
    ]);
    expect(statement.warnings).toEqual([]);
    expect(statement.closingBalanceCents).toBe(1152650);
  });

  it("PDF: los movimientos sin fecha al inicio de la página siguiente siguen siendo del mismo día", async () => {
    const header: PdfCell[] = [[40, "FECHA"], [90, "DESCRIPCIÓN"], [420, "CARGOS", "der"], [490, "ABONOS", "der"], [560, "SALDO", "der"]];
    const statement = await pdfFile(
      await makePdf([
        [
          [730, [[40, "PERIODO: DEL 01/02/2024 AL 29/02/2024"]]],
          [700, header],
          [685, [[40, "05/FEB"], [90, "OXXO SUC CENTRO"], [420, "45.50", "der"], [560, "9,954.50", "der"]]],
          [670, [[90, "STARBUCKS COFFEE"], [420, "89.00", "der"], [560, "9,865.50", "der"]]],
          [540, [[270, "Página 1 de 2"]]],
        ],
        [
          [730, header],
          [715, [[90, "NETFLIX.COM"], [420, "219.00", "der"], [560, "9,646.50", "der"]]],
          [700, [[90, "UBER TRIP"], [420, "120.00", "der"], [560, "9,526.50", "der"]]],
          [685, [[40, "07/FEB"], [90, "SPEI RECIBIDO"], [490, "2,000.00", "der"], [560, "11,526.50", "der"]]],
        ],
      ]),
    );
    expect(summary(statement)).toEqual([
      "2024-02-05 -45.50 OXXO SUC CENTRO",
      "2024-02-05 -89.00 STARBUCKS COFFEE",
      "2024-02-05 -219.00 NETFLIX.COM",
      "2024-02-05 -120.00 UBER TRIP",
      "2024-02-07 +2000.00 SPEI RECIBIDO",
    ]);
  });

  it("PDF con fechas año/mes/día", async () => {
    const statement = await pdfFile(
      await makePdf([
        [
          [700, [[40, "FECHA"], [110, "CONCEPTO"], [540, "IMPORTE", "der"]]],
          [685, [[40, "2024/02/14"], [110, "OXXO"], [540, "-45.00", "der"]]],
          [670, [[40, "2024/02/15"], [110, "NETFLIX"], [540, "-219.00", "der"]]],
        ],
      ]),
    );
    expect(summary(statement)).toEqual(["2024-02-14 -45.00 OXXO", "2024-02-15 -219.00 NETFLIX"]);
  });

  it("CSV de Chase: descripción buena, del más nuevo al más viejo y días hasta el 12", async () => {
    const statement = await csv(
      "Details,Posting Date,Description,Amount,Type,Balance,Check or Slip #\n" +
        'DEBIT,02/05/2024,"STARBUCKS STORE 1234 SEATTLE WA",-5.75,DEBIT_CARD,2478.76,,\n' +
        'CREDIT,02/02/2024,"ACME CORP PAYROLL PPD ID: 123",2500.00,ACH_CREDIT,2484.51,,\n' +
        'DEBIT,02/01/2024,"NETFLIX.COM",-15.49,DEBIT_CARD,-15.49,,\n',
    );
    expect(summary(statement)).toEqual([
      "2024-02-01 -15.49 NETFLIX.COM",
      "2024-02-02 +2500.00 ACME CORP PAYROLL PPD ID: 123",
      "2024-02-05 -5.75 STARBUCKS STORE 1234 SEATTLE WA",
    ]);
    expect(statement.detected).toMatchObject({ dateOrder: "MDY", dateOrderAmbiguous: true, columns: { description: "Description", date: "Posting Date" } });
  });

  it("CSV de ahorro con más depósitos que retiros: los depósitos siguen siendo ingresos", async () => {
    const statement = await csv(
      "Fecha,Concepto,Importe\n02/02/2024,TRASPASO DESDE CTA 1234,1500.00\n09/02/2024,TRASPASO DESDE CTA 1234,1500.00\n" +
        "16/02/2024,TRASPASO A CTA 5678,-2000.00\n23/02/2024,TRASPASO DESDE CTA 1234,1500.00\n",
    );
    expect(statement.rows.map((row) => row.direction)).toEqual(["CREDIT", "CREDIT", "DEBIT", "CREDIT"]);
    expect(statement.warnings).toEqual([]);
  });

  it("los saldos deciden el signo aunque la mayoría y las palabras clave digan otra cosa", async () => {
    const statement = await csv(
      "Fecha,Concepto,Importe,Saldo\n15/02/2024,COMPRA AMAZON,-500.00,1500.00\n20/02/2024,MOVIMIENTO,300.00,1200.00\n25/02/2024,MOVIMIENTO,200.00,1000.00\n",
      { accountKind: "liability" },
    );
    expect(statement.detected.signConvention).toBe("negative_is_debit");
    expect(statement.rows.map((row) => row.direction)).toEqual(["DEBIT", "CREDIT", "CREDIT"]);
    expect(statement.warnings).toEqual([]);
  });

  it("CSV: las fechas valor y las cuotas no se toman como monto", async () => {
    for (const header of ["Fecha,Fecha valor,Concepto,Cargo,Abono,Saldo", "F. Operación,F. Valor,Concepto,Cargo,Abono,Saldo", "Date,Value Date,Description,Debit,Credit,Balance"]) {
      const statement = await csv(`${header}\n15/02/2024,15/02/2024,COMPRA OXXO,45.50,,954.50\n16/02/2024,16/02/2024,NOMINA,,9000.00,9954.50\n`);
      expect(summary(statement)).toEqual(["2024-02-15 -45.50 COMPRA OXXO", "2024-02-16 +9000.00 NOMINA"]);
    }
    const chile = await csv("Fecha,Descripción,Cantidad de cuotas,Cargos,Abonos\n15/02/2024,COMPRA FALABELLA,3/6,15.990,\n16/02/2024,PAGO TARJETA,,,100.000\n");
    expect(summary(chile)).toEqual(["2024-02-15 -15990.00 COMPRA FALABELLA", "2024-02-16 +100000.00 PAGO TARJETA"]);
  });

  it("CSV: las filas de saldo con fecha se omiten y el saldo final se aprovecha", async () => {
    const statement = await csv(
      'Fecha,Concepto,Importe\n01/02/2024,Saldo inicial,"10,000.00"\n05/02/2024,OXXO,-45.50\n06/02/2024,NETFLIX,-219.00\n29/02/2024,Saldo final,"9,735.50"\n',
    );
    expect(summary(statement)).toEqual(["2024-02-05 -45.50 OXXO", "2024-02-06 -219.00 NETFLIX"]);
    expect(statement.skipped.map((row) => row.reason)).toEqual(Array(2).fill("Fila de saldo o de totales: no es un movimiento"));
    expect(statement.closingBalanceCents).toBe(973550);

    const bofa = await csv(
      'Description,,Summary Amt.\nBeginning balance as of 02/01/2024,,"1,000.00"\nTotal credits,,"2,500.00"\n\n' +
        'Date,Description,Amount,Running Bal.\n02/01/2024,Beginning balance as of 02/01/2024,,"1,000.00"\n' +
        '02/02/2024,"ACME PAYROLL","2,500.00","3,500.00"\n02/05/2024,"STARBUCKS","-5.75","3,494.25"\n',
    );
    expect(summary(bofa)).toEqual(["2024-02-02 +2500.00 ACME PAYROLL", "2024-02-05 -5.75 STARBUCKS"]);
  });

  it("dos estados de cuenta que se enciman no duplican un movimiento con el signo al revés", async () => {
    const january = await csv("Fecha,Concepto,Importe,Saldo\n13/01/2024,OXXO,45.50,954.50\n20/01/2024,TRANSFERENCIA DE JUAN PEREZ,1500.00,2454.50\n25/01/2024,NETFLIX,219.00,2235.50\n");
    const overlap = await csv("Fecha,Concepto,Importe,Saldo\n20/01/2024,TRANSFERENCIA DE JUAN PEREZ,1500.00,2454.50\n25/01/2024,NETFLIX,219.00,2235.50\n14/02/2024,OXXO,38.00,2197.50\n");
    expect(january.rows[1].direction).toBe("CREDIT"); // por el saldo
    expect(overlap.rows[0].direction).toBe("DEBIT"); // sin saldo anterior, por omisión
    const seen = new Set(fingerprintRows(january.rows));
    expect(fingerprintRows(overlap.rows).map((id) => seen.has(id))).toEqual([true, true, false]);
  });

  it("avisa si las fechas sin año quedan repartidas en más de tres meses", async () => {
    const statement = await csv("Fecha,Concepto,Importe\n15/ABR,OXXO,-45.00\n05/MAR,NETFLIX,-219.00\n");
    expect(statement.warnings).toContain(
      "Las fechas no traen año y quedaron repartidas en más de tres meses: revisa que el año de cada movimiento sea el correcto.",
    );
  });

  it("reconstruir la tabla sigue siendo rápido con renglones o celdas a montones", () => {
    const continuation: PdfTextItem[] = [
      { page: 1, str: "05/02/2024", x: 40, y: 1_000_000, width: 50, size: 10 },
      { page: 1, str: "OXXO", x: 100, y: 1_000_000, width: 20, size: 10 },
      { page: 1, str: "45.50", x: 400, y: 1_000_000, width: 25, size: 10 },
      ...Array.from({ length: 40_000 }, (_, i) => ({ page: 1, str: "a", x: 100, y: 1_000_000 - (i + 1) * 5, width: 5, size: 10 })),
    ];
    const wide: PdfTextItem[] = [
      { page: 1, str: "FECHA", x: 40, y: 700, width: 30, size: 10 },
      { page: 1, str: "CONCEPTO", x: 100, y: 700, width: 45, size: 10 },
      { page: 1, str: "IMPORTE", x: 500, y: 700, width: 40, size: 10 },
      { page: 1, str: "05/02/2024", x: 40, y: 685, width: 50, size: 10 },
      ...Array.from({ length: 40_000 }, (_, i) => ({ page: 1, str: "a", x: 100 + i * 10, y: 685, width: 5, size: 10 })),
    ];
    for (const items of [continuation, wide]) {
      const started = Date.now();
      readStatementLayout(items);
      expect(Date.now() - started).toBeLessThan(2_000);
    }
  });
});

// PDF de dos movimientos cifrado con AES-256 (contraseña "1234"). Se generó con pdf-lib y:
//   qpdf --encrypt 1234 dueno-secreto 256 -- estado.pdf estado-protegido.pdf
const PROTECTED_PDF_BASE64 =
  "JVBERi0xLjcKJb/3ov4KMSAwIG9iago8PCAvRXh0ZW5zaW9ucyA8PCAvQURCRSA8PCAvQmFzZVZlcnNpb24gLzEuNyAvRXh0ZW5zaW9uTGV2ZWwgOCA+" +
  "PiA+PiAvUGFnZXMgMyAwIFIgL1R5cGUgL0NhdGFsb2cgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL0NyZWF0aW9uRGF0ZSA8OTIzNjE4NmZhODkzZDYxMTg3" +
  "Y2Q4ZjE2MzA4YTg0YjE0ZDZhMzM0MjhkYTgxNzhkNWM0YTQ4N2Y3Yjg4ZmY1NGIxZDRiYzcxZTE1NmMzYjY2ZjAxYjYzNGE3ODUwZmQ0PiAvQ3JlYXRv" +
  "ciA8ODI5YjA0YzRhNGE3MTY1MzliM2ZmNmRmYTJkZTBmZmYwYmJiYTczNTI5ZGI3MDU1ZTM2ZjRhZTY0MjZlZmYyM2YzOGQ5MmMxNjcxNjFmMjllZjZh" +
  "NjIyZDU0MjM0ZDFlMGY4NmY1NWNkZmYwYmIzOWVjZjc0ODIzMzdiYjVmNWNjOGUxOTdlMWJhOGM3ZGJmNmY2ZmVkNzk2YjczNDY1NjNjOTQzMWFjODMx" +
  "ZTM4ZWQ3YjFiZmY1Y2IwZDc2YWI0MzhiZDkzMWEyMDExMjljNzhjZGVkYTk5MGNlMzhmMTM+IC9Nb2REYXRlIDw0MzY2MzVkMWRlZDQ3N2I5MjlhNGI1" +
  "OTZkOTRkOGE5ZGIzY2I4MTQ3MjZkYjdmMGZmMDk0YzgzZDc1ZGExZDg2MjQ4ZDRlZjZiYzZkMGE1NmM0ZTlmMDMxMGFjOWViNTc+IC9Qcm9kdWNlciA8" +
  "MDg0ZWUxZDI2MmI1NTIxYWZmNTFiNjYwOTQyY2M2ZDRkY2Q0Mzg2YWNlZjhmYzBiY2NlYjdiOTYzMWYwYjE1MzJmNTkzNDU4ZDNiZTQzOGJmYjQ3MWUy" +
  "YjUxOTUzNDk1NDZmMzZkOWU1MDNhZTY2YWE3YTI0NDg3NDNiNWI1ODlmMjg1MzE3MWFhM2ViZGU0MTJmZGQ2MjExZGU0ODQxYTQwMGY1MWNiMjM2MjM4" +
  "NmU2MDA0NTcwMmVmMjM1ZGU0NTBhNjM3Yjg5OTE3NDI0ZDM5MzI2NGQzYmZiZTllMTA+ID4+CmVuZG9iagozIDAgb2JqCjw8IC9Db3VudCAxIC9LaWRz" +
  "IFsgNCAwIFIgXSAvVHlwZSAvUGFnZXMgPj4KZW5kb2JqCjQgMCBvYmoKPDwgL0Fubm90cyBbIF0gL0NvbnRlbnRzIFsgNSAwIFIgXSAvTWVkaWFCb3gg" +
  "WyAwIDAgNjEyIDc5MiBdIC9QYXJlbnQgMyAwIFIgL1Jlc291cmNlcyA8PCAvRXh0R1N0YXRlIDw8ID4+IC9Gb250IDw8IC9IZWx2ZXRpY2EtMTg0ODUy" +
  "NDE3NSA2IDAgUiAvSGVsdmV0aWNhLTIwMDA4MDU5ODYgNiAwIFIgL0hlbHZldGljYS01ODI0NjYyMzM4IDYgMCBSIC9IZWx2ZXRpY2EtNzA5ODQ4MDc4" +
  "OSA2IDAgUiAvSGVsdmV0aWNhLTc1NzI1MzM2ODYgNiAwIFIgL0hlbHZldGljYS03ODg4OTExMDYzIDYgMCBSIC9IZWx2ZXRpY2EtODQ1MDE4MDEwNyA2" +
  "IDAgUiAvSGVsdmV0aWNhLTg2NTk4NzE4NzggNiAwIFIgL0hlbHZldGljYS05NzQyNjgyNTY4IDYgMCBSIC9IZWx2ZXRpY2EtOTc1MDQ2OTIwNyA2IDAg" +
  "UiAvSGVsdmV0aWNhLTk3OTM0NDkyOSA2IDAgUiA+PiAvWE9iamVjdCA8PCA+PiA+PiAvVHlwZSAvUGFnZSA+PgplbmRvYmoKNSAwIG9iago8PCAvRmls" +
  "dGVyIC9GbGF0ZURlY29kZSAvTGVuZ3RoIDM4NCA+PgpzdHJlYW0KgonOCFp5IUdU0B5dd1qAXqFYmHiJtVuZOpbI5Amks6VlzjVpDDJrkpbV114KVYbt" +
  "Tr8lKYvLo0dU9/WUv8CWVYKaFDlforD0+nZTa+xuwmVpHbRDYwqNXj3CskFSajtl/5khdrN1WgU72Gmw1KVbErqW2hGbiABtBjxfm331Pj94Gs7jypX0" +
  "AHsrVe6DQmFInefhwYqOBwPMVNA2wwjzMRK6oMdAuKAa5n+Dp8GxVYhYZT44VVemDqACwq1QSURc7qVVa/Bi1uR/utg8q5SK3MkPYJ+881WqHYTKd7GN" +
  "k72VH0ZAqdXFaIcst/0tjDhHjiDtQLlzEp6mhokGKxY2Yr3x44No4xPNrwUmQ93QzzIfr8YLYufEpzUGRKlxzSkmlxjyXIJsPSrZjAWAq5MuARbrb+Bx" +
  "W7SfQe6waq39OqsopAIz01IIGZ0uFlC7YZ08glz79NoBXlZ/7s3zLmQLs3GOTbLiyr2QDQHXqgAvqLkNQ09FIKkQkuVPXJ07KyW2ZW5kc3RyZWFtCmVu" +
  "ZG9iago2IDAgb2JqCjw8IC9CYXNlRm9udCAvSGVsdmV0aWNhIC9FbmNvZGluZyAvV2luQW5zaUVuY29kaW5nIC9TdWJ0eXBlIC9UeXBlMSAvVHlwZSAv" +
  "Rm9udCA+PgplbmRvYmoKNyAwIG9iago8PCAvQ0YgPDwgL1N0ZENGIDw8IC9BdXRoRXZlbnQgL0RvY09wZW4gL0NGTSAvQUVTVjMgL0xlbmd0aCAzMiA+" +
  "PiA+PiAvRmlsdGVyIC9TdGFuZGFyZCAvTGVuZ3RoIDI1NiAvTyA8Yzc4YzA2Y2Q0YTg5NWRiMDhiNzdmNmQ5MzlmOGRjYmQ1MjdmZWRiZWQxYmUwM2Ji" +
  "OGYwNjU5MDdlMmFhZThiZGUzODA4Zjk4NWQxYzA3YWM0NTI2YmExMDRlMWRmYzczPiAvT0UgPDlhMzA5YWU2OWE4ZDJmODcyOWE0NWVlZDJiZDI2MjBm" +
  "ZmVmOGRjMjUwYzQ1YjFmMDM3NjliNjdjOWZkODc5YWM+IC9QIC00IC9QZXJtcyA8OTBkNGExMTAxZjgwZDk1M2ZiNDM3MDcxMGE1YzQ4NzE+IC9SIDYg" +
  "L1N0bUYgL1N0ZENGIC9TdHJGIC9TdGRDRiAvVSA8MmQ5YTcwMDYxNTQwYjM3OWYxODA4ZjUxNzY3NjVjOGE5OTliZWZhMmVjMzVmNTg0OWNmZjE2MGI2" +
  "MTJlZTNlYTc4N2ZiNTQ5ZTY3OGZhZWYxNjJhZDc3NzIzNjFjYmI4PiAvVUUgPGZmZGU5MzhhZTM0NDBiNTg0ZjA2NjFkNDBhMGI5NjZjZTBlNzVkMjZj" +
  "M2ExNGU2NmVhMzgyNzdlZjdmYTRiMDI+IC9WIDUgPj4KZW5kb2JqCnhyZWYKMCA4CjAwMDAwMDAwMDAgNjU1MzUgZiAKMDAwMDAwMDAxNSAwMDAwMCBu" +
  "IAowMDAwMDAwMTMwIDAwMDAwIG4gCjAwMDAwMDA4NDUgMDAwMDAgbiAKMDAwMDAwMDkwNCAwMDAwMCBuIAowMDAwMDAxMzc3IDAwMDAwIG4gCjAwMDAw" +
  "MDE4MzIgMDAwMDAgbiAKMDAwMDAwMTkyOSAwMDAwMCBuIAp0cmFpbGVyIDw8IC9JbmZvIDIgMCBSIC9Sb290IDEgMCBSIC9TaXplIDggL0lEIFs8MTIw" +
  "ZTBmMTAwMmYwYTIyMGNhZTc5ZDA4MjlmMzc1ODI+PDEyMGUwZjEwMDJmMGEyMjBjYWU3OWQwODI5ZjM3NTgyPl0gL0VuY3J5cHQgNyAwIFIgPj4Kc3Rh" +
  "cnR4cmVmCjI0NzYKJSVFT0YK";
