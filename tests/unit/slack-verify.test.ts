import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifySlackSignature } from "@/modules/slack/slack.verify";

// Firma de Slack: solo pasa una petición reciente y firmada con el signing secret correcto.

const SECRET = "shh-signing-secret";

function sign(rawBody: string, timestamp: string, secret = SECRET): string {
  return `v0=${createHmac("sha256", secret).update(`v0:${timestamp}:${rawBody}`).digest("hex")}`;
}

describe("verifySlackSignature", () => {
  const now = 1_760_000_000_000; // referencia fija
  const ts = String(Math.floor(now / 1000));
  const body = "token=x&team_id=T1&user_id=U1&text=hola";

  it("acepta una firma válida y reciente", () => {
    expect(verifySlackSignature({ signingSecret: SECRET, timestamp: ts, rawBody: body, signature: sign(body, ts), now })).toBe(true);
  });

  it("rechaza una firma con otro secreto", () => {
    const bad = sign(body, ts, "otro-secreto");
    expect(verifySlackSignature({ signingSecret: SECRET, timestamp: ts, rawBody: body, signature: bad, now })).toBe(false);
  });

  it("rechaza si el cuerpo fue alterado", () => {
    const sig = sign(body, ts);
    expect(verifySlackSignature({ signingSecret: SECRET, timestamp: ts, rawBody: body + "&x=1", signature: sig, now })).toBe(false);
  });

  it("rechaza una petición vieja (reenvío)", () => {
    const oldTs = String(Math.floor(now / 1000) - 600); // 10 min atrás
    expect(verifySlackSignature({ signingSecret: SECRET, timestamp: oldTs, rawBody: body, signature: sign(body, oldTs), now })).toBe(false);
  });

  it("rechaza si faltan datos", () => {
    expect(verifySlackSignature({ signingSecret: SECRET, timestamp: null, rawBody: body, signature: sign(body, ts), now })).toBe(false);
    expect(verifySlackSignature({ signingSecret: "", timestamp: ts, rawBody: body, signature: sign(body, ts), now })).toBe(false);
    expect(verifySlackSignature({ signingSecret: SECRET, timestamp: ts, rawBody: body, signature: null, now })).toBe(false);
  });
});
