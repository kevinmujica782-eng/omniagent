import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { cache } from "react";
import { prisma } from "./db";
import { Errors } from "./errors";
import { supabaseEnv } from "./supabase/config";
import { createSupabaseServerClient } from "./supabase/server";

export interface AuthContext {
  userId: string;
  email: string | null;
  /** cookie = web; bearer = app nativa u otros clientes con el JWT de Supabase. */
  via: "cookie" | "bearer";
}

let stateless: SupabaseClient | undefined;

function statelessClient(): SupabaseClient {
  const config = supabaseEnv();
  if (!config) throw Errors.notConfigured("Supabase");
  stateless ??= createClient(config.url, config.key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return stateless;
}

function toContext(
  claims: { sub?: string; email?: unknown } | null | undefined,
  via: AuthContext["via"],
): AuthContext | null {
  if (!claims?.sub) return null;
  return { userId: claims.sub, email: typeof claims.email === "string" ? claims.email : null, via };
}

/**
 * Autenticación de la API /api/v1: acepta `Authorization: Bearer <JWT de Supabase>` (app nativa)
 * o la cookie de sesión (web). getClaims() valida la firma del JWT; nunca confiamos en getSession() en servidor.
 */
export async function getAuthContext(request: Request): Promise<AuthContext> {
  const header = request.headers.get("authorization");
  if (header && /^bearer\s+/i.test(header)) {
    const token = header.replace(/^bearer\s+/i, "").trim();
    const { data, error } = await statelessClient().auth.getClaims(token);
    const ctx = error ? null : toContext(data?.claims, "bearer");
    if (!ctx) throw Errors.unauthorized();
    return ctx;
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getClaims();
  const ctx = error ? null : toContext(data?.claims, "cookie");
  if (!ctx) throw Errors.unauthorized();
  return ctx;
}

/** Usuario de la sesión web (Server Components). Memoizado por request. */
export const getOptionalUser = cache(async (): Promise<AuthContext | null> => {
  if (!supabaseEnv()) return null;
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getClaims();
  return error ? null : toContext(data?.claims, "cookie");
});

export async function requireUser(): Promise<AuthContext> {
  const user = await getOptionalUser();
  if (!user) redirect("/login");
  return user;
}

/** Garantiza el perfil aunque el trigger de Supabase aún no se haya instalado. */
export async function ensureProfile(user: AuthContext) {
  return prisma.profile.upsert({
    where: { id: user.userId },
    create: { id: user.userId, email: user.email },
    update: {},
    select: { id: true, email: true, fullName: true, currency: true, locale: true, timezone: true },
  });
}
