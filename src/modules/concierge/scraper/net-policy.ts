// Política de red del rastreador: qué URLs y qué direcciones IP puede visitar el servidor.
// Un usuario puede pegar cualquier enlace; sin esta política, el servidor podría usarse para leer servicios
// internos (SSRF: 127.0.0.1, 169.254.169.254, la red privada del proveedor...). Sin dependencias de servidor.

export type UrlCheck =
  | { ok: true; url: URL; sandbox: boolean }
  | { ok: false; reason: "invalid" | "scheme" | "credentials" | "port" | "host" | "address"; message: string };

/** Dominio reservado para pruebas (RFC 2606): nunca existe en internet. Ahí viven las tiendas de prueba. */
export const SANDBOX_TLD = ".test";

const BLOCKED_SUFFIXES = [".localhost", ".local", ".internal", ".intranet", ".lan", ".home.arpa", ".corp", ".private"];
const MAX_URL_LENGTH = 2048;

export function isSandboxHost(hostname: string): boolean {
  return hostname.toLowerCase().endsWith(SANDBOX_TLD);
}

/** Valida un enlace antes de visitarlo (y cada redirección). Las direcciones IP literales se revisan aquí. */
export function checkUrl(raw: string): UrlCheck {
  const text = raw.trim();
  if (!text || text.length > MAX_URL_LENGTH) return { ok: false, reason: "invalid", message: "El enlace no es válido." };
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`);
  } catch {
    return { ok: false, reason: "invalid", message: "El enlace no es válido." };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { ok: false, reason: "scheme", message: "Solo puedo revisar enlaces http o https." };
  }
  if (url.username || url.password) {
    return { ok: false, reason: "credentials", message: "El enlace no puede incluir usuario ni contraseña." };
  }
  if (url.port && url.port !== "80" && url.port !== "443") {
    return { ok: false, reason: "port", message: "Solo reviso páginas en los puertos web normales." };
  }
  url.hash = "";
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (isSandboxHost(host)) return { ok: true, url, sandbox: true };

  const literal = host.startsWith("[") ? host.slice(1, -1) : host;
  if (isIpLiteral(literal)) {
    return isPublicAddress(literal)
      ? { ok: true, url, sandbox: false }
      : { ok: false, reason: "address", message: "Ese enlace apunta a una red privada." };
  }
  if (host === "localhost" || BLOCKED_SUFFIXES.some((suffix) => host.endsWith(suffix)) || !host.includes(".")) {
    return { ok: false, reason: "host", message: "Ese enlace no es de un sitio público." };
  }
  if (!/^[a-z0-9.-]+$/.test(host) || host.split(".").some((label) => !label || label.length > 63)) {
    return { ok: false, reason: "host", message: "El dominio del enlace no es válido." };
  }
  return { ok: true, url, sandbox: false };
}

export function isIpLiteral(value: string): boolean {
  return parseIpv4(value) !== null || parseIpv6(value) !== null;
}

function parseIpv4(value: string): number[] | null {
  const parts = value.split(".");
  if (parts.length !== 4) return null;
  const bytes = parts.map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : NaN));
  return bytes.every((b) => Number.isInteger(b) && b >= 0 && b <= 255) ? bytes : null;
}

/** IPv6 → 8 grupos de 16 bits (acepta "::" y un IPv4 al final, como en ::ffff:127.0.0.1). */
function parseIpv6(value: string): number[] | null {
  let text = value.toLowerCase();
  const zone = text.indexOf("%");
  if (zone >= 0) text = text.slice(0, zone);
  if (!text.includes(":")) return null;
  let tail: number[] = [];
  const lastColon = text.lastIndexOf(":");
  const maybeV4 = text.slice(lastColon + 1);
  if (maybeV4.includes(".")) {
    const v4 = parseIpv4(maybeV4);
    if (!v4) return null;
    tail = [(v4[0] << 8) | v4[1], (v4[2] << 8) | v4[3]];
    text = text.slice(0, lastColon + 1) + "0:0"; // marcador del mismo largo en grupos
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const parse = (part: string) => (part === "" ? [] : part.split(":"));
  const head = parse(halves[0]);
  const rest = halves.length === 2 ? parse(halves[1]) : [];
  const missing = 8 - head.length - rest.length;
  if (halves.length === 1 && missing !== 0) return null;
  if (halves.length === 2 && missing < 1) return null;
  const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill("0"), ...rest];
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  const numbers = groups.map((g) => parseInt(g, 16));
  if (tail.length) {
    numbers[6] = tail[0];
    numbers[7] = tail[1];
  }
  return numbers;
}

function v4InRange(ip: number[], base: number[], bits: number): boolean {
  const toInt = (b: number[]) => ((b[0] << 24) >>> 0) + (b[1] << 16) + (b[2] << 8) + b[3];
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return ((toInt(ip) & mask) >>> 0) === ((toInt(base) & mask) >>> 0);
}

const V4_BLOCKED: [number[], number][] = [
  [[0, 0, 0, 0], 8], // "esta red"
  [[10, 0, 0, 0], 8], // privada
  [[100, 64, 0, 0], 10], // CGNAT
  [[127, 0, 0, 0], 8], // loopback
  [[169, 254, 0, 0], 16], // link-local (incluye 169.254.169.254, metadatos de la nube)
  [[172, 16, 0, 0], 12], // privada
  [[192, 0, 0, 0], 24], // asignaciones del IETF
  [[192, 0, 2, 0], 24], // documentación
  [[192, 88, 99, 0], 24], // relay 6to4
  [[192, 168, 0, 0], 16], // privada
  [[198, 18, 0, 0], 15], // pruebas de rendimiento
  [[198, 51, 100, 0], 24], // documentación
  [[203, 0, 113, 0], 24], // documentación
  [[224, 0, 0, 0], 4], // multicast
  [[240, 0, 0, 0], 4], // reservada y broadcast
];

function isPublicV4(ip: number[]): boolean {
  return !V4_BLOCKED.some(([base, bits]) => v4InRange(ip, base, bits));
}

/** ¿Es una dirección de internet pública? Bloquea loopback, redes privadas, link-local, metadatos, multicast... */
export function isPublicAddress(address: string): boolean {
  const v4 = parseIpv4(address);
  if (v4) return isPublicV4(v4);
  const v6 = parseIpv6(address);
  if (!v6) return false;
  const embeddedV4 = () => [v6[6] >> 8, v6[6] & 0xff, v6[7] >> 8, v6[7] & 0xff];
  if (v6.every((g) => g === 0)) return false; // ::
  if (v6.slice(0, 7).every((g) => g === 0) && v6[7] === 1) return false; // ::1
  if (v6.slice(0, 5).every((g) => g === 0) && v6[5] === 0xffff) return isPublicV4(embeddedV4()); // ::ffff:a.b.c.d
  if (v6.slice(0, 6).every((g) => g === 0)) return false; // ::a.b.c.d (obsoleta)
  if (v6[0] === 0x64 && v6[1] === 0xff9b && v6.slice(2, 6).every((g) => g === 0)) return isPublicV4(embeddedV4()); // NAT64
  const first = v6[0];
  if ((first & 0xe000) !== 0x2000) return false; // fuera de 2000::/3 (unicast global): fc00::/7, fe80::/10, ff00::/8...
  if (first === 0x2001 && v6[1] < 0x0200) return false; // 2001::/23 (Teredo, benchmarking, ORCHID...)
  if (first === 0x2001 && v6[1] === 0x0db8) return false; // documentación
  if (first === 0x2002) return false; // 6to4 (puede encapsular una IPv4 privada)
  return true;
}
