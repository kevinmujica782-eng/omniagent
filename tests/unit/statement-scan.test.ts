import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { toAnthropicOutputSchema } from "@/modules/ai/ai.schema";
import { centsToDecimal } from "@/modules/finance/statement-import/amounts";
import { parseScan } from "@/modules/finance/statement-import/parse";
import { assembleScan, UNCLEAR_REASON, type ScanPageResult, type ScanRow, type ScanTranscription } from "@/modules/finance/statement-import/scan-assemble";
import { checkRunningBalances, scanTargetWarnings, signsCanReach } from "@/modules/finance/statement-import/scan-checks";
import { scanPagesFromFiles } from "@/modules/finance/statement-import/scan-files";
import { dropNullUnions, MAX_ROWS_PER_PAGE, scanPageSchema, scanRequestJsonSchema, unionCount } from "@/modules/finance/statement-import/scan-schema";
import { imageTypeOf, sniffFormat } from "@/modules/finance/statement-import/sniff";
import type { ParsedStatement, RawRow } from "@/modules/finance/statement-import/types";
import { PROTECTED_PDF_BASE64 } from "../support/protected-pdf";

// Lectura con IA de estados de cuenta en fotos o escaneados: páginas y archivos, armado de lo transcrito, las mismas
// reglas que un PDF con texto y las comprobaciones con saldos y totales del propio documento.

const NOW = new Date("2024-04-10T12:00:00Z");

async function errorOf(run: () => unknown): Promise<{ code: string; message: string; details?: unknown } | null> {
  try {
    await run();
  } catch (error) {
    const { code, message, details } = error as { code?: string; message?: string; details?: unknown };
    return { code: code ?? "unknown", message: message ?? "", details };
  }
  return null;
}

function row(partial: Partial<ScanRow> & Pick<ScanRow, "description">): ScanRow {
  return { date: "", amount: null, debit: null, credit: null, type: null, balance: null, unclear: false, ...partial };
}

function page(partial: Partial<ScanPageResult>): ScanPageResult {
  return {
    isStatement: true,
    legible: true,
    institution: null,
    accountType: "unknown",
    accountLast4: null,
    currency: null,
    periodStart: null,
    periodEnd: null,
    openingBalance: null,
    closingBalance: null,
    totalDebits: null,
    totalCredits: null,
    rows: [],
    ...partial,
  };
}

const summary = (statement: ParsedStatement) =>
  statement.rows.map((r) => `${r.date} ${r.direction === "DEBIT" ? "-" : "+"}${centsToDecimal(r.amountCents)} ${r.description}`);

/** Cuenta de débito en dos páginas: el resumen en la primera y movimientos del mismo día sin repetir la fecha. */
function debitStatement(overrides: { cfe?: string; starbucksUnclear?: boolean } = {}): ScanTranscription {
  return {
    pages: [
      {
        page: 1,
        result: page({
          institution: "BBVA",
          accountType: "checking",
          accountLast4: "4321",
          currency: "MXN",
          periodStart: "01/03/2024",
          periodEnd: "31/03/2024",
          openingBalance: "10,000.00",
          closingBalance: "10,738.50",
          totalDebits: "761.50",
          totalCredits: "1,500.00",
          rows: [
            row({ date: "02/03/2024", description: "OXXO SUC CENTRO", debit: "45.50", balance: "9,954.50" }),
            row({ description: "STARBUCKS PLAZA", debit: "89.00", balance: "9,865.50", unclear: overrides.starbucksUnclear ?? false }),
            row({ date: "05/03/2024", description: "SPEI RECIBIDO NOMINA", credit: "1,500.00", balance: "11,365.50" }),
          ],
        }),
      },
      {
        page: 2,
        result: page({
          rows: [
            row({ description: "NETFLIX.COM", debit: "199.00", balance: "11,166.50" }),
            row({ date: "10/03/2024", description: "CFE SUMINISTRADOR", debit: overrides.cfe ?? "428.00", balance: "10,738.50" }),
          ],
        }),
      },
    ],
  };
}

describe("lectura con IA: armado y reglas", () => {
  it("lee una cuenta de débito en dos páginas y la comprueba con el saldo final, los saldos y los totales", () => {
    const statement = parseScan(debitStatement(), { now: NOW });
    expect(statement.format).toBe("scan");
    expect(summary(statement)).toEqual([
      "2024-03-02 -45.50 OXXO SUC CENTRO",
      // Sin fecha: la del renglón anterior.
      "2024-03-02 -89.00 STARBUCKS PLAZA",
      "2024-03-05 +1500.00 SPEI RECIBIDO NOMINA",
      // También al cambiar de página.
      "2024-03-05 -199.00 NETFLIX.COM",
      "2024-03-10 -428.00 CFE SUMINISTRADOR",
    ]);
    expect(statement.periodStart).toBe("2024-03-01");
    expect(statement.periodEnd).toBe("2024-03-31");
    expect(statement.closingBalanceCents).toBe(1_073_850);
    expect(statement.detected.pages).toBe(2);
    expect(statement.scan).toMatchObject({
      pages: 2,
      unreadablePages: [],
      checks: ["closing", "running", "totals"],
      verified: true,
      institution: "BBVA",
      accountType: "checking",
      last4: "4321",
      currency: "MXN",
    });
    expect(statement.warnings).toEqual([]);
  });

  it("avisa cuando una cifra mal leída no cuadra con el documento", () => {
    // 428.00 leído como 482.00: no cuadra con el saldo final, ni con el saldo del renglón, ni con el total de cargos.
    const statement = parseScan(debitStatement({ cfe: "482.00" }), { now: NOW });
    expect(statement.scan?.verified).toBe(false);
    const warnings = statement.warnings.join("\n");
    expect(warnings).toMatch(/no cuadran con el saldo final del documento \(diferencia de 54\.00\)/);
    expect(warnings).toMatch(/Un movimiento no cuadra con el saldo de su renglón: «CFE SUMINISTRADOR» \(página 2, renglón 2\)/);
    expect(warnings).toMatch(/La suma de los cargos \(815\.50\) no coincide con el total de cargos del documento \(761\.50\)/);
  });

  it("no importa un renglón con dígitos dudosos y lo explica", () => {
    const statement = parseScan(debitStatement({ starbucksUnclear: true }), { now: NOW });
    expect(statement.rows.map((r) => r.description)).not.toContain("STARBUCKS PLAZA");
    expect(statement.skipped).toContainEqual(expect.objectContaining({ source: "página 1, renglón 2", reason: UNCLEAR_REASON }));
    expect(statement.warnings.join("\n")).toMatch(/Un movimiento no se leía bien y no se importará/);
    // Falta un cargo: el saldo final ya no cuadra (y se avisa en lugar de importar en silencio).
    expect(statement.scan?.verified).toBe(false);
  });

  it("lee una tarjeta de crédito del más nuevo al más viejo, con CR y fechas sin año", () => {
    const statement = parseScan(
      {
        pages: [
          {
            page: 1,
            result: page({
              accountType: "credit_card",
              periodEnd: "25/03/2024",
              openingBalance: "5,000.00",
              closingBalance: "5,420.00",
              totalDebits: "1,420.00",
              totalCredits: "1,000.00",
              rows: [
                row({ date: "20/03", description: "PAGO GRACIAS", amount: "1,000.00 CR" }),
                row({ date: "15/03", description: "AMAZON MX", amount: "920.00" }),
                row({ date: "02/03", description: "UBER *TRIP", amount: "500.00" }),
              ],
            }),
          },
        ],
      },
      { now: NOW, accountKind: "liability" },
    );
    expect(summary(statement)).toEqual(["2024-03-02 -500.00 UBER *TRIP", "2024-03-15 -920.00 AMAZON MX", "2024-03-20 +1000.00 PAGO GRACIAS"]);
    expect(statement.scan).toMatchObject({ verified: true, checks: ["closing", "totals"], accountType: "credit_card" });
  });

  it("ignora las páginas que no son del estado de cuenta y avisa de las que no se pudieron leer", () => {
    const transcription: ScanTranscription = {
      pages: [
        { page: 3, result: null },
        { page: 1, result: page({ isStatement: false }) },
        { page: 2, result: page({ legible: false, rows: [row({ date: "01/03/2024", description: "BORROSO", debit: "9.99" })] }) },
        { page: 4, result: page({ rows: [row({ date: "03/03/2024", description: "FARMACIA", debit: "120.00" })] }) },
      ],
    };
    const assembled = assembleScan(transcription);
    expect(assembled.ignoredPages).toEqual([1]);
    expect(assembled.unreadablePages).toEqual([2, 3]);
    // Una página ilegible no aporta cifras.
    expect(assembled.raw.map((r) => r.description)).toEqual(["FARMACIA"]);

    const statement = parseScan(transcription, { now: NOW });
    expect(summary(statement)).toEqual(["2024-03-03 -120.00 FARMACIA"]);
    expect(statement.warnings[0]).toBe("No pude leer bien las páginas 2 y 3: tómale otra foto más nítida, derecha y con buena luz.");
    // Sin saldos ni totales no hay con qué comprobar.
    expect(statement.scan).toMatchObject({ verified: null, checks: [], unreadablePages: [2, 3] });
  });

  it("rechaza fotos que no son de un estado de cuenta, o sin movimientos", async () => {
    const notStatement = await errorOf(() => parseScan({ pages: [{ page: 1, result: page({ isStatement: false }) }] }, { now: NOW }));
    expect(notStatement?.code).toBe("no_transactions_found");
    expect(notStatement?.message).toMatch(/No parece un estado de cuenta/);
    const empty = await errorOf(() => parseScan({ pages: [{ page: 1, result: page({}) }] }, { now: NOW }));
    expect(empty?.code).toBe("no_transactions_found");
    expect(empty?.message).toMatch(/tabla de movimientos se vea completa/);
  });

  it("respeta el orden de fechas elegido a mano", () => {
    const transcription: ScanTranscription = {
      pages: [{ page: 1, result: page({ rows: [row({ date: "03/04/2024", description: "CAFE", debit: "50.00" })] }) }],
    };
    expect(parseScan(transcription, { now: NOW }).rows[0].date).toBe("2024-04-03");
    expect(parseScan(transcription, { now: NOW, dateOrder: "MDY" }).rows[0].date).toBe("2024-03-04");
  });
});

describe("lectura con IA: comprobaciones", () => {
  it("prueba las combinaciones de cargos y abonos entre dos saldos", () => {
    expect(signsCanReach([], 0)).toBe(true);
    expect(signsCanReach([10_000, 5_000], 5_000)).toBe(true);
    expect(signsCanReach([10_000, 5_000], -15_000)).toBe(true);
    expect(signsCanReach([10_000, 5_000], 2_000)).toBe(false);
    // ±1 centavo por redondeo.
    expect(signsCanReach([4_550], -4_551)).toBe(true);
  });

  it("encuentra el sentido de lectura de los saldos y el renglón que no cuadra", () => {
    const rows = (balances: [string, string][]): RawRow[] =>
      balances.map(([amount, balance], i) => ({ source: `r${i + 1}`, date: "01/03/2024", description: `M${i + 1}`, amount, balance }));
    // Cronológico: 1000 → 900 (-100) → 1150 (+250).
    expect(checkRunningBalances(rows([["0.00", "1,000.00"], ["100.00", "900.00"], ["250.00", "1,150.00"]])).bad).toEqual([]);
    // Del más nuevo al más viejo: el mismo extracto al revés.
    expect(checkRunningBalances(rows([["250.00", "1,150.00"], ["100.00", "900.00"], ["0.00", "1,000.00"]])).bad).toEqual([]);
    // 250 leído como 520: ese renglón no cuadra.
    const bad = checkRunningBalances(rows([["0.00", "1,000.00"], ["100.00", "900.00"], ["520.00", "1,150.00"]])).bad;
    expect(bad.map((r) => r.source)).toEqual(["r3"]);
  });

  it("compara lo que se ve en el documento con la cuenta elegida", () => {
    expect(scanTargetWarnings({ accountType: "credit_card", currency: "USD" }, { kind: "asset", currency: "MXN" })).toEqual([
      "El documento parece de una tarjeta de crédito, pero elegiste una cuenta de débito: los cargos y abonos podrían quedar al revés.",
      "El documento está en USD y la cuenta en MXN: revisa que sea la cuenta correcta.",
    ]);
    expect(scanTargetWarnings({ accountType: "savings", currency: "mxn".toUpperCase() }, { kind: "liability", currency: "MXN" })).toHaveLength(1);
    expect(scanTargetWarnings({ accountType: null, currency: null }, { kind: "asset", currency: "MXN" })).toEqual([]);
  });
});

describe("lectura con IA: lo que responde el modelo", () => {
  it("normaliza y recorta en lugar de rechazar la página por un detalle", () => {
    const parsed = scanPageSchema.parse({
      isStatement: true,
      legible: true,
      institution: "  Banco   Azteca  ",
      accountType: "credit_card",
      accountLast4: "**** **** **** 1234",
      currency: "mxn",
      periodEnd: null,
      rows: [
        { date: " 05/03 ", description: "x".repeat(500), debit: "45.50", unclear: null },
        { date: null, description: null, amount: "  " },
      ],
    });
    expect(parsed).toMatchObject({ institution: "Banco Azteca", accountLast4: "1234", currency: "MXN", periodStart: null, totalDebits: null });
    expect(parsed.rows[0]).toMatchObject({ date: "05/03", debit: "45.50", amount: null, unclear: false });
    expect(parsed.rows[0].description).toHaveLength(200);
    expect(parsed.rows[1]).toMatchObject({ date: "", description: "", amount: null });
    // Nunca más de 4 dígitos de la cuenta, ni monedas inventadas.
    expect(scanPageSchema.parse({ isStatement: true, legible: true, accountType: "unknown", accountLast4: "12", currency: "pesos", rows: [] })).toMatchObject({
      accountLast4: null,
      currency: null,
    });
  });

  it("descarta los renglones de más", () => {
    const rows = Array.from({ length: MAX_ROWS_PER_PAGE + 20 }, (_, i) => ({ date: "01/03/2024", description: `M${i}`, debit: "1.00" }));
    expect(scanPageSchema.parse({ isStatement: true, legible: true, accountType: "checking", rows }).rows).toHaveLength(MAX_ROWS_PER_PAGE);
  });

  it("el esquema que se le pide a la IA es válido para la salida estructurada de Claude", () => {
    const json = z.toJSONSchema(scanPageSchema, { io: "input" }) as Record<string, unknown> & {
      properties: Record<string, { items?: { properties: Record<string, { description?: string }>; required?: string[] } }>;
      required: string[];
    };
    expect(json.required).toEqual(expect.arrayContaining(["isStatement", "legible", "accountType", "rows"]));
    expect(json.required).not.toContain("institution");
    const rowSchema = json.properties.rows.items!;
    expect(Object.keys(rowSchema.properties)).toEqual(["date", "description", "amount", "debit", "credit", "type", "balance", "unclear"]);
    expect(rowSchema.properties.date.description).toMatch(/Fecha tal como aparece/);
    const anthropic = toAnthropicOutputSchema(json) as { additionalProperties?: boolean };
    expect(anthropic.additionalProperties).toBe(false);
  });

  it("lo que se le pide a Claude no pasa del límite de uniones de la salida estructurada (16)", () => {
    // Con «o null» en cada dato opcional serían 17 uniones: Claude rechaza el pedido (400). Se piden sin null.
    const requested = scanRequestJsonSchema();
    expect(unionCount(toAnthropicOutputSchema(requested))).toBe(0);
    const props = (requested as { properties: Record<string, { type?: unknown; description?: string }> }).properties;
    expect(props.institution.type).toBe("string");
    expect(props.institution.description).toMatch(/Banco o emisor/);
    expect((requested as { required: string[] }).required).not.toContain("institution");
    const row = (props.rows as unknown as { items: { properties: Record<string, { type?: unknown }> } }).items.properties;
    expect(row.date.type).toBe("string");
    expect(row.unclear.type).toBe("boolean");
    // La validación sigue aceptando null (por si un modelo lo manda igual).
    expect(scanPageSchema.parse({ isStatement: true, legible: true, accountType: "unknown", institution: null, rows: [] }).institution).toBeNull();
  });

  it("quita la rama null de las uniones sin tocar lo demás", () => {
    expect(dropNullUnions({ anyOf: [{ type: "string" }, { type: "null" }], description: "x" })).toEqual({ type: "string", description: "x" });
    expect(dropNullUnions({ type: ["string", "null"] })).toEqual({ type: "string" });
    expect(dropNullUnions({ anyOf: [{ type: "string" }, { type: "number" }, { type: "null" }] })).toEqual({ anyOf: [{ type: "string" }, { type: "number" }] });
    expect(unionCount({ properties: { a: { anyOf: [{}, {}] }, b: { type: ["string", "null"] }, c: { type: "string" } } })).toBe(2);
  });
});

describe("lectura con IA: archivos y páginas", () => {
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
  const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 1, 2]);
  const webp = new TextEncoder().encode("RIFF\u0000\u0000\u0000\u0000WEBPVP8 ");
  const heic = Uint8Array.from([0, 0, 0, 0x18, ...new TextEncoder().encode("ftypheic"), 0, 0]);

  async function pdfWithPages(count: number): Promise<Uint8Array> {
    const doc = await PDFDocument.create();
    for (let i = 0; i < count; i++) doc.addPage([612, 792]);
    return doc.save();
  }

  it("reconoce las fotos por su contenido", async () => {
    expect(imageTypeOf(png)).toBe("image/png");
    expect(imageTypeOf(jpeg)).toBe("image/jpeg");
    expect(imageTypeOf(webp)).toBe("image/webp");
    expect(imageTypeOf(heic)).toBe("heic");
    expect(imageTypeOf(new TextEncoder().encode("Fecha,Monto"))).toBeNull();
    expect((await errorOf(() => sniffFormat(jpeg, "estado.jpg")))?.code).toBe("scan_required");
    expect((await errorOf(() => sniffFormat(heic, "IMG_0001.HEIC")))?.code).toBe("unsupported_file_type");
  });

  it("parte un PDF escaneado en páginas sueltas", async () => {
    const document = await scanPagesFromFiles([{ bytes: await pdfWithPages(3), fileName: "estado.pdf" }]);
    expect(document.source).toBe("pdf");
    expect(document.pages.map((p) => [p.page, p.mediaType])).toEqual([
      [1, "application/pdf"],
      [2, "application/pdf"],
      [3, "application/pdf"],
    ]);
    for (const single of document.pages) expect((await PDFDocument.load(single.bytes)).getPageCount()).toBe(1);
  });

  it("cada foto es una página", async () => {
    const document = await scanPagesFromFiles([
      { bytes: png, fileName: "1.png" },
      { bytes: jpeg, fileName: "2.jpg" },
      { bytes: webp, fileName: "3.webp" },
    ]);
    expect(document).toMatchObject({ source: "images" });
    expect(document.pages.map((p) => [p.page, p.mediaType])).toEqual([
      [1, "image/png"],
      [2, "image/jpeg"],
      [3, "image/webp"],
    ]);
  });

  it("rechaza lo que no se puede leer con IA", async () => {
    const code = async (files: { bytes: Uint8Array; fileName: string }[]) => (await errorOf(() => scanPagesFromFiles(files)))?.code;
    expect(await code([])).toBe("file_required");
    expect(await code([{ bytes: new Uint8Array(), fileName: "vacia.jpg" }])).toBe("empty_file");
    expect(await code([{ bytes: heic, fileName: "IMG.HEIC" }])).toBe("unsupported_file_type");
    expect(await code([{ bytes: new TextEncoder().encode("Fecha,Monto"), fileName: "estado.csv" }])).toBe("unsupported_file_type");
    expect(await code([{ bytes: await pdfWithPages(1), fileName: "a.pdf" }, { bytes: png, fileName: "b.png" }])).toBe("unsupported_file_type");
    expect(await code([{ bytes: await pdfWithPages(21), fileName: "largo.pdf" }])).toBe("too_many_pages");
    expect(await code(Array.from({ length: 11 }, (_, i) => ({ bytes: png, fileName: `${i}.png` })))).toBe("too_many_pages");
    expect(await code([{ bytes: new Uint8Array(4 * 1024 * 1024 + 1).fill(0xff), fileName: "enorme.jpg" }])).toBe("file_too_large");
    // pdf-lib no descifra: un PDF escaneado con contraseña no se puede partir.
    const locked = Uint8Array.from(Buffer.from(PROTECTED_PDF_BASE64, "base64"));
    expect(await code([{ bytes: locked, fileName: "protegido.pdf" }])).toBe("scan_protected_pdf");
  });
});
