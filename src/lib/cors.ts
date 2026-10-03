// Sin "server-only": lo usa src/proxy.ts.
const NATIVE_ORIGINS = "capacitor://localhost,https://localhost,http://localhost";

function allowedOrigins(): Set<string> {
  const list = [
    process.env.NEXT_PUBLIC_APP_URL ?? "",
    ...(process.env.CORS_ALLOWED_ORIGINS || NATIVE_ORIGINS).split(","),
  ];
  return new Set(list.map((origin) => origin.trim()).filter(Boolean));
}

/** Cabeceras CORS para /api: la app nativa (Capacitor) llama desde otro origen. */
export function corsHeaders(origin: string | null): Record<string, string> {
  if (!origin || !allowedOrigins().has(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Request-Id",
    "Access-Control-Expose-Headers": "X-Request-Id, Retry-After",
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
}
