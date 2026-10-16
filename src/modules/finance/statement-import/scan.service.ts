import "server-only";
import { createHash } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import { audit } from "@/lib/audit";
import { decryptBytes, encryptBytes } from "@/lib/crypto";
import { prisma } from "@/lib/db";
import { AppError, Errors } from "@/lib/errors";
import { log } from "@/lib/log";
import { isUuid } from "@/lib/validation";
import { aiErrorToHttp, isAIProviderError } from "@/modules/ai/ai.errors";
import { aiConfigured, generateStructured, StructuredOutputError } from "@/modules/ai/ai.service";
import type { AIContentPart } from "@/modules/ai/ai.types";
import { getEntitlements, monthlyStatementPages, planLimitError } from "@/modules/billing/entitlements";
import type { StatementScanPageView, StatementScanView } from "@/types/cards";
import { statementError } from "./limits";
import type { ScanPageResult, ScanTranscription } from "./scan-assemble";
import { scanPagesFromFiles, type ScanFile, type ScanMediaType } from "./scan-files";
import { SCAN_SYSTEM_PROMPT, SCAN_TOOL_NAME, scanPagePrompt, scanPageSchema } from "./scan-schema";

// Lectura con IA de estados de cuenta en fotos o escaneados. Netlify corta cada petición a los 60 s, así que no se lee
// todo de una vez: al subir se guardan las páginas (cifradas) y la app pide cada página por separado, con avance
// visible. Cuando todas terminan, la vista previa y la importación usan lo transcrito (sin volver a leer ni cobrar).
// Las páginas se borran en cuanto se leen; la transcripción, al importar o a las 12 horas.

const SCAN_TTL_MS = 12 * 60 * 60 * 1000;
/** Intentos por página (contando el primero) antes de darla por ilegible. */
export const MAX_PAGE_ATTEMPTS = 3;
/** Una lectura que lleva más que esto sin terminar se perdió (la función se cortó): otra petición la retoma. */
const STALE_READ_MS = 90_000;

export interface ScanUpload {
  fileName: string;
  files: ScanFile[];
}

/** Lee una página. Por defecto, la IA; las pruebas inyectan otro lector. */
export type ScanPageReader = (input: {
  userId: string;
  page: number;
  pages: number;
  mediaType: ScanMediaType;
  bytes: Uint8Array;
}) => Promise<{ result: ScanPageResult; model: string }>;

/** La IA transcribe la página (Claude primero; con el modelo más capaz, porque una cifra mal leída cuesta caro). */
export const readPageWithAI: ScanPageReader = async (input) => {
  const data = Buffer.from(input.bytes).toString("base64");
  const part: AIContentPart =
    input.mediaType === "application/pdf"
      ? { type: "file", mediaType: "application/pdf", data, filename: `pagina-${input.page}.pdf` }
      : { type: "image", mediaType: input.mediaType, data };
  const result = await generateStructured({
    schema: scanPageSchema,
    name: SCAN_TOOL_NAME,
    system: SCAN_SYSTEM_PROMPT,
    prompt: [part, { type: "text", text: scanPagePrompt(input.page, input.pages) }],
    tier: "smart",
    maxOutputTokens: 8_000,
    // Cada página va en su propia petición de 60 s.
    timeoutMs: 50_000,
    deadlineMs: 54_000,
    // Cuenta contra las páginas del plan solo si la lectura sirvió.
    usage: { userId: input.userId, module: "FINANCE", kind: "statement_page", logOn: "success" },
  });
  return { result: result.value, model: result.model };
};

const PAGE_FIELDS = { page: true, status: true, attempts: true, result: true, error: true } as const;
type PageRow = Prisma.StatementScanPageGetPayload<{ select: typeof PAGE_FIELDS }>;
type ScanRow = Prisma.StatementScanGetPayload<{ include: { pages: { select: typeof PAGE_FIELDS } } }>;

function rowsIn(result: unknown): number | null {
  const rows = (result as { rows?: unknown } | null)?.rows;
  return Array.isArray(rows) ? rows.length : null;
}

function pageView(page: PageRow): StatementScanPageView {
  return {
    page: page.page,
    status: page.status,
    rows: page.status === "DONE" ? rowsIn(page.result) : null,
    error: page.error,
    canRetry: page.status === "FAILED" && page.attempts < MAX_PAGE_ATTEMPTS,
  };
}

function scanView(scan: ScanRow): StatementScanView {
  const pages = [...scan.pages].sort((a, b) => a.page - b.page).map(pageView);
  return {
    id: scan.id,
    fileName: scan.fileName,
    source: scan.source === "pdf" ? "pdf" : "images",
    pageCount: scan.pageCount,
    pages,
    ready: pages.every((page) => page.status === "DONE" || page.status === "FAILED"),
    expiresAt: scan.expiresAt.toISOString(),
  };
}

function hashFiles(files: ScanFile[]): string {
  const hash = createHash("sha256");
  for (const file of files) {
    hash.update(`${file.bytes.byteLength}:`);
    hash.update(file.bytes);
  }
  return hash.digest("hex");
}

/** Lo que queda del cupo de páginas del mes; si no alcanza para `pages`, un 402 con la explicación. */
async function assertPagesLeft(userId: string, pages: number, now: Date): Promise<void> {
  const [entitlements, used] = await Promise.all([getEntitlements(userId, now), monthlyStatementPages(userId, now)]);
  const limit = entitlements.limits.monthlyStatementPages;
  const left = Math.max(0, limit - used);
  if (pages <= left) return;
  const free = entitlements.plan === "FREE";
  throw planLimitError(
    entitlements,
    "statement_pages",
    left === 0
      ? free
        ? `Usaste tus ${limit} páginas de estados de cuenta en foto de este mes. Pásate a Pro para leer más, o sube el PDF digital o el CSV de tu banco (esos no cuentan).`
        : `Usaste tus ${limit} páginas de estados de cuenta en foto de este mes. Se renuevan el día 1; mientras, sube el PDF digital o el CSV de tu banco.`
      : `Este documento tiene ${pages} páginas y te quedan ${left} este mes. Sube solo las páginas con movimientos${free ? " o pásate a Pro" : ""}.`,
    { limit },
  );
}

/** Borra las lecturas vencidas (de todos): las páginas cifradas y lo transcrito no se guardan más de 12 horas. */
export async function purgeExpiredScans(now = new Date()): Promise<number> {
  const { count } = await prisma.statementScan.deleteMany({ where: { expiresAt: { lt: now } } });
  return count;
}

/**
 * Guarda las páginas (cifradas) para leerlas una por una. Subir otra vez el mismo documento, sin vencer, retoma la
 * lectura anterior: no se vuelve a leer ni cuenta de nuevo contra el plan.
 */
export async function createScan(userId: string, upload: ScanUpload, now = new Date()): Promise<StatementScanView> {
  if (!aiConfigured()) {
    throw statementError(
      "scan_unavailable",
      "La lectura con IA no está disponible en este momento. Sube el estado de cuenta en PDF digital o CSV.",
    );
  }
  const document = await scanPagesFromFiles(upload.files);
  const fileHash = hashFiles(upload.files);
  await purgeExpiredScans(now).catch((error: unknown) => log.warn("finance.scan.purge_failed", { error }));

  const existing = await prisma.statementScan.findFirst({
    where: { userId, fileHash, expiresAt: { gt: now } },
    orderBy: { createdAt: "desc" },
    include: { pages: { select: PAGE_FIELDS } },
  });
  if (existing) return scanView(existing);

  await assertPagesLeft(userId, document.pages.length, now);
  const scan = await prisma.statementScan.create({
    data: {
      userId,
      fileName: upload.fileName,
      fileHash,
      source: document.source,
      pageCount: document.pages.length,
      expiresAt: new Date(now.getTime() + SCAN_TTL_MS),
      pages: {
        create: document.pages.map((page) => ({ page: page.page, mediaType: page.mediaType, data: encryptBytes(page.bytes) })),
      },
    },
    include: { pages: { select: PAGE_FIELDS } },
  });
  await audit({
    userId,
    actor: "user",
    action: "finance.statement.scan_started",
    entity: "statement_scan",
    entityId: scan.id,
    metadata: { pages: scan.pageCount, source: scan.source },
  });
  return scanView(scan);
}

async function ownScan(userId: string, scanId: string, now: Date) {
  const scan = isUuid(scanId)
    ? await prisma.statementScan.findFirst({ where: { id: scanId, userId }, include: { pages: { select: PAGE_FIELDS } } })
    : null;
  if (!scan || scan.expiresAt <= now) {
    throw statementError("scan_not_found", "Esa lectura ya no está disponible (vence a las 12 horas). Vuelve a subir el documento.");
  }
  return scan;
}

export async function getScan(userId: string, scanId: string, now = new Date()): Promise<StatementScanView> {
  return scanView(await ownScan(userId, scanId, now));
}

/** Descarta la lectura (al cerrar el diálogo sin importar). */
export async function deleteScan(userId: string, scanId: string): Promise<{ removed: boolean }> {
  if (!isUuid(scanId)) return { removed: false };
  const { count } = await prisma.statementScan.deleteMany({ where: { id: scanId, userId } });
  return { removed: count > 0 };
}

/** El mensaje para la persona cuando una página no se pudo leer. */
function failureMessage(error: unknown): string {
  if (error instanceof AppError) return error.message;
  if (isAIProviderError(error)) {
    if (error.code === "timeout") return "La lectura tardó demasiado. Vuelve a intentarlo; si se repite, sube una foto solo de la tabla de movimientos.";
    if (error.code === "invalid_request" || error.code === "context_too_long") return "La imagen no se pudo abrir. Tómale otra foto en JPG o PNG.";
    if (error.code === "content_blocked") return "La imagen no se pudo leer.";
    return aiErrorToHttp(error).message;
  }
  if (error instanceof StructuredOutputError) return "La lectura salió incompleta. Vuelve a intentarlo.";
  return "Algo falló al leerla. Vuelve a intentarlo.";
}

/**
 * Lee una página (idempotente). Si ya se leyó, la está leyendo otra petición o ya no le quedan intentos, devuelve su
 * estado sin hacer nada. Si falla, queda FAILED con el motivo y se puede reintentar hasta MAX_PAGE_ATTEMPTS veces.
 */
export async function readScanPage(
  userId: string,
  scanId: string,
  page: number,
  opts: { reader?: ScanPageReader; now?: Date } = {},
): Promise<StatementScanPageView> {
  const now = opts.now ?? new Date();
  const reader = opts.reader ?? readPageWithAI;
  const scan = await ownScan(userId, scanId, now);
  if (!Number.isInteger(page) || page < 1 || page > scan.pageCount) throw Errors.notFound("La página");
  const key = { scanId_page: { scanId: scan.id, page } };

  // Se toma la página si está pendiente, falló con intentos por delante o quedó colgada (la función se cortó).
  const claimed = await prisma.statementScanPage.updateMany({
    where: {
      scanId: scan.id,
      page,
      OR: [
        { status: "PENDING" },
        { status: "FAILED", attempts: { lt: MAX_PAGE_ATTEMPTS } },
        { status: "READING", startedAt: { lt: new Date(now.getTime() - STALE_READ_MS) } },
      ],
    },
    data: { status: "READING", startedAt: now, attempts: { increment: 1 }, error: null },
  });
  if (claimed.count === 0) {
    return pageView(await prisma.statementScanPage.findUniqueOrThrow({ where: key, select: PAGE_FIELDS }));
  }

  const row = await prisma.statementScanPage.findUniqueOrThrow({ where: key });
  try {
    // El cupo se revisa otra vez: pudo acabarse con otras lecturas desde que se subió el documento.
    await assertPagesLeft(userId, 1, now);
  } catch (error) {
    // Se suelta la página tal como estaba, para leerla si la persona se pasa a Pro.
    await prisma.statementScanPage.update({ where: key, data: { status: "PENDING", attempts: { decrement: 1 }, startedAt: null } });
    throw error;
  }

  const finalAttempt = row.attempts >= MAX_PAGE_ATTEMPTS;
  if (!row.data) {
    const saved = await prisma.statementScanPage.update({
      where: key,
      data: { status: "FAILED", attempts: MAX_PAGE_ATTEMPTS, error: "Esta página ya no está disponible. Vuelve a subir el documento." },
      select: PAGE_FIELDS,
    });
    return pageView(saved);
  }

  try {
    const { result, model } = await reader({
      userId,
      page,
      pages: scan.pageCount,
      mediaType: row.mediaType as ScanMediaType,
      bytes: decryptBytes(row.data),
    });
    const saved = await prisma.statementScanPage.update({
      where: key,
      // La página ya no hace falta: se borra en cuanto se lee.
      data: { status: "DONE", result: result as unknown as Prisma.InputJsonValue, model, error: null, data: null },
      select: PAGE_FIELDS,
    });
    return pageView(saved);
  } catch (error) {
    log.warn("finance.scan.page_failed", {
      scanId: scan.id,
      page,
      attempt: row.attempts,
      code: isAIProviderError(error) ? error.code : error instanceof Error ? error.name : "unknown",
    });
    const saved = await prisma.statementScanPage.update({
      where: key,
      // Sin más intentos, la página también se borra.
      data: { status: "FAILED", error: failureMessage(error), ...(finalAttempt ? { data: null } : {}) },
      select: PAGE_FIELDS,
    });
    return pageView(saved);
  }
}

/**
 * Lo transcrito, para la vista previa y la importación. Exige que todas las páginas hayan terminado (leídas o con
 * error): una página que falló cuenta como ilegible y la vista previa lo avisa.
 */
export async function loadScanTranscription(
  userId: string,
  scanId: string,
  now = new Date(),
): Promise<{ fileName: string; pageCount: number; transcription: ScanTranscription }> {
  const scan = await ownScan(userId, scanId, now);
  const pending = scan.pages.filter((page) => page.status === "PENDING" || page.status === "READING");
  if (pending.length > 0) {
    throw statementError("scan_pending", "Todavía estoy leyendo el documento. Espera a que terminen todas las páginas.", {
      pending: pending.map((page) => page.page),
    });
  }
  const pages = [...scan.pages]
    .sort((a, b) => a.page - b.page)
    .map((page) => {
      if (page.status !== "DONE") return { page: page.page, result: null };
      // Lo guardado salió de este mismo esquema; se valida otra vez por si cambió desde entonces.
      const parsed = scanPageSchema.safeParse(page.result);
      return { page: page.page, result: parsed.success ? parsed.data : null };
    });
  return { fileName: scan.fileName, pageCount: scan.pageCount, transcription: { pages } };
}
