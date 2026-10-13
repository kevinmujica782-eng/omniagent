import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import type { ScanPageResult, ScanRow } from "@/modules/finance/statement-import/scan-assemble";
import {
  createScan,
  deleteScan,
  getScan,
  loadScanTranscription,
  purgeExpiredScans,
  readScanPage,
  type ScanPageReader,
} from "@/modules/finance/statement-import/scan.service";
import { importStatement, previewStatement } from "@/modules/finance/statement-import/statements.service";
import type { StatementOptions } from "@/modules/finance/statement-import/upload";

// Lectura con IA contra un Postgres de verdad (job «Base de datos (Postgres)» de CI): páginas cifradas, lectura una
// por una con reintentos, cupo del plan, vencimiento y la vista previa e importación con lo transcrito. La IA se
// reemplaza por un lector de prueba (la llave de ANTHROPIC_API_KEY de la configuración de pruebas no se usa).

const userId = randomUUID();
const otherUserId = randomUUID();

/** Bytes con la firma de PNG: el servidor no decodifica la imagen, solo reconoce el tipo. */
const png = (seed: number) => Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, seed, 1, 2, 3]);
const photo = (seed: number) => ({ fileName: `${seed}.png`, bytes: png(seed) });

function row(partial: Partial<ScanRow> & Pick<ScanRow, "description">): ScanRow {
  return { date: "", amount: null, debit: null, credit: null, type: null, balance: null, unclear: false, ...partial };
}

const BLANK: Omit<ScanPageResult, "rows"> = {
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
};

const PAGES: Record<number, ScanPageResult> = {
  1: {
    ...BLANK,
    institution: "BBVA",
    accountType: "checking",
    accountLast4: "4321",
    currency: "MXN",
    periodStart: "01/03/2024",
    periodEnd: "31/03/2024",
    openingBalance: "10,000.00",
    closingBalance: "10,738.50",
    rows: [
      row({ date: "02/03/2024", description: "OXXO SUC CENTRO", debit: "45.50", balance: "9,954.50" }),
      row({ description: "STARBUCKS PLAZA", debit: "89.00", balance: "9,865.50" }),
      row({ date: "05/03/2024", description: "SPEI RECIBIDO NOMINA", credit: "1,500.00", balance: "11,365.50" }),
    ],
  },
  2: {
    ...BLANK,
    rows: [
      row({ description: "NETFLIX.COM", debit: "199.00", balance: "11,166.50" }),
      row({ date: "10/03/2024", description: "CFE SUMINISTRADOR", debit: "428.00", balance: "10,738.50" }),
    ],
  },
};

const reader: ScanPageReader = async ({ page }) => ({ result: PAGES[page], model: "lector-de-prueba" });
const failing: ScanPageReader = async () => {
  throw new Error("se cayó");
};

beforeAll(async () => {
  await prisma.profile.create({ data: { id: userId, email: `scan-${userId}@test.local`, currency: "MXN" } });
  await prisma.profile.create({ data: { id: otherUserId, email: `scan-${otherUserId}@test.local` } });
});

afterAll(async () => {
  // Los perfiles borran en cascada sus lecturas, cuentas y movimientos.
  await prisma.profile.deleteMany({ where: { id: { in: [userId, otherUserId] } } }).catch(() => undefined);
});

describe("lectura con IA contra Postgres", () => {
  it("guarda las páginas cifradas, las lee una por una y las borra al leerlas", async () => {
    const scan = await createScan(userId, { fileName: "2 fotos del estado de cuenta", files: [photo(1), photo(2)] });
    expect(scan).toMatchObject({ pageCount: 2, source: "images", ready: false });
    expect(scan.pages.map((p) => p.status)).toEqual(["PENDING", "PENDING"]);

    // Cifradas: lo guardado no son los bytes de la foto.
    const stored = await prisma.statementScanPage.findUniqueOrThrow({ where: { scanId_page: { scanId: scan.id, page: 1 } } });
    expect(Buffer.from(stored.data!).equals(Buffer.from(png(1)))).toBe(false);

    // El lector recibe la foto original, ya descifrada.
    const seen: { bytes?: Uint8Array } = {};
    const first = await readScanPage(userId, scan.id, 1, {
      reader: async (input) => {
        seen.bytes = input.bytes;
        return reader(input);
      },
    });
    expect(first).toMatchObject({ page: 1, status: "DONE", rows: 3, error: null });
    expect(Buffer.from(seen.bytes!).equals(Buffer.from(png(1)))).toBe(true);
    // Leída: la página ya no se guarda.
    const read = await prisma.statementScanPage.findUniqueOrThrow({ where: { scanId_page: { scanId: scan.id, page: 1 } } });
    expect(read.data).toBeNull();
    // Idempotente: pedirla otra vez no vuelve a leerla.
    expect((await readScanPage(userId, scan.id, 1, { reader: failing })).status).toBe("DONE");

    // Falta la página 2: todavía no hay vista previa.
    await expect(loadScanTranscription(userId, scan.id)).rejects.toMatchObject({ code: "scan_pending", status: 409 });
    expect((await readScanPage(userId, scan.id, 2, { reader })).status).toBe("DONE");
    expect((await getScan(userId, scan.id)).ready).toBe(true);

    // Nadie más la ve.
    await expect(getScan(otherUserId, scan.id)).rejects.toMatchObject({ code: "scan_not_found" });
    await expect(readScanPage(otherUserId, scan.id, 1, { reader })).rejects.toMatchObject({ code: "scan_not_found" });
    await deleteScan(userId, scan.id);
  });

  it("una página que falla se reintenta hasta tres veces y después cuenta como ilegible", async () => {
    const scan = await createScan(userId, { fileName: "foto", files: [photo(3)] });
    let view = await readScanPage(userId, scan.id, 1, { reader: failing });
    expect(view).toMatchObject({ status: "FAILED", canRetry: true });
    expect(view.error).toMatch(/Vuelve a intentarlo/);
    await readScanPage(userId, scan.id, 1, { reader: failing });
    view = await readScanPage(userId, scan.id, 1, { reader: failing });
    expect(view).toMatchObject({ status: "FAILED", canRetry: false });
    // Sin intentos: no se vuelve a leer y la página se borra.
    expect((await readScanPage(userId, scan.id, 1, { reader })).status).toBe("FAILED");
    const stored = await prisma.statementScanPage.findUniqueOrThrow({ where: { scanId_page: { scanId: scan.id, page: 1 } } });
    expect(stored).toMatchObject({ attempts: 3, data: null });
    // Terminó (con error): ya hay transcripción, con esa página vacía.
    const { transcription } = await loadScanTranscription(userId, scan.id);
    expect(transcription.pages).toEqual([{ page: 1, result: null }]);
    await deleteScan(userId, scan.id);
  });

  it("el mismo documento retoma la lectura anterior en lugar de leerlo (y cobrarlo) otra vez", async () => {
    const first = await createScan(userId, { fileName: "foto", files: [photo(4)] });
    const again = await createScan(userId, { fileName: "foto", files: [photo(4)] });
    expect(again.id).toBe(first.id);
    expect(await deleteScan(userId, first.id)).toEqual({ removed: true });
    const fresh = await createScan(userId, { fileName: "foto", files: [photo(4)] });
    expect(fresh.id).not.toBe(first.id);
    await deleteScan(userId, fresh.id);
  });

  it("la vista previa y la importación usan lo transcrito, y al importar se borra", async () => {
    const scan = await createScan(userId, { fileName: "Estado BBVA (fotos)", files: [photo(5), photo(6)] });
    await readScanPage(userId, scan.id, 1, { reader });
    await readScanPage(userId, scan.id, 2, { reader });
    const options: StatementOptions = { scanId: scan.id, newAccount: { institutionName: "BBVA", type: "CHECKING", currency: "MXN" } };

    const preview = await previewStatement(userId, { fileName: "", mimeType: "", bytes: null, options });
    expect(preview).toMatchObject({
      fileName: "Estado BBVA (fotos)",
      format: "scan",
      count: 5,
      periodStart: "2024-03-01",
      periodEnd: "2024-03-31",
      spending: 761.5,
      income: 1500,
      scan: { scanId: scan.id, pages: 2, verified: true, institution: "BBVA", accountType: "checking", last4: "4321", currency: "MXN" },
    });
    expect(preview.warnings).toEqual([]);

    const result = await importStatement(userId, { fileName: "", mimeType: "", bytes: null, options });
    expect(result).toMatchObject({ imported: 5, duplicates: 0, skipped: 0 });
    const account = await prisma.financialAccount.findUniqueOrThrow({ where: { id: result.accountId } });
    // Los últimos 4 dígitos que leyó la IA y el saldo final del documento.
    expect(account).toMatchObject({ institutionName: "BBVA", mask: "4321", currency: "MXN" });
    expect(Number(account.currentBalance)).toBe(10738.5);
    const statement = await prisma.statementImport.findUniqueOrThrow({ where: { id: result.importId! } });
    expect(statement.fileName).toBe("Estado BBVA (fotos)");
    // Lo transcrito ya quedó como movimientos: se borró.
    expect(await prisma.statementScan.findUnique({ where: { id: scan.id } })).toBeNull();
  });

  it("respeta el cupo mensual de páginas del plan", async () => {
    const scan = await createScan(userId, { fileName: "foto", files: [photo(7)] });
    await prisma.aiUsageLog.createMany({
      data: Array.from({ length: 8 }, () => ({ userId, module: "FINANCE" as const, kind: "statement_page", model: "prueba" })),
    });
    await expect(readScanPage(userId, scan.id, 1, { reader })).rejects.toMatchObject({ status: 402, code: "plan_limit" });
    // La página queda como estaba, para leerla si la persona se pasa a Pro.
    expect((await getScan(userId, scan.id)).pages[0]).toMatchObject({ status: "PENDING", canRetry: false });
    await expect(createScan(userId, { fileName: "otra", files: [photo(8)] })).rejects.toMatchObject({
      status: 402,
      code: "plan_limit",
      details: { reason: "statement_pages", plan: "FREE", limit: 8 },
    });
    await prisma.aiUsageLog.deleteMany({ where: { userId, kind: "statement_page" } });
    await deleteScan(userId, scan.id);
  });

  it("vence a las 12 horas y la limpieza la borra", async () => {
    const scan = await createScan(userId, { fileName: "foto", files: [photo(9)] });
    const later = new Date(Date.now() + 13 * 3_600_000);
    await expect(readScanPage(userId, scan.id, 1, { reader, now: later })).rejects.toMatchObject({ code: "scan_not_found" });
    expect(await purgeExpiredScans(later)).toBeGreaterThanOrEqual(1);
    expect(await prisma.statementScan.findUnique({ where: { id: scan.id } })).toBeNull();
  });
});
