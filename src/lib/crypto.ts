import "server-only";
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { env } from "./env";
import { Errors } from "./errors";

// AES-256-GCM para tokens OAuth y bancarios, y HMAC para tokens firmados del sandbox.
// Formato cifrado: v1.<iv>.<authTag>.<ciphertext> (base64url). La versión permite rotar claves.

let warned = false;

function masterKey(): Buffer {
  const configured = env().TOKEN_ENCRYPTION_KEY;
  if (configured) {
    const raw = Buffer.from(configured, "base64");
    if (raw.length !== 32) {
      throw new Error("TOKEN_ENCRYPTION_KEY debe tener 32 bytes en base64 (openssl rand -base64 32).");
    }
    return raw;
  }
  if (process.env.NODE_ENV === "production") throw Errors.notConfigured("El cifrado de credenciales (TOKEN_ENCRYPTION_KEY)");
  if (!warned) {
    console.warn("[crypto] TOKEN_ENCRYPTION_KEY no está definida: se usa una clave solo para desarrollo.");
    warned = true;
  }
  return createHash("sha256").update("omniagent-solo-desarrollo").digest();
}

function subkey(label: string): Buffer {
  return createHmac("sha256", masterKey()).update(label).digest();
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", subkey("encrypt"), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), data.toString("base64url")].join(".");
}

export function decryptSecret(payload: string): string {
  const [version, iv, tag, data] = payload.split(".");
  if (version !== "v1" || !iv || !tag || !data) throw new Error("Formato de secreto cifrado no reconocido.");
  const decipher = createDecipheriv("aes-256-gcm", subkey("encrypt"), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}

/** Huella HMAC corta de un texto (p. ej., la cotización que el usuario autoriza en la hoja de pago). */
export function digest(label: string, data: string): string {
  return createHmac("sha256", subkey(`digest:${label}`)).update(data).digest("base64url").slice(0, 24);
}

/** Compara dos huellas en tiempo constante. */
export function sameDigest(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Token firmado (no cifrado): <payload base64url>.<firma>. Para tokens del conector sandbox. */
export function signPayload(payload: Record<string, unknown>): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", subkey("sign")).update(body).digest("base64url");
  return `${body}.${signature}`;
}

export function verifyPayload<T extends Record<string, unknown>>(token: string): T | null {
  const [body, signature] = token.split(".");
  if (!body || !signature) return null;
  const expected = createHmac("sha256", subkey("sign")).update(body).digest();
  const given = Buffer.from(signature, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    return JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T;
  } catch {
    return null;
  }
}
