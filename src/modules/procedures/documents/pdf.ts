import "server-only";
import path from "node:path";
import {
  PDFCheckBox,
  PDFDocument,
  PDFDropdown,
  PDFOptionList,
  PDFRadioGroup,
  PDFSignature,
  PDFTextField,
  StandardFonts,
  type PDFField,
  type PDFFont,
} from "pdf-lib";
import { Errors } from "@/lib/errors";
import type { PdfField, PdfFieldKind, PdfInspection, PdfRect } from "./pdf-types";

// Lectura de formularios PDF:
// - Campos AcroForm (rellenables) con pdf-lib, y su etiqueta visible buscada con las posiciones de texto de pdf.js
//   (muchos formularios reales se llaman "Text1", "Text2"...).
// - Formularios planos: se detectan las líneas "_____" y las casillas "[ ]" para escribir encima.

interface TextItem {
  page: number;
  str: string;
  x: number;
  y: number;
  width: number;
  size: number;
}

const MAX_PAGES = 20;

async function extractText(bytes: Uint8Array): Promise<{ items: TextItem[]; pages: { width: number; height: number }[] }> {
  // pdf.js se carga solo en el servidor y solo cuando hace falta (es grande).
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const standardFontDataUrl = `${path.join(process.cwd(), "node_modules/pdfjs-dist/standard_fonts")}/`;
  const task = pdfjs.getDocument({
    data: bytes.slice(),
    useSystemFonts: false,
    disableFontFace: true,
    standardFontDataUrl,
    verbosity: 0,
  });
  const doc = await task.promise;
  try {
    const items: TextItem[] = [];
    const pages: { width: number; height: number }[] = [];
    for (let n = 1; n <= Math.min(doc.numPages, MAX_PAGES); n++) {
      const page = await doc.getPage(n);
      const viewport = page.getViewport({ scale: 1 });
      pages.push({ width: viewport.width, height: viewport.height });
      const content = await page.getTextContent();
      for (const raw of content.items) {
        if (!("str" in raw) || !raw.str.trim()) continue;
        const [a, b, , , x, y] = raw.transform as number[];
        items.push({ page: n, str: raw.str, x, y, width: raw.width, size: Math.hypot(a, b) || raw.height || 10 });
      }
    }
    return { items, pages };
  } finally {
    await doc.destroy();
  }
}

/**
 * pdf.js corta el texto donde hay mucho espacio ("[" y "] Declaro…", "Nombre:" y "______").
 * Se vuelven a unir los trozos cercanos de una misma línea; los campos separados (más de ~1.5 letras) no se tocan.
 */
function mergeLineItems(items: TextItem[]): TextItem[] {
  const sorted = [...items].sort((a, b) => a.page - b.page || b.y - a.y || a.x - b.x);
  const out: TextItem[] = [];
  for (const item of sorted) {
    const prev = out[out.length - 1];
    const gap = prev ? item.x - (prev.x + prev.width) : Infinity;
    if (prev && prev.page === item.page && Math.abs(prev.y - item.y) < 0.8 && gap >= -1 && gap < prev.size * 1.5) {
      const spaces = Math.max(1, Math.round(gap / (prev.size * 0.28)));
      out[out.length - 1] = { ...prev, str: `${prev.str}${" ".repeat(spaces)}${item.str}`, width: item.x + item.width - prev.x };
    } else {
      out.push({ ...item });
    }
  }
  return out;
}

function cleanLabel(text: string): string {
  return text
    .replace(/_{2,}/g, " ")
    .replace(/^\[\s*\]\s*/, "")
    .replace(/[:\s]+$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function kindFromLabel(base: PdfFieldKind, label: string | null, name: string): PdfFieldKind {
  const text = `${label ?? ""} ${name}`.toLowerCase();
  if (base === "text" && /(firma|signature)/.test(text)) return "signature";
  if (base === "text" && /^fecha\b|\bfecha(:|$)|fecha de (hoy|firma|la solicitud|entrega)/.test((label ?? "").toLowerCase())) return "date";
  return base;
}

/** Etiqueta visible más cercana a un campo: a la izquierda en la misma línea, arriba o (casillas) a la derecha. */
function nearestLabel(rect: PdfRect, page: number, kind: PdfFieldKind, items: TextItem[]): string | null {
  const onPage = items.filter((i) => i.page === page);
  const cy = rect.y + rect.height / 2;
  const sameLine = onPage.filter((i) => Math.abs(i.y + i.size * 0.35 - cy) <= Math.max(rect.height, i.size) * 0.8);

  if (kind === "checkbox") {
    const right = sameLine.filter((i) => i.x >= rect.x + rect.width - 2).sort((a, b) => a.x - b.x)[0];
    if (right) {
      // La frase puede seguir en la línea de abajo ("... y acepto el pago del transporte.").
      const next = onPage.find((i) => Math.abs(i.x - right.x) < 4 && right.y - i.y > 4 && right.y - i.y < i.size * 1.8);
      return cleanLabel(next ? `${right.str} ${next.str}` : right.str);
    }
  }
  const left = sameLine
    .filter((i) => i.x + i.width <= rect.x + 6 && rect.x - (i.x + i.width) < 260)
    .sort((a, b) => rect.x - (a.x + a.width) - (rect.x - (b.x + b.width)))[0];
  if (left) return cleanLabel(left.str);
  const above = onPage
    .filter((i) => i.y > rect.y + rect.height - 2 && i.y - (rect.y + rect.height) < 26 && i.x < rect.x + rect.width && i.x + i.width > rect.x - 20)
    .sort((a, b) => a.y - b.y)[0];
  return above ? cleanLabel(above.str) : null;
}

function pageIndexOf(doc: PDFDocument, field: PDFField): { index: number; rect: PdfRect } | null {
  const widget = field.acroField.getWidgets()[0];
  if (!widget) return null;
  const r = widget.getRectangle();
  const pages = doc.getPages();
  const pageRef = widget.P();
  let index = pageRef ? pages.findIndex((p) => p.ref === pageRef) : -1;
  if (index < 0) {
    const widgetRef = doc.context.getObjectRef(widget.dict);
    index = pages.findIndex((p) => p.node.Annots()?.asArray().some((a) => a === widgetRef) ?? false);
  }
  return { index: Math.max(0, index), rect: { x: r.x, y: r.y, width: r.width, height: r.height } };
}

function acroFields(doc: PDFDocument, items: TextItem[]): PdfField[] {
  let form;
  try {
    form = doc.getForm();
  } catch {
    return [];
  }
  const out: PdfField[] = [];
  for (const field of form.getFields()) {
    let base: PdfFieldKind | null = null;
    let options: string[] | undefined;
    let currentValue: string | null = null;
    let maxLength: number | null = null;
    let multiline = false;
    if (field instanceof PDFTextField) {
      base = "text";
      currentValue = field.getText() ?? null;
      maxLength = field.getMaxLength() ?? null;
      multiline = field.isMultiline();
    } else if (field instanceof PDFCheckBox) {
      base = "checkbox";
      currentValue = field.isChecked() ? "true" : null;
    } else if (field instanceof PDFRadioGroup) {
      base = "radio";
      options = field.getOptions();
      currentValue = field.getSelected() ?? null;
    } else if (field instanceof PDFDropdown || field instanceof PDFOptionList) {
      base = "dropdown";
      options = field.getOptions();
      currentValue = field.getSelected()[0] ?? null;
    } else if (field instanceof PDFSignature) {
      base = "signature";
    }
    if (!base) continue;
    const where = pageIndexOf(doc, field);
    if (!where) continue;
    const label = nearestLabel(where.rect, where.index + 1, base, items);
    out.push({
      id: "",
      name: field.getName(),
      kind: kindFromLabel(base, label, field.getName()),
      source: "acroform",
      page: where.index + 1,
      rect: where.rect,
      label,
      options,
      maxLength,
      multiline,
      currentValue,
      fontSize: null,
    });
  }
  return out;
}

/** Formularios planos: "Etiqueta: ______" y casillas "[ ]". */
function flatFields(items: TextItem[], measure: PDFFont): PdfField[] {
  const out: PdfField[] = [];
  for (const item of items) {
    const box = /^\s*(\[\s*\]|☐|□)\s*/.exec(item.str);
    if (box) {
      const label = cleanLabel(item.str.slice(box[0].length));
      out.push({
        id: "",
        name: `flat:${item.page}:${Math.round(item.x)}:${Math.round(item.y)}:box`,
        kind: "checkbox",
        source: "flat",
        page: item.page,
        rect: { x: item.x + 1, y: item.y - 1, width: Math.max(8, measure.widthOfTextAtSize(box[1], item.size)), height: item.size },
        label: label || null,
        maxLength: null,
        multiline: false,
        currentValue: null,
        fontSize: item.size,
      });
      continue;
    }
    const scale = item.width > 0 ? item.width / Math.max(1, measure.widthOfTextAtSize(item.str, item.size)) : 1;
    let cursor = 0;
    for (const run of item.str.matchAll(/_{3,}/g)) {
      const start = run.index ?? 0;
      const labelText = item.str.slice(cursor, start);
      const x = item.x + measure.widthOfTextAtSize(item.str.slice(0, start), item.size) * scale;
      const width = measure.widthOfTextAtSize(run[0], item.size) * scale;
      cursor = start + run[0].length;
      const label = cleanLabel(labelText) || null;
      out.push({
        id: "",
        name: `flat:${item.page}:${Math.round(x)}:${Math.round(item.y)}`,
        kind: kindFromLabel("text", label, ""),
        source: "flat",
        page: item.page,
        rect: { x, y: item.y, width, height: item.size + 3 },
        label,
        maxLength: null,
        multiline: false,
        currentValue: null,
        fontSize: item.size,
      });
    }
  }
  return out;
}

/** Texto en orden de lectura (para el prompt y como respaldo cuando no hay IA). */
function readingText(items: TextItem[]): string {
  return [...items]
    .sort((a, b) => a.page - b.page || b.y - a.y || a.x - b.x)
    .reduce<{ text: string; last: TextItem | null }>(
      (acc, item) => {
        const newLine = !acc.last || acc.last.page !== item.page || Math.abs(acc.last.y - item.y) > 3;
        return { text: acc.text + (acc.last ? (newLine ? "\n" : "  ") : "") + item.str, last: item };
      },
      { text: "", last: null },
    ).text;
}

export async function inspectPdf(bytes: Uint8Array): Promise<PdfInspection> {
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes, { ignoreEncryption: false, updateMetadata: false });
  } catch {
    throw Errors.badRequest("No pude abrir el PDF. Puede estar dañado o protegido con contraseña.");
  }
  if (doc.getPageCount() > MAX_PAGES) throw Errors.badRequest(`El PDF tiene más de ${MAX_PAGES} páginas.`);
  const extracted = await extractText(bytes);
  const items = mergeLineItems(extracted.items);
  const pages = extracted.pages;
  const measureDoc = await PDFDocument.create();
  const measure = await measureDoc.embedFont(StandardFonts.Helvetica);

  const acro = acroFields(doc, items);
  const fields = acro.length > 0 ? acro : flatFields(items, measure);
  fields
    .sort((a, b) => a.page - b.page || b.rect.y - a.rect.y || a.rect.x - b.rect.x)
    .forEach((field, i) => {
      field.id = `f${i + 1}`;
    });

  return {
    pageCount: doc.getPageCount(),
    pages,
    hasAcroForm: acro.length > 0,
    fields,
    text: readingText(items).slice(0, 6000),
    title: doc.getTitle() ?? null,
  };
}
