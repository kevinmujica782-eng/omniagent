// Capturas de pantallas de la vista previa (/preview) para revisar el diseño sin desplegar: teléfono y compu.
// Lo corre el workflow «Capturas de la interfaz» (.github/workflows/ui-preview.yml) contra `next start` local.
// Variables: APP_URL (por defecto http://127.0.0.1:3000), SCREENS (lista separada por comas) y OUT_DIR.
// Una pantalla terminada en «:completa» (por ejemplo «pagina-web:completa») se captura además de arriba abajo, para
// revisar páginas largas; la foto extra se llama «{pantalla}-completa-{equipo}.png». Con «@texto» (por ejemplo
// «cuenta@Modelo de IA») se captura además desde el primer elemento con ese texto exacto, para las secciones que
// quedan abajo en pantallas con desplazamiento interno; la foto extra se llama «{pantalla}-{texto}-{equipo}.png».
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright-core";

const APP_URL = (process.env.APP_URL || "http://127.0.0.1:3000").replace(/\/$/, "");
const OUT_DIR = process.env.OUT_DIR || "ui-checks";
const SCREENS = (process.env.SCREENS || "asistente,asistente-escuchando,asistente-procesando,asistente-activo")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean)
  .map((entry) => {
    const [target, mode] = entry.split(":");
    const [name, anchor] = target.split("@");
    return { name: name.trim(), full: mode === "completa", anchor: anchor?.trim() || null };
  });

/** «Modelo de IA» → «modelo-de-ia» (para el nombre del archivo). */
function slug(text) {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

const DEVICES = [
  { name: "telefono", viewport: { width: 390, height: 844 }, scale: 2, mobile: true },
  { name: "compu", viewport: { width: 1280, height: 860 }, scale: 1, mobile: false },
];

await mkdir(OUT_DIR, { recursive: true });
const browser = await chromium.launch({ channel: "chrome" });
try {
  for (const device of DEVICES) {
    const context = await browser.newContext({
      viewport: device.viewport,
      deviceScaleFactor: device.scale,
      isMobile: device.mobile,
      hasTouch: device.mobile,
      locale: "es-US",
      timezoneId: "America/Caracas",
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    for (const screen of SCREENS) {
      const response = await page.goto(`${APP_URL}/preview?screen=${screen.name}`, { waitUntil: "networkidle" });
      console.log(`${device.name} ${screen.name} → HTTP ${response?.status()}`);
      // La luna da su vuelta de entrada (1,2 s) antes de la captura.
      await page.waitForTimeout(1800);
      await page.screenshot({ path: join(OUT_DIR, `${screen.name}-${device.name}.png`) });
      if (screen.full) {
        await page.screenshot({ path: join(OUT_DIR, `${screen.name}-completa-${device.name}.png`), fullPage: true });
      }
      if (screen.anchor) {
        const target = page.getByText(screen.anchor, { exact: true }).first();
        if (await target.count()) {
          await target.evaluate((element) => element.scrollIntoView({ block: "start" }));
          await page.waitForTimeout(400);
          await page.screenshot({ path: join(OUT_DIR, `${screen.name}-${slug(screen.anchor)}-${device.name}.png`) });
        } else {
          console.log(`${device.name} ${screen.name}: no encontré «${screen.anchor}»`);
        }
      }
    }
    if (errors.length) console.log(`Errores en ${device.name}:\n${errors.slice(0, 20).join("\n")}`);
    await context.close();
  }
} finally {
  await browser.close();
}
