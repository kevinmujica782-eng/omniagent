import "server-only";
import { z } from "zod";
import type { Prisma, UserDocument } from "@/generated/prisma/client";
import type { DocumentKind } from "@/generated/prisma/enums";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { Errors } from "@/lib/errors";
import { firstName } from "@/lib/format";
import { isUuid } from "@/lib/validation";
import { proposeAction } from "@/modules/actions/actions.service";
import { aiConfigured, generateStructured, tierForPlan } from "@/modules/ai/ai.service";
import { getEntitlements, monthlyFormReads } from "@/modules/billing/entitlements";
import type { AIProviderId, AITier } from "@/types/ai";
import type { ApprovalCard, FormCard, FormDocumentView, FormExtractionView } from "@/types/cards";
import {
  FORM_SYSTEM_PROMPT,
  FORM_TOOL_NAME,
  buildFormPrompt,
  draftExtraction,
  extractWithRules,
  formSchema,
  type FormOutput,
  type MailContext,
} from "./extract";
import { fillPdf, type FillValue } from "./fill";
import { inspectPdf } from "./pdf";
import type { PdfInspection } from "./pdf-types";
import { loadPersonalRecords, upsertPersonalFields } from "./personal-data.service";
import { activeStorageDriver, deleteObject, getObject, putObject, safeFileName, type StorageDriver } from "./storage";

// Documentos del módulo de trámites: guardar PDFs (adjuntos o subidos), leer sus campos con IA (router de IA: el
// PDF completo va al proveedor, Claude primero) o con reglas, rellenarlos con los datos del usuario y preparar la
// respuesta con el PDF adjunto.

type TemplateData = {
  version: 1;
  inspection: PdfInspection;
  extraction: FormExtractionView;
  model: string | null;
  note: string | null;
};

type FilledData = { filledFrom: string; values: Record<string, string>; filledAt: string; signed: boolean };

export async function storeDocument(
  userId: string,
  input: { fileName: string; mimeType: string; bytes: Uint8Array; kind: DocumentKind; source: "upload" | "email" | "generated"; taskId?: string | null; parentId?: string | null },
): Promise<UserDocument> {
  const driver: StorageDriver = activeStorageDriver();
  const fileName = safeFileName(input.fileName);
  const doc = await prisma.userDocument.create({
    data: {
      userId,
      taskId: input.taskId ?? null,
      parentId: input.parentId ?? null,
      kind: input.kind,
      fileName,
      mimeType: input.mimeType,
      sizeBytes: input.bytes.byteLength,
      source: input.source,
      storageDriver: driver,
      storagePath: "pendiente",
    },
  });
  const path = `${userId}/${doc.id}/${fileName}`;
  try {
    await putObject(driver, { documentId: doc.id, path, bytes: input.bytes, mimeType: input.mimeType });
  } catch (error) {
    await prisma.userDocument.delete({ where: { id: doc.id } }).catch(() => undefined);
    throw error;
  }
  return prisma.userDocument.update({ where: { id: doc.id }, data: { storagePath: path } });
}

async function ownDocument(userId: string, documentId: string): Promise<UserDocument> {
  if (!isUuid(documentId)) throw Errors.notFound("El documento");
  const doc = await prisma.userDocument.findFirst({ where: { id: documentId, userId } });
  if (!doc) throw Errors.notFound("El documento");
  return doc;
}

export async function getDocumentFile(userId: string, documentId: string) {
  const doc = await ownDocument(userId, documentId);
  const bytes = await getObject(doc.storageDriver as StorageDriver, { documentId: doc.id, path: doc.storagePath });
  return { bytes, fileName: doc.fileName, mimeType: doc.mimeType };
}

export async function deleteDocument(userId: string, documentId: string) {
  const doc = await ownDocument(userId, documentId);
  await deleteObject(doc.storageDriver as StorageDriver, { documentId: doc.id, path: doc.storagePath });
  await prisma.userDocument.delete({ where: { id: doc.id } });
  return { removed: true };
}

/** Correo con el que llegó el documento (contexto para el llenado y para responder). */
async function mailContextFor(doc: UserDocument): Promise<{ context: MailContext; replyTo: string | null; message: { id: string; subject: string; connectionId: string } } | null> {
  const attachment = await prisma.mailAttachment.findFirst({
    where: { documentId: doc.parentId ?? doc.id },
    include: { message: true },
  });
  const message =
    attachment?.message ??
    (doc.taskId
      ? await prisma.mailMessage.findFirst({ where: { tasks: { some: { id: doc.taskId } } } })
      : null);
  if (!message) return null;
  const task = doc.taskId ? await prisma.task.findFirst({ where: { id: doc.taskId }, select: { metadata: true } }) : null;
  const replyTo = (task?.metadata as { replyTo?: string | null } | null)?.replyTo ?? message.fromEmail;
  return {
    context: {
      subject: message.subject,
      from: message.fromName ?? message.fromEmail,
      fromEmail: message.fromEmail,
      receivedAt: message.receivedAt,
      bodyText: message.bodyText,
    },
    replyTo,
    message: { id: message.id, subject: message.subject, connectionId: message.connectionId },
  };
}

/** El PDF completo y las indicaciones a la IA (solo proveedores que leen PDF). Lanza si falla o no pasa la validación. */
async function extractWithAI(
  userId: string,
  bytes: Uint8Array,
  fileName: string,
  prompt: string,
  tier: AITier,
): Promise<{ output: FormOutput; provider: AIProviderId; model: string }> {
  const result = await generateStructured({
    schema: formSchema,
    name: FORM_TOOL_NAME,
    system: FORM_SYSTEM_PROMPT,
    prompt: [
      { type: "file", mediaType: "application/pdf", data: Buffer.from(bytes).toString("base64"), filename: fileName },
      { type: "text", text: prompt },
    ],
    tier,
    maxOutputTokens: 4000,
    // Cuenta contra las lecturas con IA del plan: solo si la lectura sirvió (como antes).
    usage: { userId, module: "PROCEDURES", kind: "document", logOn: "success" },
  });
  return { output: result.value, provider: result.provider, model: result.model };
}

async function latestCopy(documentId: string) {
  return prisma.userDocument.findFirst({
    where: { parentId: documentId, kind: "FILLED_FORM" },
    orderBy: { createdAt: "desc" },
    select: { id: true, createdAt: true, fileName: true },
  });
}

/**
 * Lee el formulario y propone valores. Con IA si hay clave y cupo del plan (Claude lee el PDF completo);
 * si no, con reglas. `preferAI` vuelve a leer con IA un documento que antes se leyó con reglas.
 */
export async function extractForm(userId: string, documentId: string, opts: { preferAI?: boolean; force?: boolean } = {}): Promise<FormExtractionView> {
  const doc = await ownDocument(userId, documentId);
  if (doc.kind === "FILLED_FORM" && doc.parentId) return extractForm(userId, doc.parentId, opts);
  if (doc.mimeType !== "application/pdf") throw Errors.badRequest("Por ahora solo leo formularios en PDF.");

  const stored = doc.extractedData as unknown as TemplateData | null;
  const wantsAI = opts.preferAI && aiConfigured();
  if (stored?.version === 1 && !opts.force && !(wantsAI && stored.extraction.source === "RULES" && stored.note === null)) {
    return withCopy(stored.extraction, documentId, stored.note);
  }

  const [bytes, records, mail, profile, entitlements] = await Promise.all([
    getObject(doc.storageDriver as StorageDriver, { documentId: doc.id, path: doc.storagePath }),
    loadPersonalRecords(userId),
    mailContextFor(doc),
    prisma.profile.findUnique({ where: { id: userId }, select: { timezone: true } }),
    getEntitlements(userId),
  ]);
  const timeZone = profile?.timezone ?? "UTC";
  const inspection = stored?.inspection ?? (await inspectPdf(bytes));
  if (inspection.fields.length === 0) {
    throw Errors.badRequest("No encontré campos para llenar en este PDF. Si es un documento escaneado, pídeme ayuda en el chat.");
  }
  const now = new Date();
  const meta = {
    documentId: doc.id,
    fileName: doc.fileName,
    taskId: doc.taskId,
    mail: mail ? { subject: mail.context.subject, from: mail.context.from, replyTo: mail.replyTo } : null,
  };

  let output = extractWithRules({ inspection, records, mail: mail?.context ?? null, now, timeZone, fileName: doc.fileName });
  let source: "AI" | "RULES" = "RULES";
  let model: string | null = null;
  let note: string | null = null;

  if (wantsAI) {
    const used = await monthlyFormReads(userId);
    if (used >= entitlements.limits.monthlyFormReads) {
      note = `Usaste tus ${entitlements.limits.monthlyFormReads} lecturas con IA de este mes; lo llené con reglas.`;
    } else {
      try {
        const prompt = buildFormPrompt({ inspection, records, mail: mail?.context ?? null, now, timeZone });
        const result = await extractWithAI(userId, bytes, doc.fileName, prompt, tierForPlan(entitlements.plan));
        output = result.output;
        source = "AI";
        model = result.model;
      } catch (error) {
        console.error("[documents] la lectura con IA falló; se usan reglas", error);
        note = "La lectura con IA falló; lo llené con reglas.";
      }
    }
  }

  const extraction = draftExtraction(output, inspection, records, { ...meta, source });
  const data: TemplateData = { version: 1, inspection, extraction, model, note };
  await prisma.userDocument.update({
    where: { id: doc.id },
    data: { extractedData: data as unknown as Prisma.InputJsonValue, extractedAt: now, kind: doc.kind === "OTHER" ? "FORM_TEMPLATE" : doc.kind },
  });
  await audit({ userId, actor: "agent", action: "document.extracted", entity: "document", entityId: doc.id, metadata: { source, fields: inspection.fields.length } });
  return withCopy(extraction, documentId, note);
}

async function withCopy(extraction: FormExtractionView, documentId: string, note: string | null = null): Promise<FormExtractionView> {
  const copy = await latestCopy(documentId);
  return { ...extraction, filledDocumentId: copy?.id ?? null, filledAt: copy?.createdAt.toISOString() ?? null, note };
}

/**
 * Lo que ya se leyó del formulario, sin volver a leerlo. `aiPending`: todavía no se intentó con IA
 * (la pantalla de revisión la pide al abrirse, mostrando mientras tanto la versión por reglas).
 */
export async function storedExtraction(userId: string, documentId: string): Promise<{ extraction: FormExtractionView | null; aiPending: boolean; templateId: string }> {
  const doc = await ownDocument(userId, documentId);
  const template = doc.kind === "FILLED_FORM" && doc.parentId ? await ownDocument(userId, doc.parentId) : doc;
  if (template.mimeType !== "application/pdf") throw Errors.badRequest("Por ahora solo leo formularios en PDF.");
  const stored = template.extractedData as unknown as TemplateData | null;
  if (stored?.version !== 1) return { extraction: null, aiPending: true, templateId: template.id };
  return {
    extraction: await withCopy(stored.extraction, template.id, stored.note),
    aiPending: stored.extraction.source === "RULES" && stored.note === null,
    templateId: template.id,
  };
}

/** Un PDF de verdad empieza con "%PDF-" (a veces tras unos bytes de basura). */
function looksLikePdf(bytes: Uint8Array): boolean {
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, 1024));
  return head.includes("%PDF-");
}

/** Formulario subido por el usuario (no llegó por correo). */
export async function uploadForm(userId: string, input: { fileName: string; bytes: Uint8Array; taskId?: string | null }) {
  if (!looksLikePdf(input.bytes)) throw Errors.badRequest("El archivo no es un PDF.");
  const task = input.taskId && isUuid(input.taskId)
    ? await prisma.task.findFirst({ where: { id: input.taskId, userId }, select: { id: true } })
    : null;
  const base = input.fileName.replace(/\.pdf$/i, "").trim() || "formulario";
  const doc = await storeDocument(userId, {
    fileName: `${base}.pdf`,
    mimeType: "application/pdf",
    bytes: input.bytes,
    kind: "FORM_TEMPLATE",
    source: "upload",
    taskId: task?.id ?? null,
  });
  await audit({ userId, actor: "user", action: "document.uploaded", entity: "document", entityId: doc.id, metadata: { size: input.bytes.byteLength } });
  return { documentId: doc.id, fileName: doc.fileName };
}

/** Formularios del usuario (adjuntos y subidos) con su estado de lectura y llenado. */
export async function listFormDocuments(userId: string, take = 20): Promise<FormDocumentView[]> {
  const docs = await prisma.userDocument.findMany({
    where: { userId, kind: "FORM_TEMPLATE" },
    orderBy: { createdAt: "desc" },
    take,
    select: {
      id: true,
      fileName: true,
      source: true,
      createdAt: true,
      taskId: true,
      extractedData: true,
      task: { select: { title: true } },
      copies: { where: { kind: "FILLED_FORM" }, orderBy: { createdAt: "desc" }, take: 1, select: { id: true, fileName: true, createdAt: true } },
    },
  });
  return docs.map((doc) => {
    const data = doc.extractedData as unknown as TemplateData | null;
    const extraction = data?.version === 1 ? data.extraction : null;
    const fillable = extraction?.fields.filter((f) => f.kind !== "signature") ?? null;
    const copy = doc.copies[0] ?? null;
    return {
      id: doc.id,
      fileName: doc.fileName,
      source: doc.source === "email" ? "email" : doc.source === "generated" ? "generated" : "upload",
      createdAt: doc.createdAt.toISOString(),
      taskId: doc.taskId,
      taskTitle: doc.task?.title ?? null,
      title: extraction?.title ?? null,
      extracted: extraction !== null,
      readWithAI: extraction?.source === "AI",
      totalFields: fillable?.length ?? null,
      missingCount: fillable ? fillable.filter((f) => f.value === null).length : null,
      filledDocumentId: copy?.id ?? null,
      filledFileName: copy?.fileName ?? null,
      filledAt: copy?.createdAt.toISOString() ?? null,
    };
  });
}

/** Resumen para el chat y para la lista de documentos del trámite. */
export function toFormCard(extraction: FormExtractionView, dueAt: string | null = null): FormCard {
  const fillable = extraction.fields.filter((f) => f.kind !== "signature");
  const missing = extraction.fields.filter((f) => f.value === null && f.kind !== "signature");
  return {
    kind: "form",
    documentId: extraction.documentId,
    fileName: extraction.fileName,
    title: extraction.title,
    summary: extraction.summary,
    totalFields: fillable.length,
    filledFields: fillable.length - missing.length,
    missingFields: missing.map((f) => f.label).slice(0, 6),
    requiresSignature: extraction.requiresSignature,
    filledDocumentId: extraction.filledDocumentId,
    dueAt,
  };
}

const valuesSchema = z.record(z.string().max(10), z.union([z.string().max(500), z.boolean(), z.null()]));

/** Genera la copia rellenada con los valores que el usuario revisó. Opcionalmente guarda los datos nuevos. */
export async function fillForm(
  userId: string,
  documentId: string,
  input: { values: Record<string, FillValue>; saveToProfile: boolean },
): Promise<{ documentId: string; fileName: string; missingRequired: string[]; taskId: string | null; signed: boolean }> {
  const doc = await ownDocument(userId, documentId);
  const template = doc.kind === "FILLED_FORM" && doc.parentId ? await ownDocument(userId, doc.parentId) : doc;
  let stored = template.extractedData as unknown as TemplateData | null;
  if (stored?.version !== 1) {
    await extractForm(userId, template.id);
    stored = (await ownDocument(userId, template.id)).extractedData as unknown as TemplateData;
  }
  const values = valuesSchema.parse(input.values);
  const fields = stored.inspection.fields;
  const known = new Set(fields.map((f) => f.id));
  const clean: Record<string, FillValue> = Object.fromEntries(Object.entries(values).filter(([id]) => known.has(id)));

  const bytes = await getObject(template.storageDriver as StorageDriver, { documentId: template.id, path: template.storagePath });
  const filledBytes = await fillPdf(bytes, fields, clean);
  const base = template.fileName.replace(/\.pdf$/i, "");
  const copy = await storeDocument(userId, {
    fileName: `${base}_lleno.pdf`,
    mimeType: "application/pdf",
    bytes: filledBytes,
    kind: "FILLED_FORM",
    source: "generated",
    taskId: template.taskId,
    parentId: template.id,
  });

  const signatureIds = new Set(fields.filter((f) => f.kind === "signature").map((f) => f.id));
  const signed = [...signatureIds].some((id) => typeof clean[id] === "string" && String(clean[id]).trim().length > 0);
  const storedValues = Object.fromEntries(
    Object.entries(clean)
      .filter(([, v]) => v !== null && v !== undefined && v !== "")
      .map(([k, v]) => [k, String(v)]),
  );
  const filledData: FilledData = { filledFrom: template.id, values: storedValues, filledAt: new Date().toISOString(), signed };
  await prisma.userDocument.update({ where: { id: copy.id }, data: { extractedData: filledData as unknown as Prisma.InputJsonValue } });

  // Guardar en Mis datos lo que el usuario escribió (nombres, teléfonos, grado...), nunca firmas ni casillas.
  if (input.saveToProfile) {
    const byPerson = new Map<string, { key: string; value: string; label: string }[]>();
    for (const field of stored.extraction.fields) {
      const value = clean[field.id];
      if (!field.profileKey || typeof value !== "string" || !value.trim() || field.kind === "signature" || field.kind === "checkbox") continue;
      if (field.source === "fecha_de_hoy" || (field.kind === "date" && field.profileKey.key !== "birth_date")) continue;
      const list = byPerson.get(field.profileKey.person) ?? [];
      list.push({ key: field.profileKey.key, value: value.trim(), label: "" });
      byPerson.set(field.profileKey.person, list);
    }
    const records = await loadPersonalRecords(userId);
    for (const [person, list] of byPerson) {
      const current = records.find((r) => r.person === person)?.values ?? {};
      const changed = list.filter((f) => current[f.key] !== f.value).map(({ key, value }) => ({ key, value }));
      if (changed.length) await upsertPersonalFields(userId, { person, fields: changed, source: "form" });
    }
  }

  await audit({ userId, actor: "user", action: "document.filled", entity: "document", entityId: copy.id, metadata: { signed } });

  const missingRequired = stored.extraction.fields
    .filter((f) => f.required && f.kind !== "signature" && (clean[f.id] === undefined || clean[f.id] === null || clean[f.id] === "" || clean[f.id] === false))
    .map((f) => f.label);
  // El estado del trámite lo actualiza plan.ts (noteFormFilled) para no mezclar responsabilidades.
  return { documentId: copy.id, fileName: copy.fileName, missingRequired, taskId: template.taskId, signed };
}

/** Prepara la respuesta al remitente con el PDF rellenado (queda en Aprobaciones). */
export async function proposeFormReply(userId: string, filledDocumentId: string, opts: { conversationId?: string | null } = {}): Promise<ApprovalCard> {
  const doc = await ownDocument(userId, filledDocumentId);
  if (doc.kind !== "FILLED_FORM" || !doc.parentId) throw Errors.badRequest("Primero rellena el formulario.");
  const template = await ownDocument(userId, doc.parentId);
  const mail = await mailContextFor(template);
  if (!mail?.replyTo) throw Errors.badRequest("Este formulario no llegó por correo: descárgalo y envíalo tú.");

  const [profile, stored] = await Promise.all([
    prisma.profile.findUnique({ where: { id: userId }, select: { fullName: true } }),
    Promise.resolve(template.extractedData as unknown as TemplateData | null),
  ]);
  const filled = doc.extractedData as unknown as FilledData | null;
  const needsSignature = Boolean(stored?.extraction.requiresSignature) && !filled?.signed;
  const greetingName = firstName(mail.context.from.replace(/[·|].*$/, "").trim());
  const subject = /^re:/i.test(mail.message.subject) ? mail.message.subject : `Re: ${mail.message.subject}`;
  const what = stored?.extraction.docType === "permiso" ? "el permiso" : "el formulario";
  const body = [
    `Hola${greetingName && !/[@.]/.test(greetingName) ? `, ${greetingName}` : ""}:`,
    "",
    `Adjunto ${what} con los datos completos${filled?.signed ? " y firmado" : ""}.`,
    "",
    "Saludos,",
    profile?.fullName ?? "",
  ]
    .join("\n")
    .trim();

  return proposeAction({
    userId,
    conversationId: opts.conversationId ?? null,
    module: "PROCEDURES",
    type: "SEND_EMAIL",
    title: subject,
    summary: needsSignature ? "El PDF va sin firma: fírmalo antes si el remitente la pide." : null,
    lines: [
      { label: "Para", value: mail.replyTo },
      { label: "Adjunto", value: doc.fileName },
      { label: "Mensaje", value: body },
    ],
    payload: {
      to: mail.replyTo,
      subject,
      body,
      taskId: template.taskId,
      attachmentDocumentId: doc.id,
      replyToMessageId: mail.message.id,
      connectionId: mail.message.connectionId,
    },
  });
}

/** Documentos de un trámite con su estado (leído, rellenado). */
export async function documentsForTasks(userId: string, taskIds: string[]) {
  if (taskIds.length === 0) return new Map<string, { id: string; fileName: string; extracted: boolean; missingCount: number | null; filledDocumentId: string | null; filledFileName: string | null }[]>();
  const docs = await prisma.userDocument.findMany({
    where: { userId, taskId: { in: taskIds } },
    orderBy: { createdAt: "asc" },
    select: { id: true, taskId: true, kind: true, fileName: true, parentId: true, extractedData: true, createdAt: true },
  });
  const map = new Map<string, { id: string; fileName: string; extracted: boolean; missingCount: number | null; filledDocumentId: string | null; filledFileName: string | null }[]>();
  for (const doc of docs) {
    if (!doc.taskId || doc.kind === "FILLED_FORM") continue;
    const data = doc.extractedData as unknown as TemplateData | null;
    const copies = docs.filter((d) => d.parentId === doc.id).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const list = map.get(doc.taskId) ?? [];
    list.push({
      id: doc.id,
      fileName: doc.fileName,
      extracted: data?.version === 1,
      missingCount: data?.version === 1 ? data.extraction.fields.filter((f) => f.value === null && f.kind !== "signature").length : null,
      filledDocumentId: copies[0]?.id ?? null,
      filledFileName: copies[0]?.fileName ?? null,
    });
    map.set(doc.taskId, list);
  }
  return map;
}
