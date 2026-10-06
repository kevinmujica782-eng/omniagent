import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { log } from "@/lib/log";
import { supabaseEnv } from "@/lib/supabase/config";

// Salud para monitores de disponibilidad, el healthcheck de Docker y el balanceador.
// Público: responde solo "ok"/"degraded" y la versión. Con "Authorization: Bearer <CRON_SECRET>" añade el
// detalle de qué integraciones están configuradas (nunca sus valores).
export const dynamic = "force-dynamic";

type Check = "ok" | "error" | "not_configured";

function authorized(header: string | null, secret: string | undefined): boolean {
  if (!secret || !header) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const given = Buffer.from(header);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export async function GET(request: Request) {
  const started = Date.now();
  let database: Check = "ok";
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (error) {
    database = "error";
    log.error("health.database_unreachable", { error });
  }
  const config = env();
  const status = database === "ok" ? "ok" : "degraded";
  const body: Record<string, unknown> = {
    status,
    version: process.env.APP_VERSION ?? process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "dev",
    latencyMs: Date.now() - started,
  };
  if (authorized(request.headers.get("authorization"), config.CRON_SECRET)) {
    const has = (value: unknown): Check => (value ? "ok" : "not_configured");
    body.checks = {
      database,
      supabase: has(supabaseEnv()),
      anthropic: has(config.ANTHROPIC_API_KEY),
      stripe: has(config.STRIPE_SECRET_KEY && config.STRIPE_PRICE_PRO_MONTHLY && config.STRIPE_WEBHOOK_SECRET),
      revenuecat: has(config.REVENUECAT_WEBHOOK_AUTH),
      binance: has(config.BINANCE_PAY_API_KEY && config.BINANCE_PAY_SECRET_KEY),
      encryption: has(config.TOKEN_ENCRYPTION_KEY),
      cron: has(config.CRON_SECRET),
    };
  }
  return NextResponse.json(body, { status: status === "ok" ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
