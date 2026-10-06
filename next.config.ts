import type { NextConfig } from "next";

const production = process.env.NODE_ENV === "production";

/** Origen de Supabase (el login y la sesión del navegador hablan con él). */
function supabaseOrigin(): string {
  try {
    return process.env.NEXT_PUBLIC_SUPABASE_URL ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).origin : "";
  } catch {
    return "";
  }
}

/**
 * Content Security Policy de producción. Solo se permite lo que la app usa: su propio origen, Supabase
 * (HTTPS y WebSocket para Realtime) y Plaid Link (si FINANCE_PROVIDER=plaid). Stripe Checkout y el portal
 * son redirecciones, así que no necesitan entradas. 'unsafe-inline' en scripts lo exige el arranque de
 * Next.js sin nonces; el resto de directivas cierra marcos, plugins, base y formularios.
 * CSP_MODE=report-only la vuelve informativa (útil al integrar algo nuevo) y CSP_MODE=off la quita.
 */
function contentSecurityPolicy(): string {
  const supabase = supabaseOrigin();
  const supabaseWs = supabase.replace(/^https:/, "wss:");
  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://cdn.plaid.com",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self' ${supabase} ${supabaseWs} https://*.plaid.com`.trim(),
    "frame-src https://cdn.plaid.com",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "upgrade-insecure-requests",
  ].join("; ");
}

function securityHeaders() {
  const headers = [
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Permissions-Policy", value: "camera=(self), microphone=(self), geolocation=(), payment=()" },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  ];
  if (production) {
    headers.push({ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" });
    const mode = process.env.CSP_MODE ?? "enforce";
    if (mode !== "off") {
      headers.push({
        key: mode === "report-only" ? "Content-Security-Policy-Report-Only" : "Content-Security-Policy",
        value: contentSecurityPolicy(),
      });
    }
  }
  return headers;
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Docker: BUILD_STANDALONE=1 genera .next/standalone (servidor mínimo con solo las dependencias usadas).
  output: process.env.BUILD_STANDALONE === "1" ? "standalone" : undefined,
  // El driver de Postgres, el adapter de Prisma, pdf.js, web-push y los clientes de correo (IMAP, SMTP y el lector
  // MIME) se cargan desde node_modules en el servidor.
  serverExternalPackages: ["pg", "@prisma/adapter-pg", "pdfjs-dist", "web-push", "imapflow", "mailparser", "nodemailer"],
  // pdf.js lee sus fuentes estándar y su worker en tiempo de ejecución: se incluyen en las funciones que leen PDF.
  outputFileTracingIncludes: {
    "/api/**/*": ["./node_modules/pdfjs-dist/standard_fonts/**", "./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs"],
    "/tramites/**/*": ["./node_modules/pdfjs-dist/standard_fonts/**", "./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs"],
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders() },
      // La API nunca se guarda en cachés compartidas (tiene datos de cada usuario).
      { source: "/api/:path*", headers: [{ key: "Cache-Control", value: "private, no-store" }] },
    ];
  },
};

export default nextConfig;
