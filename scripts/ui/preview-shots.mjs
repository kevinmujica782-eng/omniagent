// Capturas de pantallas de la vista previa (/preview) para revisar el diseño sin desplegar: teléfono y compu.
// Lo corre el workflow «Capturas de la interfaz» (.github/workflows/ui-preview.yml) contra `next start` local.
// Variables: APP_URL (por defecto http://127.0.0.1:3000), SCREENS (lista separada por comas) y OUT_DIR.
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright-core";

const APP_URL = (process.env.APP_URL || "http://127.0.0.1:3000").replace(/\/$/, "");
const OUT_DIR = process.env.OUT_DIR || "ui-checks";
const SCREENS = (process.env.SCREENS || "asistente,asistente-escuchando,asistente-procesando,asistente-activo")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

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
      const response = await page.goto(`${APP_URL}/preview?screen=${screen}`, { waitUntil: "networkidle" });
      console.log(`${device.name} ${screen} → HTTP ${response?.status()}`);
      // La luna da su vuelta de entrada (1,2 s) antes de la captura.
      await page.waitForTimeout(1800);
      await page.screenshot({ path: join(OUT_DIR, `${screen}-${device.name}.png`) });
    }
    if (errors.length) console.log(`Errores en ${device.name}:\n${errors.slice(0, 20).join("\n")}`);
    await context.close();
  }
} finally {
  await browser.close();
}
