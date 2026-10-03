import "server-only";
import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import type { LookupFunction } from "node:net";
import zlib from "node:zlib";
import { env } from "@/lib/env";
import { sandboxFetch, type SandboxFlashSale } from "../sandbox/stores";
import { checkUrl, isPublicAddress } from "./net-policy";
import { ALLOW_ALL, BOT_TOKEN, parseRobots, type RobotsPolicy } from "./robots";

// Rastreador de páginas públicas: se identifica como OmniAgentBot, respeta robots.txt, visita una tienda a la vez
// y no evade bloqueos (captchas, 403, 429): si la tienda no quiere visitas automáticas, se le dice al usuario.
// Protecciones: solo http(s) en puertos web, DNS validado en el momento de conectar (evita SSRF y DNS rebinding),
// redirecciones revalidadas, tiempo máximo, tamaño máximo (también descomprimido) y solo HTML.
// Las tiendas de prueba (.test) se sirven desde una "red" simulada, sin salir a internet.

export type FetchFailure =
  | "invalid_url"
  | "blocked_address"
  | "robots"
  | "timeout"
  | "too_large"
  | "not_html"
  | "forbidden"
  | "not_found"
  | "rate_limited"
  | "http_error"
  | "network"
  | "redirects"
  | "disabled";

export type FetchResult =
  | { ok: true; url: string; status: number; html: string; sandbox: boolean }
  | { ok: false; code: FetchFailure; status?: number; message: string; sandbox: boolean };

export interface FetchOptions {
  now?: Date;
  /** Oferta relámpago de prueba para una URL .test (solo sandbox). */
  flash?: SandboxFlashSale | null;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  /** false = solo tiendas de prueba (WEB_PRICE_CHECKS=off). */
  allowWeb?: boolean;
  userAgent?: string;
  /** Pruebas: DNS y política de direcciones (por defecto, DNS real y solo direcciones públicas). */
  lookup?: typeof dns.lookup;
  isAllowedAddress?: (ip: string) => boolean;
  robots?: RobotsCache;
  gate?: HostGate;
  /** Pausa mínima entre visitas al mismo dominio (1 s; las pruebas la bajan). */
  minDelayMs?: number;
}

const MESSAGES: Record<FetchFailure, string> = {
  invalid_url: "El enlace no es válido.",
  blocked_address: "Ese enlace apunta a una red privada: no puedo visitarlo.",
  robots: "Esta tienda no permite revisiones automáticas (robots.txt), así que no puedo vigilarla.",
  timeout: "La página tardó demasiado en responder.",
  too_large: "La página es demasiado pesada para revisarla.",
  not_html: "El enlace no es una página web de producto.",
  forbidden: "La tienda bloqueó la lectura automática.",
  not_found: "La página ya no existe (quizá quitaron el producto).",
  rate_limited: "La tienda pidió esperar antes de volver a visitarla.",
  http_error: "La tienda respondió con un error.",
  network: "No pude conectar con la tienda.",
  redirects: "La página redirige demasiadas veces.",
  disabled: "La revisión de páginas reales está desactivada en este entorno: usa las tiendas de prueba.",
};

const fail = (code: FetchFailure, sandbox: boolean, status?: number, message?: string): FetchResult => ({
  ok: false,
  code,
  status,
  message: message ?? MESSAGES[code],
  sandbox,
});

export function userAgent(): string {
  const config = env();
  const contact = config.SCRAPER_CONTACT_URL ?? `${config.NEXT_PUBLIC_APP_URL.replace(/\/$/, "")}/bot`;
  return `${BOT_TOKEN}/1.0 (+${contact})`;
}

// ─── Una tienda a la vez ─────────────────────────────────────────────────

/** Serializa las visitas por dominio y deja una pausa entre ellas (mínimo 1 s o el Crawl-delay del sitio). */
export class HostGate {
  private tails = new Map<string, Promise<unknown>>();
  private last = new Map<string, number>();

  async run<T>(host: string, delayMs: number, fn: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(host) ?? Promise.resolve();
    const task = previous
      .catch(() => undefined)
      .then(async () => {
        const wait = (this.last.get(host) ?? 0) + delayMs - Date.now();
        if (wait > 0) await new Promise((resolve) => setTimeout(resolve, Math.min(wait, 30_000)));
        try {
          return await fn();
        } finally {
          this.last.set(host, Date.now());
        }
      });
    this.tails.set(host, task);
    return task;
  }
}

// ─── robots.txt en caché ─────────────────────────────────────────────────

type RobotsEntry = { policy: RobotsPolicy | null; expires: number };

export class RobotsCache {
  private entries = new Map<string, RobotsEntry>();
  constructor(private ttlMs = 6 * 3_600_000) {}

  /** null = no se pudo leer por un error del servidor o de red: el RFC pide asumir que no se permite nada. */
  async policyFor(origin: string, load: () => Promise<RobotsPolicy | null>): Promise<RobotsPolicy | null> {
    const hit = this.entries.get(origin);
    if (hit && hit.expires > Date.now()) return hit.policy;
    const policy = await load();
    this.entries.set(origin, { policy, expires: Date.now() + (policy ? this.ttlMs : 10 * 60_000) });
    return policy;
  }
}

const defaultRobots = new RobotsCache();
const defaultGate = new HostGate();

// ─── HTTP con DNS validado ───────────────────────────────────────────────

class BlockedAddressError extends Error {
  code = "EBLOCKED";
}

function guardedLookup(base: typeof dns.lookup, allow: (ip: string) => boolean): LookupFunction {
  return ((hostname: string, options: dns.LookupOptions, callback: (...args: unknown[]) => void) => {
    base(hostname, { ...options, all: true }, (error: NodeJS.ErrnoException | null, addresses: dns.LookupAddress[]) => {
      if (error) return callback(error);
      if (!addresses || addresses.length === 0) return callback(Object.assign(new Error("ENOTFOUND"), { code: "ENOTFOUND" }));
      const bad = addresses.find((a) => !allow(a.address));
      if (bad) return callback(new BlockedAddressError(`Dirección no permitida: ${bad.address}`));
      if (options.all) callback(null, addresses);
      else callback(null, addresses[0].address, addresses[0].family);
    });
  }) as unknown as LookupFunction;
}

type RawResponse = { status: number; headers: http.IncomingHttpHeaders; body: Buffer };

function requestOnce(url: URL, opts: Required<Pick<FetchOptions, "timeoutMs" | "maxBytes" | "userAgent">> & { lookup: LookupFunction; accept: string }): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const client = url.protocol === "https:" ? https : http;
    let settled = false;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      if (deadline) clearTimeout(deadline);
      fn();
    };
    const tooLarge = () => Object.assign(new Error("too_large"), { code: "ETOOLARGE" });
    const req = client.request(
      url,
      {
        method: "GET",
        lookup: opts.lookup,
        agent: false, // sin conexiones reutilizadas: cada visita valida su DNS
        headers: {
          "User-Agent": opts.userAgent,
          Accept: opts.accept,
          "Accept-Language": "es,en;q=0.8",
          "Accept-Encoding": "gzip, deflate, br",
        },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400) {
          res.resume();
          settle(() => resolve({ status, headers: res.headers, body: Buffer.alloc(0) }));
          return;
        }
        const declared = Number(res.headers["content-length"] ?? 0);
        if (declared > opts.maxBytes * 4) {
          settle(() => reject(tooLarge()));
          req.destroy();
          return;
        }
        const encoding = String(res.headers["content-encoding"] ?? "").toLowerCase();
        let stream: NodeJS.ReadableStream & { destroy?: () => void } = res;
        if (encoding.includes("gzip")) stream = res.pipe(zlib.createGunzip());
        else if (encoding.includes("deflate")) stream = res.pipe(zlib.createInflate());
        else if (encoding.includes("br")) stream = res.pipe(zlib.createBrotliDecompress());
        const chunks: Buffer[] = [];
        let size = 0;
        // El límite cuenta lo descomprimido: una "bomba" gzip se corta apenas lo pasa.
        stream.on("data", (chunk: Buffer) => {
          if (settled) return;
          size += chunk.length;
          if (size > opts.maxBytes) {
            settle(() => reject(tooLarge()));
            stream.destroy?.();
            req.destroy();
            return;
          }
          chunks.push(chunk);
        });
        stream.on("end", () => settle(() => resolve({ status, headers: res.headers, body: Buffer.concat(chunks) })));
        stream.on("error", (error) => settle(() => reject(error)));
        res.on("aborted", () => settle(() => reject(Object.assign(new Error("aborted"), { code: "ECONNRESET" }))));
      },
    );
    deadline = setTimeout(() => {
      settle(() => reject(Object.assign(new Error("timeout"), { code: "ETIMEDOUT" })));
      req.destroy();
    }, opts.timeoutMs);
    req.on("error", (error) => settle(() => reject(error)));
    req.end();
  });
}

function decode(body: Buffer, contentType: string): string {
  const declared = /charset\s*=\s*["']?([\w-]+)/i.exec(contentType)?.[1];
  const sniffed = declared ? null : /<meta[^>]+charset\s*=\s*["']?([\w-]+)/i.exec(body.subarray(0, 2048).toString("latin1"))?.[1];
  const charset = (declared ?? sniffed ?? "utf-8").toLowerCase();
  try {
    return new TextDecoder(charset).decode(body);
  } catch {
    return new TextDecoder("utf-8").decode(body);
  }
}

function classify(error: unknown): FetchFailure {
  const code = (error as { code?: string })?.code;
  if (error instanceof BlockedAddressError || code === "EBLOCKED") return "blocked_address";
  if (code === "ETIMEDOUT" || code === "ESOCKETTIMEDOUT") return "timeout";
  if (code === "ETOOLARGE") return "too_large";
  return "network";
}

function statusFailure(status: number): FetchFailure {
  if (status === 401 || status === 403) return "forbidden";
  if (status === 404 || status === 410) return "not_found";
  if (status === 429) return "rate_limited";
  return "http_error";
}

// ─── Punto de entrada ────────────────────────────────────────────────────

async function robotsFor(url: URL, opts: FetchOptions, lookup: LookupFunction, ua: string): Promise<RobotsPolicy | null> {
  const origin = `${url.protocol}//${url.host}`;
  const cache = opts.robots ?? defaultRobots;
  return cache.policyFor(origin, async () => {
    let target = new URL("/robots.txt", origin);
    for (let hop = 0; hop <= 5; hop++) {
      try {
        const res = await requestOnce(target, { timeoutMs: opts.timeoutMs ?? 8000, maxBytes: 512 * 1024, userAgent: ua, lookup, accept: "text/plain,*/*;q=0.5" });
        if (res.status >= 300 && res.status < 400 && res.headers.location) {
          const next = checkUrl(new URL(res.headers.location, target).toString());
          if (!next.ok) return ALLOW_ALL;
          target = next.url;
          continue;
        }
        if (res.status >= 200 && res.status < 300) return parseRobots(decode(res.body, String(res.headers["content-type"] ?? "")));
        if (res.status >= 400 && res.status < 500) return ALLOW_ALL; // sin robots.txt: se permite todo
        return null; // 5xx: no se sabe, no se visita
      } catch (error) {
        const code = classify(error);
        if (code === "blocked_address") throw error; // el dominio apunta a una red privada: no se visita nada
        return code === "too_large" ? ALLOW_ALL : null;
      }
    }
    return ALLOW_ALL;
  });
}

export async function fetchPage(rawUrl: string, opts: FetchOptions = {}): Promise<FetchResult> {
  const first = checkUrl(rawUrl);
  if (!first.ok) return fail(first.reason === "address" ? "blocked_address" : "invalid_url", false, undefined, first.message);
  const now = opts.now ?? new Date();

  if (first.sandbox) {
    const robots = parseRobots(sandboxFetch(new URL("/robots.txt", first.url), now).body);
    if (!robots.allowed(first.url.pathname + first.url.search)) return fail("robots", true);
    const res = sandboxFetch(first.url, now, opts.flash ?? null);
    if (res.status !== 200) return fail(statusFailure(res.status), true, res.status);
    return { ok: true, url: first.url.toString(), status: 200, html: res.body, sandbox: true };
  }

  const allowWeb = opts.allowWeb ?? env().WEB_PRICE_CHECKS === "on";
  if (!allowWeb) return fail("disabled", false);

  const ua = opts.userAgent ?? userAgent();
  const lookup = guardedLookup(opts.lookup ?? dns.lookup, opts.isAllowedAddress ?? isPublicAddress);
  const gate = opts.gate ?? defaultGate;
  let url = first.url;
  const maxRedirects = opts.maxRedirects ?? 4;

  for (let hop = 0; hop <= maxRedirects; hop++) {
    let robots: RobotsPolicy | null;
    try {
      robots = await robotsFor(url, opts, lookup, ua);
    } catch (error) {
      return fail(classify(error), false);
    }
    if (robots === null) return fail("network", false, undefined, "La tienda no respondió; lo intento más tarde.");
    if (!robots.allowed(url.pathname + url.search)) return fail("robots", false);
    const delay = Math.max(opts.minDelayMs ?? 1000, (robots.crawlDelay ?? 0) * 1000);
    let res: RawResponse;
    try {
      res = await gate.run(url.host, delay, () =>
        requestOnce(url, {
          timeoutMs: opts.timeoutMs ?? 8000,
          maxBytes: opts.maxBytes ?? 1_500_000,
          userAgent: ua,
          lookup,
          accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
        }),
      );
    } catch (error) {
      return fail(classify(error), false);
    }
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.location;
      if (!location) return fail("http_error", false, res.status);
      const next = checkUrl(new URL(location, url).toString());
      if (!next.ok) return fail(next.reason === "address" ? "blocked_address" : "invalid_url", false, res.status, next.message);
      if (next.sandbox) return fail("invalid_url", false, res.status);
      url = next.url;
      continue;
    }
    if (res.status < 200 || res.status >= 300) return fail(statusFailure(res.status), false, res.status);
    const contentType = String(res.headers["content-type"] ?? "");
    const looksHtml = /text\/html|application\/xhtml\+xml/i.test(contentType) || (!contentType && /^\s*</.test(res.body.subarray(0, 64).toString("latin1")));
    if (!looksHtml) return fail("not_html", false, res.status);
    return { ok: true, url: url.toString(), status: res.status, html: decode(res.body, contentType), sandbox: false };
  }
  return fail("redirects", false);
}
