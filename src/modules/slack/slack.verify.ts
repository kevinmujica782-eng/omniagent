import { createHmac, timingSafeEqual } from "node:crypto";

// Verificación de la firma de Slack (sin dependencias de servidor: puro node:crypto, para poder probarlo).
// Slack firma cada petición con HMAC-SHA256 sobre «v0:<timestamp>:<cuerpo crudo>» usando el signing secret de la app.
// Ver https://api.slack.com/authentication/verifying-requests-from-slack

const MAX_SKEW_SECONDS = 300; // rechaza peticiones repetidas o viejas (protege contra reenvíos)

export function verifySlackSignature(opts: {
  signingSecret: string;
  timestamp: string | null;
  rawBody: string;
  signature: string | null;
  now?: number;
}): boolean {
  const { signingSecret, timestamp, rawBody, signature } = opts;
  if (!signingSecret || !timestamp || !signature) return false;

  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;
  const nowSeconds = (opts.now ?? Date.now()) / 1000;
  if (Math.abs(nowSeconds - ts) > MAX_SKEW_SECONDS) return false;

  const base = `v0:${timestamp}:${rawBody}`;
  const expected = `v0=${createHmac("sha256", signingSecret).update(base).digest("hex")}`;
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signature, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}
