import "server-only";
import { z } from "zod";
import { DEFAULT_MODELS } from "@/modules/ai/ai.catalog";
import { Errors } from "./errors";

/**
 * Variables de servidor validadas. Las integraciones opcionales (Stripe, RevenueCat...) pueden faltar
 * en desarrollo: requireEnv() responde 503 "no configurado" en lugar de romper toda la app.
 * Las variables NEXT_PUBLIC_* se leen directamente porque Next.js las incrusta en el bundle.
 */
const schema = z.object({
  NEXT_PUBLIC_APP_URL: z.string().default("http://localhost:3000"),
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL_FREE: z.string().default(DEFAULT_MODELS.anthropic.fast),
  ANTHROPIC_MODEL_PRO: z.string().default(DEFAULT_MODELS.anthropic.smart),
  ANTHROPIC_BASE_URL: z.string().url().optional(),
  // Router de IA (src/modules/ai, docs/ROUTER-IA.md): cada proveedor se activa con su llave. Los modelos `FAST` son
  // los del plan Gratis y los `SMART`, los de Pro.
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_BASE_URL: z.string().url().optional(),
  OPENAI_MODEL_FAST: z.string().default(DEFAULT_MODELS.openai.fast),
  OPENAI_MODEL_SMART: z.string().default(DEFAULT_MODELS.openai.smart),
  // Google AI Studio. GOOGLE_API_KEY sirve igual (es el nombre que usan los SDK de Google).
  GEMINI_API_KEY: z.string().optional(),
  GOOGLE_API_KEY: z.string().optional(),
  GEMINI_BASE_URL: z.string().url().optional(),
  GEMINI_MODEL_FAST: z.string().default(DEFAULT_MODELS.gemini.fast),
  GEMINI_MODEL_SMART: z.string().default(DEFAULT_MODELS.gemini.smart),
  XAI_API_KEY: z.string().optional(),
  XAI_BASE_URL: z.string().url().optional(),
  XAI_MODEL_FAST: z.string().default(DEFAULT_MODELS.xai.fast),
  XAI_MODEL_SMART: z.string().default(DEFAULT_MODELS.xai.smart),
  // Orden en que el router prueba los proveedores (los que no se nombran van después, en el orden por defecto).
  AI_PROVIDER_ORDER: z.string().default("anthropic,openai,gemini,xai"),
  TOKEN_ENCRYPTION_KEY: z.string().optional(),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_PRICE_PRO_MONTHLY: z.string().optional(),
  REVENUECAT_WEBHOOK_AUTH: z.string().optional(),
  // Binance Pay (comercio): llave de API y llave secreta de merchant.binance.com. Las dos o ninguna.
  BINANCE_PAY_API_KEY: z.string().optional(),
  BINANCE_PAY_SECRET_KEY: z.string().optional(),
  // Notificaciones push: si faltan, la app genera sus llaves VAPID y las guarda cifradas en app_settings.
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  REVENUECAT_PRO_ENTITLEMENT: z.string().default("pro"),
  FINANCE_PROVIDER: z.enum(["sandbox", "plaid"]).default("sandbox"),
  PLAID_CLIENT_ID: z.string().optional(),
  PLAID_SECRET: z.string().optional(),
  PLAID_ENV: z.enum(["sandbox", "production"]).default("sandbox"),
  PLAID_COUNTRY_CODES: z.string().default("US"),
  PLAID_WEBHOOK_URL: z.string().optional(),
  CRON_SECRET: z.string().optional(),
  // Documentos: "database" guarda los PDF en Postgres (tabla document_blobs); "supabase" usa Storage.
  DOCUMENT_STORAGE: z.enum(["database", "supabase"]).default("database"),
  // Llave secreta de Supabase (sb_secret_...) o service_role heredada: solo servidor, para Storage.
  SUPABASE_SECRET_KEY: z.string().optional(),
  // Compras: "on" lee páginas públicas de productos (respeta robots.txt); "off" deja solo las tiendas de prueba.
  WEB_PRICE_CHECKS: z.enum(["on", "off"]).default("on"),
  // Página que explica el rastreador (va en su User-Agent). Por defecto, NEXT_PUBLIC_APP_URL/bot.
  SCRAPER_CONTACT_URL: z.string().url().optional(),
});

export type ServerEnv = z.infer<typeof schema>;

let cached: ServerEnv | undefined;

export function env(): ServerEnv {
  if (!cached) {
    // Una variable vacía en .env cuenta como ausente (así aplican los valores por defecto).
    const raw = Object.fromEntries(Object.entries(process.env).filter(([, value]) => value !== ""));
    cached = schema.parse(raw);
  }
  return cached;
}

type OptionalKey = {
  [K in keyof ServerEnv]-?: undefined extends ServerEnv[K] ? K : never;
}[keyof ServerEnv];

export function requireEnv(key: OptionalKey, feature: string): string {
  const value = env()[key];
  if (!value) throw Errors.notConfigured(feature);
  return value;
}
