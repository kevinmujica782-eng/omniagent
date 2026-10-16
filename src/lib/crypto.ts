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

const BYTES_VERSION = 1;
const IV_BYTES = 12;
const TAG_BYTES = 16;

/**
 * Binario cifrado con AES-256-GCM, para archivos que se guardan poco tiempo (páginas de un estado de cuenta mientras
 * la IA las lee). Formato: [versión (1 byte)][iv (12)][authTag (16)][datos].
 */
export function encryptBytes(plain: Uint8Array): Uint8Array<ArrayBuffer> {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", subkey("encrypt-bytes"), iv);
  const data = Buffer.concat([cipher.update(plain), cipher.final()]);
  const out = new Uint8Array(1 + IV_BYTES + TAG_BYTES + data.length);
  out[0] = BYTES_VERSION;
  out.set(iv, 1);
  out.set(cipher.getAuthTag(), 1 + IV_BYTES);
  out.set(data, 1 + IV_BYTES + TAG_BYTES);
  return out;
}

export function decryptBytes(payload: Uint8Array): Uint8Array<ArrayBuffer> {
  if (payload.length < 1 + IV_BYTES + TAG_BYTES || payload[0] !== BYTES_VERSION) {
    throw new Error("Formato de archivo cifrado no reconocido.");
  }
  const decipher = createDecipheriv("aes-256-gcm", subkey("encrypt-bytes"), payload.subarray(1, 1 + IV_BYTES));
  decipher.setAuthTag(payload.subarray(1 + IV_BYTES, 1 + IV_BYTES + TAG_BYTES));
  const plain = Buffer.concat([decipher.update(payload.subarray(1 + IV_BYTES + TAG_BYTES)), decipher.final()]);
  return new Uint8Array(plain);
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
