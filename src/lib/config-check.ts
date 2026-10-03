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
  // SUPABASE_SECRET_KEY: sin ella no se puede eliminar una cuenta (Google Play lo exige) ni usar Supabase Storage.
  for (const key of ["ANTHROPIC_API_KEY", "CRON_SECRET", "SUPABASE_SECRET_KEY"]) if (!present(env, key)) report.recommended.push(key);

  // Stripe va completo o no va: con la mitad, el pago abre pero Pro nunca se activa.
  const stripe = ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "STRIPE_PRICE_PRO_MONTHLY"];
  const stripeSet = stripe.filter((key) => present(env, key));
  if (stripeSet.length > 0 && stripeSet.length < stripe.length) {
    report.critical.push(...stripe.filter((key) => !present(env, key)));
  } else if (stripeSet.length === 0) {
    report.recommended.push("STRIPE_SECRET_KEY");
  }
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
