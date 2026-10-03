// Utilidades de texto para comparar encabezados, palabras clave y descripciones.

/** Minúsculas, sin acentos y solo letras, números y espacios simples ("Descripción (MXN)" → "descripcion mxn"). */
export function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Espacios repetidos (incluidos los de no separación) a uno solo. */
export function squash(text: string): string {
  return text.replace(/[\s  ]+/g, " ").trim();
}

/** Recorta para mostrar una fila en un mensaje. */
export function clip(text: string, max = 120): string {
  const clean = squash(text);
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}
