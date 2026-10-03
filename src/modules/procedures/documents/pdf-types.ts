// Tipos del lector de formularios PDF (sin dependencias: los usan servidor y pruebas).

export type PdfFieldKind = "text" | "checkbox" | "radio" | "dropdown" | "signature" | "date";

export interface PdfRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PdfField {
  /** Identificador estable dentro del documento: f1, f2... en orden de lectura. */
  id: string;
  /** Nombre del campo AcroForm o "flat:página:x:y" en formularios planos. */
  name: string;
  kind: PdfFieldKind;
  source: "acroform" | "flat";
  page: number;
  rect: PdfRect;
  /** Etiqueta visible junto al campo ("Nombre del estudiante"). */
  label: string | null;
  options?: string[];
  maxLength: number | null;
  multiline: boolean;
  currentValue: string | null;
  /** Tamaño de letra del texto cercano (formularios planos). */
  fontSize: number | null;
}

export interface PdfInspection {
  pageCount: number;
  pages: { width: number; height: number }[];
  hasAcroForm: boolean;
  fields: PdfField[];
  /** Texto del documento en orden de lectura (recortado). */
  text: string;
  title: string | null;
}
