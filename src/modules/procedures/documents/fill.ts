import "server-only";
import {
  PDFCheckBox,
  PDFDocument,
  PDFDropdown,
  PDFOptionList,
  PDFRadioGroup,
  PDFTextField,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFPage,
} from "pdf-lib";
import type { PdfField } from "./pdf-types";

// Llenado de formularios con pdf-lib. Los rellenables quedan editables (el usuario puede corregir o firmar
// en su visor); en los planos se escribe sobre la línea. Nunca se firma por el usuario: la firma solo se escribe
// si él mismo la tecleó en la revisión.

const INK = rgb(0.05, 0.1, 0.35);

/** Caracteres que la fuente estándar (WinAnsi) puede dibujar: el resto se simplifica. */
const WIN_ANSI_EXTRA = new Set("€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ");

export function toWinAnsi(text: string): string {
  const replaced = text
    .replace(/[‘’‚]/g, "'")
    .replace(/[“”„]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/[   ]/g, " ")
    .replace(/[\r\t]/g, " ");
  let out = "";
  for (const ch of replaced) {
    const code = ch.codePointAt(0) ?? 0;
    if ((code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff) || ch === "\n" || WIN_ANSI_EXTRA.has(ch)) {
      out += ch;
      continue;
    }
    // Letras con tildes raras se simplifican ("ł" → "l" no aplica, "ă" → "a"); símbolos y emojis se omiten.
    const base = ch.normalize("NFD").replace(/[̀-ͯ]/g, "");
    if (base && [...base].every((c) => (c.codePointAt(0) ?? 0) <= 0xff)) out += base;
  }
  return out;
}

function truthy(value: string | boolean): boolean {
  if (typeof value === "boolean") return value;
  return /^(true|s[ií]|si|yes|x|1|on|marcar|marcado)$/i.test(value.trim());
}

function pickOption(options: string[] | undefined, value: string): string | null {
  if (!options?.length) return null;
  const wanted = value.trim().toLowerCase();
  return options.find((o) => o.toLowerCase() === wanted) ?? options.find((o) => o.toLowerCase().includes(wanted)) ?? null;
}

/** Texto que entra en el ancho disponible: reduce la letra hasta 7 pt y, si aún no cabe, recorta. */
function fitText(text: string, font: PDFFont, maxWidth: number, preferred: number): { text: string; size: number } {
  let size = Math.min(preferred, 11);
  while (size > 7 && font.widthOfTextAtSize(text, size) > maxWidth) size -= 0.5;
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return { text, size };
  let fitted = text;
  while (fitted.length > 1 && font.widthOfTextAtSize(`${fitted}...`, size) > maxWidth) fitted = fitted.slice(0, -1);
  return { text: `${fitted.trimEnd()}...`, size };
}

function drawOnLine(page: PDFPage, field: PdfField, value: string, font: PDFFont) {
  const { text, size } = fitText(toWinAnsi(value).replace(/\n/g, " "), font, field.rect.width - 4, field.fontSize ?? 10.5);
  page.drawText(text, { x: field.rect.x + 2, y: field.rect.y + 2, size, font, color: INK });
}

export type FillValue = string | boolean | null | undefined;

export async function fillPdf(bytes: Uint8Array, fields: PdfField[], values: Record<string, FillValue>): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const signatureFont = await doc.embedFont(StandardFonts.HelveticaOblique);
  const pages = doc.getPages();
  const form = doc.getForm();
  let touchedForm = false;

  for (const field of fields) {
    const raw = values[field.id];
    if (raw === undefined || raw === null || raw === "") continue;
    const page = pages[field.page - 1];
    if (!page) continue;

    if (field.source === "flat") {
      if (field.kind === "checkbox") {
        const size = field.fontSize ?? 10.5;
        const x = field.rect.x + (field.rect.width - font.widthOfTextAtSize("X", size)) / 2;
        if (truthy(raw)) page.drawText("X", { x, y: field.rect.y + 1, size, font, color: INK });
      } else {
        drawOnLine(page, field, String(raw), field.kind === "signature" ? signatureFont : font);
      }
      continue;
    }

    const target = form.getFieldMaybe(field.name);
    if (!target) continue;
    touchedForm = true;
    if (target instanceof PDFTextField) {
      let text = toWinAnsi(String(raw));
      if (!target.isMultiline()) text = text.replace(/\n/g, " ");
      const max = target.getMaxLength();
      if (max !== undefined && text.length > max) text = text.slice(0, max);
      target.setText(text);
    } else if (target instanceof PDFCheckBox) {
      if (truthy(raw)) target.check();
      else target.uncheck();
    } else if (target instanceof PDFRadioGroup) {
      const option = pickOption(target.getOptions(), String(raw));
      if (option) target.select(option);
    } else if (target instanceof PDFDropdown || target instanceof PDFOptionList) {
      const option = pickOption(target.getOptions(), String(raw));
      if (option) target.select(option);
    } else {
      // Campo de firma digital: pdf-lib no firma; se escribe el nombre tecleado encima (firma escrita).
      drawOnLine(page, field, String(raw), signatureFont);
    }
  }

  if (touchedForm) form.updateFieldAppearances(font);
  return doc.save();
}
