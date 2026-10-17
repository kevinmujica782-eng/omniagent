// Relevo hacia la API de Binance (Supabase Edge Function, Deno).
//
// Por qué existe: Binance responde 451 a los servidores de EE. UU. y las funciones de Netlify corren allí. Esta función
// se invoca con la cabecera `x-region` (eu-west-3, París; o sa-east-1, São Paulo) y le pasa a Binance una consulta que
// el servidor de Omni ya firmó. No guarda llaves: la llave secreta de Binance se queda en Netlify; aquí solo pasa la
// firma de cada consulta, que vence a los pocos segundos.
//
// Seguridad:
// - Solo responde a quien manda el token del relevo (BINANCE_RELAY_TOKEN en Netlify). Aquí solo está su SHA-256.
// - Solo deja pasar tres rutas de lectura: el historial de Binance Pay, los permisos de la llave y la hora de Binance.
// - Responde 200 con { status, body }: el estado y el cuerpo tal como los devolvió Binance.
//
// Despliegue: Supabase → Edge Functions → binance-relay, con «Verify JWT» apagado (la autenticación es el token).
// Para cambiar el token: openssl rand -hex 32 → su SHA-256 aquí (printf %s "$TOKEN" | sha256sum), desplegar y poner
// el token nuevo en BINANCE_RELAY_TOKEN.

const TOKEN_SHA256 = "e6f7d3f2aa34d3308a7a31e96ca0b4cd116ba4954732c92b5885f22aaeee3462";
const BINANCE_API = "https://api.binance.com";
const ALLOWED_PATHS = new Set(["/sapi/v1/pay/transactions", "/sapi/v1/account/apiRestrictions", "/api/v3/time"]);
const MAX_BODY_CHARS = 2_000_000;

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Comparación en tiempo constante (las dos cadenas son hashes hexadecimales del mismo largo). */
function sameText(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (request: Request) => {
  const region = Deno.env.get("SB_REGION") ?? "desconocida";
  const reply = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "x-relay-region": region },
    });

  if (request.method !== "POST") return reply(405, { error: "method_not_allowed" });
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token || !sameText(await sha256Hex(token), TOKEN_SHA256)) return reply(401, { error: "unauthorized" });

  let input: { path?: unknown; query?: unknown; apiKey?: unknown };
  try {
    input = await request.json();
  } catch {
    return reply(400, { error: "bad_json" });
  }
  const path = typeof input.path === "string" ? input.path : "";
  const query = input.query === undefined ? "" : input.query;
  const apiKey = input.apiKey;
  if (!ALLOWED_PATHS.has(path)) return reply(400, { error: "path_not_allowed" });
  if (typeof query !== "string" || query.length > 2_000 || !/^[A-Za-z0-9=&%._-]*$/.test(query)) return reply(400, { error: "bad_query" });
  if (apiKey !== undefined && (typeof apiKey !== "string" || !/^[A-Za-z0-9]{16,128}$/.test(apiKey))) {
    return reply(400, { error: "bad_api_key" });
  }

  try {
    const response = await fetch(`${BINANCE_API}${path}${query ? `?${query}` : ""}`, {
      headers: apiKey ? { "X-MBX-APIKEY": apiKey } : {},
      signal: AbortSignal.timeout(10_000),
    });
    const text = await response.text();
    return reply(200, { status: response.status, body: text.slice(0, MAX_BODY_CHARS) });
  } catch {
    return reply(502, { error: "binance_unreachable" });
  }
});
