// Fotos más livianas antes de subirlas (solo en el navegador): una foto de teléfono pesa 3-5 MB y la subida entera
// tiene un tope de 4 MB. Se reducen a JPEG de hasta 2000 px por lado, que basta para leer un estado de cuenta, y se
// baja la calidad o el tamaño hasta caber en el presupuesto de cada foto.

const MAX_SIDE = 2000;
const QUALITIES = [0.85, 0.75, 0.65];

function toJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
}

function jpegName(name: string): string {
  const base = name.replace(/\.[^.]+$/, "") || "foto";
  return `${base}.jpg`;
}

/**
 * La foto como JPEG de hasta `maxBytes`. Si el navegador no la puede abrir (por ejemplo, HEIC en Chrome), devuelve la
 * original y el servidor explica qué hacer.
 */
export async function compressPhoto(file: File, maxBytes: number): Promise<File> {
  if (!file.type.startsWith("image/") || file.type === "image/gif") return file;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return file;
  }
  try {
    let scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    // Ya es un JPEG chico: se sube tal cual.
    if (scale === 1 && file.type === "image/jpeg" && file.size <= maxBytes) return file;
    let smallest: Blob | null = null;
    for (let round = 0; round < 3; round++) {
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext("2d");
      if (!context) return file;
      context.fillStyle = "#ffffff"; // un PNG con transparencia queda sobre blanco, no sobre negro
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      for (const quality of QUALITIES) {
        const blob = await toJpeg(canvas, quality);
        if (!blob) continue;
        if (blob.size <= maxBytes) return new File([blob], jpegName(file.name), { type: "image/jpeg" });
        if (!smallest || blob.size < smallest.size) smallest = blob;
      }
      scale *= 0.8;
    }
    // No cupo en el presupuesto: la versión más liviana (el servidor avisa si aun así pasa del tope).
    return smallest && smallest.size < file.size ? new File([smallest], jpegName(file.name), { type: "image/jpeg" }) : file;
  } finally {
    bitmap.close();
  }
}
