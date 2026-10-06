// Revisión de configuración al arrancar (instrumentation.ts). Pura: recibe las variables y dice qué falta.
// No detiene el servidor —la landing, /api/health y la vista previa deben seguir respondiendo—, pero deja
// un error claro en los logs desde el primer segundo.

type Env = Record<string, string | undefined>;

export type ConfigReport = { critical: string[]; recommended: string[]; warnings: string[] };

const present = (env: Env, key: string) => Boolean(env[key] && env[key]!.trim() !== "");

export function checkConfig(env: Env, production: boolean): ConfigReport {
  const report: ConfigReport = { critical: [], recommended: [], warnings: [] };
  for (const key of ["DATABASE_URL", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "TOKEN_ENCRYPTION_KEY"]) {
    if (!present(env, key)) report.critical.push(key);
  }
  for (const key of ["ANTHROPIC_API_KEY", "CRON_SECRET"]) if (!present(env, key)) report.recommended.push(key);
  // Con los documentos en Supabase Storage, sin la llave secreta no se pueden subir ni leer. (Eliminar una
  // cuenta ya no la necesita: usa la función public.delete_auth_user de prisma/sql/supabase-setup.sql.)
  if (env.DOCUMENT_STORAGE === "supabase" && !present(env, "SUPABASE_SECRET_KEY")) {
    report.critical.push("SUPABASE_SECRET_KEY (DOCUMENT_STORAGE=supabase)");
  }

  // Cada pasarela va completa o no va: con la mitad, el pago abre (o ni se firma) pero Pro nunca se activa.
  const stripe = ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "STRIPE_PRICE_PRO_MONTHLY"];
  const stripeSet = stripe.filter((key) => present(env, key));
  if (stripeSet.length > 0 && stripeSet.length < stripe.length) report.critical.push(...stripe.filter((key) => !present(env, key)));
  const binance = ["BINANCE_PAY_API_KEY", "BINANCE_PAY_SECRET_KEY"];
  const binanceSet = binance.filter((key) => present(env, key));
  if (binanceSet.length === 1) report.critical.push(...binance.filter((key) => !present(env, key)));
  // Sin ninguna pasarela, nadie puede pagar Pro.
  if (stripeSet.length === 0 && binanceSet.length === 0) report.recommended.push("BINANCE_PAY_API_KEY");
  if (present(env, "STRIPE_SECRET_KEY") && production && env.STRIPE_SECRET_KEY!.startsWith("sk_test_")) {
    report.warnings.push("Stripe está en modo de prueba (sk_test_) en producción.");
  }

  const key = env.TOKEN_ENCRYPTION_KEY;
  if (key && Buffer.from(key, "base64").length !== 32) {
    report.critical.push("TOKEN_ENCRYPTION_KEY (debe ser de 32 bytes en base64: openssl rand -base64 32)");
  }
  const appUrl = env.NEXT_PUBLIC_APP_URL ?? "";
  if (production && (!appUrl || /localhost|127\.0\.0\.1/.test(appUrl))) {
    report.critical.push("NEXT_PUBLIC_APP_URL (la URL pública HTTPS de la app)");
  } else if (production && !appUrl.startsWith("https://")) {
    report.warnings.push("NEXT_PUBLIC_APP_URL debería ser HTTPS en producción.");
  }
  if (production && env.ENABLE_PREVIEW === "true") report.warnings.push("La galería /preview está abierta en producción (ENABLE_PREVIEW=true).");
  return report;
}
