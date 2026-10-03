// robots.txt según el RFC 9309: grupos por User-agent, reglas Allow/Disallow con "*" y "$",
// gana la regla más larga y, si empatan, Allow. Sin dependencias de servidor.

export const BOT_TOKEN = "OmniAgentBot";

type Rule = { allow: boolean; pattern: string; regex: RegExp };
type Group = { agents: string[]; rules: Rule[]; crawlDelay: number | null };

export interface RobotsPolicy {
  /** ¿Se puede visitar esta ruta (path + query)? */
  allowed(pathWithQuery: string): boolean;
  /** Segundos entre visitas pedidos por el sitio (Crawl-delay, no estándar), con tope. */
  crawlDelay: number | null;
  /** El sitio tiene reglas específicas para OmniAgentBot. */
  specific: boolean;
}

const MAX_BYTES = 512 * 1024; // el RFC pide leer al menos 500 KiB
const MAX_CRAWL_DELAY = 30;

function normalizePath(value: string): string {
  // Compara con los %XX decodificados (el RFC compara octetos) y sin distinguir la codificación de "/" y "?".
  try {
    return decodeURI(value);
  } catch {
    return value;
  }
}

function compile(pattern: string): RegExp {
  const anchored = pattern.endsWith("$");
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const source = body
    .split("*")
    .map((part) => normalizePath(part).replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${source}${anchored ? "$" : ""}`);
}

export function parseRobots(text: string, token = BOT_TOKEN): RobotsPolicy {
  const groups: Group[] = [];
  let current: Group | null = null;
  let collectingAgents = false;
  for (const rawLine of text.slice(0, MAX_BYTES).split(/\r\n|\r|\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (key === "user-agent") {
      if (!collectingAgents || !current) {
        current = { agents: [], rules: [], crawlDelay: null };
        groups.push(current);
        collectingAgents = true;
      }
      current.agents.push(value.toLowerCase());
      continue;
    }
    if (!current) continue; // reglas antes de cualquier User-agent: se ignoran
    collectingAgents = false;
    if (key === "allow" || key === "disallow") {
      if (!value) continue; // "Disallow:" vacío no restringe nada
      const pattern = value.startsWith("/") || value.startsWith("*") ? value : `/${value}`;
      current.rules.push({ allow: key === "allow", pattern, regex: compile(pattern) });
    } else if (key === "crawl-delay") {
      const seconds = Number(value);
      if (Number.isFinite(seconds) && seconds >= 0) current.crawlDelay = Math.min(MAX_CRAWL_DELAY, seconds);
    }
  }

  const me = token.toLowerCase();
  const specific = groups.filter((g) => g.agents.some((agent) => agent === me || (agent !== "*" && me.startsWith(agent))));
  const chosen = specific.length > 0 ? specific : groups.filter((g) => g.agents.includes("*"));
  const rules = chosen.flatMap((g) => g.rules);
  const delays = chosen.map((g) => g.crawlDelay).filter((d): d is number => d !== null);

  return {
    specific: specific.length > 0,
    crawlDelay: delays.length ? Math.max(...delays) : null,
    allowed(pathWithQuery: string) {
      const path = normalizePath(pathWithQuery || "/");
      if (path === "/robots.txt") return true;
      let best: Rule | null = null;
      for (const rule of rules) {
        if (!rule.regex.test(path)) continue;
        if (
          !best ||
          rule.pattern.length > best.pattern.length ||
          (rule.pattern.length === best.pattern.length && rule.allow && !best.allow)
        ) {
          best = rule;
        }
      }
      return best ? best.allow : true;
    },
  };
}

/** Sin robots.txt (404 u otro 4xx) se puede visitar todo, según el RFC. */
export const ALLOW_ALL: RobotsPolicy = { allowed: () => true, crawlDelay: null, specific: false };
