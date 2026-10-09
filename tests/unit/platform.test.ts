import { describe, expect, it } from "vitest";
import { z } from "zod";
import { checkConfig } from "@/lib/config-check";
import { classify } from "@/lib/error-mapping";
import { AppError, Errors, isFreePlanLimit } from "@/lib/errors";
import { redact, serializeError } from "@/lib/log";
import { secondsUntilReset, windowStart } from "@/lib/rate-window";
import { parseTheme } from "@/lib/theme";
import { safeNext } from "@/lib/validation";

describe("errores de la API", () => {
  it("los errores de la app pasan tal cual", () => {
    expect(classify(Errors.notFound("El trámite"))).toMatchObject({ status: 404, code: "not_found", message: "El trámite no existe o ya no está disponible." });
    expect(classify(Errors.rateLimited("Vas muy rápido.", 30))).toMatchObject({ status: 429, retryAfter: 30 });
  });

  it("los límites del plan llevan su detalle y solo se ofrece Pro en Gratis", () => {
    const free = Errors.planLimit("Tu plan permite 3 precios.", { plan: "FREE", reason: "watchlist", limit: 3 });
    const pro = Errors.planLimit("Llegaste al máximo.", { plan: "PRO", reason: "watchlist", limit: 50 });
    expect(classify(free)).toMatchObject({ status: 402, code: "plan_limit", details: { plan: "FREE", reason: "watchlist", limit: 3 } });
    expect(isFreePlanLimit(free)).toBe(true);
    expect(isFreePlanLimit(pro)).toBe(false);
    expect(isFreePlanLimit(new Error("x"))).toBe(false);
  });

  it("validación: 422 con los problemas", () => {
    const result = z.object({ n: z.number() }).safeParse({ n: "x" });
    expect(result.success).toBe(false);
    if (!result.success) expect(classify(result.error)).toMatchObject({ status: 422, code: "validation_error" });
  });

  it("infraestructura: mensajes útiles sin detalles internos", () => {
    expect(classify(Object.assign(new Error("Can't reach database server"), { code: "P1001" }))).toMatchObject({ status: 503, code: "database_unavailable" });
    expect(classify(new Error("timeout exceeded when trying to connect"))).toMatchObject({ status: 503, code: "database_unavailable" });
    expect(classify(Object.assign(new Error("pool"), { code: "P2037" }))).toMatchObject({ status: 503, retryAfter: 5 });
    expect(classify(Object.assign(new Error("gone"), { code: "P2025" }))).toMatchObject({ status: 404 });
    expect(classify(Object.assign(new Error("dup"), { code: "P2002" }))).toMatchObject({ status: 409 });
    const overloaded = Object.assign(new Error("Overloaded"), { name: "InternalServerError", status: 529 });
    expect(classify(overloaded)).toMatchObject({ status: 503, code: "ai_busy" });
    expect(classify(Object.assign(new Error("rate"), { name: "RateLimitError", status: 429 }))).toMatchObject({ status: 503, code: "ai_busy" });
    expect(classify(Object.assign(new Error("net"), { type: "StripeConnectionError" }))).toMatchObject({ status: 502, code: "payment_provider_error" });
    const unknown = classify(new TypeError("Cannot read properties of undefined (reading 'x')"));
    expect(unknown).toMatchObject({ status: 500, code: "internal_error" });
    expect(unknown.message).not.toMatch(/undefined/);
  });

  it("AppError conserva código y estado", () => {
    const error = new AppError(409, "conflict", "Ya tienes el plan Pro.");
    expect(error).toBeInstanceOf(Error);
    expect(error.status).toBe(409);
  });
});

describe("logs", () => {
  it("oculta secretos y datos personales", () => {
    const clean = redact({ userId: "u1", email: "laura@ejemplo.com", headers: { authorization: "Bearer abc", cookie: "sb=1" }, token: "t", nested: { apiKey: "k", ok: 1 } }) as Record<string, unknown>;
    expect(clean.userId).toBe("u1");
    expect(clean.email).toBe("[oculto]");
    expect((clean.headers as Record<string, unknown>).authorization).toBe("[oculto]");
    expect((clean.headers as Record<string, unknown>).cookie).toBe("[oculto]");
    expect(clean.token).toBe("[oculto]");
    expect((clean.nested as Record<string, unknown>).apiKey).toBe("[oculto]");
    expect((clean.nested as Record<string, unknown>).ok).toBe(1);
  });

  it("recorta lo largo y lo profundo", () => {
    expect(String(redact("x".repeat(5000))).length).toBeLessThan(2100);
    const deep = redact({ a: { b: { c: { d: { e: 1 } } } } }) as { a: { b: { c: { d: unknown } } } };
    expect(deep.a.b.c.d).toBe("[…]");
  });

  it("serializa errores con su código", () => {
    const serialized = serializeError(Object.assign(new Error("fallo"), { code: "P1001", status: 503 }));
    expect(serialized).toMatchObject({ name: "Error", message: "fallo", code: "P1001", status: 503 });
  });
});

describe("límite de tasa", () => {
  it("usa ventanas fijas alineadas", () => {
    const now = new Date("2026-09-28T15:00:42.500Z");
    expect(windowStart(now, 60).toISOString()).toBe("2026-09-28T15:00:00.000Z");
    expect(secondsUntilReset(now, 60)).toBe(18);
    expect(windowStart(now, 3600).toISOString()).toBe("2026-09-28T15:00:00.000Z");
  });
});

describe("configuración al arrancar", () => {
  const complete = {
    DATABASE_URL: "postgres://x",
    NEXT_PUBLIC_SUPABASE_URL: "https://p.supabase.co",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_x",
    TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
    NEXT_PUBLIC_APP_URL: "https://omniagent.app",
    ANTHROPIC_API_KEY: "sk-ant-x",
    CRON_SECRET: "c",
    STRIPE_SECRET_KEY: "sk_live_x",
    STRIPE_WEBHOOK_SECRET: "whsec_x",
    STRIPE_PRICE_PRO_MONTHLY: "price_x",
  };

  it("con todo configurado no hay reclamos", () => {
    expect(checkConfig(complete, true)).toEqual({ critical: [], recommended: [], warnings: [] });
  });

  it("detecta lo que falta y lo mal armado", () => {
    const report = checkConfig({ ...complete, DATABASE_URL: "", STRIPE_WEBHOOK_SECRET: undefined, TOKEN_ENCRYPTION_KEY: "corta" }, true);
    expect(report.critical).toContain("DATABASE_URL");
    expect(report.critical).toContain("STRIPE_WEBHOOK_SECRET");
    expect(report.critical.some((k) => k.startsWith("TOKEN_ENCRYPTION_KEY"))).toBe(true);
  });

  it("advierte Stripe de prueba y la URL local en producción", () => {
    const report = checkConfig({ ...complete, STRIPE_SECRET_KEY: "sk_test_x", NEXT_PUBLIC_APP_URL: "http://localhost:3000" }, true);
    expect(report.warnings[0]).toMatch(/modo de prueba/);
    expect(report.critical.some((k) => k.startsWith("NEXT_PUBLIC_APP_URL"))).toBe(true);
    expect(checkConfig({ ...complete, NEXT_PUBLIC_APP_URL: "http://localhost:3000" }, false).critical).toEqual([]);
  });

  it("basta la llave de cualquier proveedor de IA", () => {
    const noAI = { ...complete, ANTHROPIC_API_KEY: "" };
    expect(checkConfig(noAI, true).recommended).toEqual(["ANTHROPIC_API_KEY (o OPENAI_API_KEY, GEMINI_API_KEY, XAI_API_KEY)"]);
    expect(checkConfig({ ...noAI, GEMINI_API_KEY: "g-x" }, true).recommended).toEqual([]);
    expect(checkConfig({ ...noAI, CRON_SECRET: undefined, XAI_API_KEY: "xai-x" }, true).recommended).toEqual(["CRON_SECRET"]);
  });

  it("la llave secreta de Supabase solo hace falta con los documentos en Storage", () => {
    expect(checkConfig(complete, true).critical).toEqual([]);
    expect(checkConfig({ ...complete, DOCUMENT_STORAGE: "supabase" }, true).critical).toEqual([
      "SUPABASE_SECRET_KEY (DOCUMENT_STORAGE=supabase)",
    ]);
    expect(checkConfig({ ...complete, DOCUMENT_STORAGE: "supabase", SUPABASE_SECRET_KEY: "sb_secret_x" }, true).critical).toEqual([]);
  });
});

describe("tema y redirecciones", () => {
  it("lee la preferencia de tema", () => {
    expect(parseTheme("dark")).toBe("dark");
    expect(parseTheme("light")).toBe("light");
    expect(parseTheme("sepia")).toBe("system");
    expect(parseTheme(undefined)).toBe("system");
  });

  it("después de entrar va al Inicio y nunca a otro dominio", () => {
    expect(safeNext(null)).toBe("/inicio");
    expect(safeNext("/compras?alerta=1")).toBe("/compras?alerta=1");
    expect(safeNext("//evil.test")).toBe("/inicio");
    expect(safeNext("https://evil.test")).toBe("/inicio");
    expect(safeNext("/\\evil.test")).toBe("/inicio");
  });
});
