// Cuenta de revisión y capturas de teléfono para la ficha de Google Play.
// Lo corre el workflow «Capturas para Google Play» (.github/workflows/play-store.yml):
//   1. Crea la cuenta de revisión (el correo queda confirmado al crearla) y le carga datos de ejemplo por la API:
//      banco de prueba, bandeja de prueba con trámites, pedidos, productos vigilados con una bajada de precio y un chat.
//   2. Entra por la web como un teléfono Android (360 × 640 a 3x = 1080 × 1920 px, 9:16) y guarda las capturas.
// Variables: APP_URL, SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, REVIEW_EMAIL, REVIEW_PASSWORD y OUT_DIR.
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright-core";

function need(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Falta la variable ${name}`);
  return value;
}

const APP_URL = need("APP_URL").replace(/\/$/, "");
const SUPABASE_URL = need("SUPABASE_URL").replace(/\/$/, "");
const SUPABASE_KEY = need("SUPABASE_PUBLISHABLE_KEY");
const EMAIL = need("REVIEW_EMAIL");
const PASSWORD = need("REVIEW_PASSWORD");
const OUT_DIR = process.env.OUT_DIR || "capturas";

async function readBody(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text.slice(0, 300) };
  }
}

/** Crea la cuenta de revisión. El nombre es el que saluda en Inicio («Hola, Alex»). */
async function createAccount() {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
    method: "POST",
    headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD, data: { full_name: "Alex" } }),
  });
  const body = await readBody(res);
  if (!body.access_token) {
    throw new Error(
      `No se pudo crear la cuenta (HTTP ${res.status}: ${JSON.stringify(body).slice(0, 200)}). ` +
        "Si ya existe de otra corrida, usa otro correo en review_email o elimínala primero.",
    );
  }
  console.log("Cuenta de revisión creada");
  return body.access_token;
}

async function api(token, method, path, body) {
  const res = await fetch(`${APP_URL}/api/v1${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const parsed = await readBody(res);
  console.log(`${method} ${path} → HTTP ${res.status}`);
  if (!res.ok) console.log(`  ${JSON.stringify(parsed.error ?? parsed).slice(0, 300)}`);
  return res.ok ? parsed.data : null;
}

/** Datos de ejemplo: todo sale de las conexiones de prueba (marcadas «Demo» en la app); no se mueve dinero real. */
async function seed(token) {
  await api(token, "POST", "/finance/demo-bank");
  await api(token, "POST", "/procedures/mailboxes", { flavor: "gmail", withDemoData: true });
  await api(token, "POST", "/returns/examples");

  const tracked = [];
  for (const query of ["audífonos", "vuelo", "hotel"]) {
    const results = await api(token, "GET", `/concierge/search?q=${encodeURIComponent(query)}`);
    const url = Array.isArray(results) ? results[0]?.url : undefined;
    if (!url) continue;
    const result = await api(token, "POST", "/concierge/items", { url });
    if (result?.item?.id) tracked.push(result.item.id);
  }
  // Una oferta relámpago en la tienda de prueba: crea la alerta y la compra que espera aprobación.
  if (tracked[0]) await api(token, "POST", `/concierge/items/${tracked[0]}/simulate-drop`);

  const chat = await api(token, "POST", "/agent/chat", {
    message: "¿En qué gasto más cada mes y qué suscripciones podría cancelar para ahorrar?",
    module: "FINANCE",
  });
  return { conversationId: chat?.conversationId ?? null };
}

async function settle(page) {
  // Realtime deja una conexión abierta: networkidle puede no llegar nunca, así que tiene tope.
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
  await page.waitForTimeout(2_500);
}

async function screenshots(conversationId) {
  await mkdir(OUT_DIR, { recursive: true });
  // El Chrome que ya trae el runner de GitHub (sin descargar navegadores).
  const browser = await chromium.launch({ channel: "chrome" });
  try {
    const context = await browser.newContext({
      viewport: { width: 360, height: 640 },
      deviceScaleFactor: 3,
      isMobile: true,
      hasTouch: true,
      userAgent:
        "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36",
      locale: "es-419",
      timezoneId: "America/Caracas",
      colorScheme: "light",
    });
    const page = await context.newPage();
    await page.goto(`${APP_URL}/login?next=%2Finicio`, { waitUntil: "load" });
    await page.fill('input[name="email"]', EMAIL);
    await page.fill('input[name="password"]', PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/inicio/, { timeout: 45_000 });

    const screens = [
      ["01-inicio", "/inicio"],
      ["02-finanzas", "/finanzas"],
      ["03-chat", conversationId ? `/chat?c=${conversationId}` : "/chat?modulo=finanzas"],
      ["04-compras", "/compras"],
      ["05-tramites", "/tramites"],
      ["06-aprobaciones", "/aprobaciones"],
    ];
    for (const [name, path] of screens) {
      await page.goto(`${APP_URL}${path}`, { waitUntil: "load", timeout: 60_000 });
      await settle(page);
      await page.screenshot({ path: join(OUT_DIR, `${name}.png`) });
      console.log(`Captura ${name}.png (${path})`);
    }
  } finally {
    await browser.close();
  }
}

const token = await createAccount();
const { conversationId } = await seed(token);
await screenshots(conversationId);
