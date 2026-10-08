// Reglas puras de las páginas web: dirección (slug), contacto y enlaces, revisión del texto (sin datos inventados,
// sin enlaces ajenos, sin pedir claves) y la página por reglas cuando no hay IA. Sin base de datos ni red.
import { listJoin } from "@/lib/format";
import {
  PALETTE_IDS,
  siteContentSchema,
  siteCopySchema,
  type FeatureIcon,
  type PaletteId,
  type SiteBrief,
  type SiteContact,
  type SiteContactInput,
  type SiteContent,
  type SiteCopy,
  type SiteGoal,
  type SiteSection,
} from "./sites.types";

// ── Dirección ────────────────────────────────────────────────────────────────

export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** "Café Ñandú & Co." → "cafe-nandu-co" (máx. 40 caracteres). */
export function slugBase(name: string): string {
  const base = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
  return base || "pagina";
}

/** La dirección lleva un sufijo al azar: no se adivina y dos negocios con el mismo nombre no chocan. */
export function slugFor(name: string, suffix: string): string {
  return `${slugBase(name)}-${suffix}`;
}

// ── Contacto ─────────────────────────────────────────────────────────────────

const digitsOf = (value: string | undefined) => (value ?? "").replace(/\D/g, "");

/** Códigos de país de dos cifras (UIT-T E.164); el 1 y el 7 tienen una y el resto, tres. */
const TWO_DIGIT_COUNTRY_CODES = new Set(
  "20 27 30 31 32 33 34 36 39 40 41 43 44 45 46 47 48 49 51 52 53 54 55 56 57 58 60 61 62 63 64 65 66 81 82 84 86 90 91 92 93 94 95 98".split(" "),
);

/** Grupos para leer el número nacional: 3-4, 4-4, 3-3-3, 3-3-4, 3-4-4 y, más largo, de a tres. */
function groupNational(digits: string): string[] {
  const sizes: Record<number, number[]> = { 7: [3, 4], 8: [4, 4], 9: [3, 3, 3], 10: [3, 3, 4], 11: [3, 4, 4] };
  const plan = sizes[digits.length];
  if (!plan) return digits.match(/.{1,3}/g) ?? [digits];
  const groups: string[] = [];
  let at = 0;
  for (const size of plan) {
    groups.push(digits.slice(at, at + size));
    at += size;
  }
  return groups;
}

/** Un número internacional solo con dígitos, fácil de leer: "584145550101" → "+58 414 555 0101". */
export function formatIntlNumber(digits: string): string {
  const clean = digits.replace(/\D/g, "");
  if (clean.length < 8) return `+${clean}`;
  const ccLength = /^[17]/.test(clean) ? 1 : TWO_DIGIT_COUNTRY_CODES.has(clean.slice(0, 2)) ? 2 : 3;
  return `+${clean.slice(0, ccLength)} ${groupNational(clean.slice(ccLength)).join(" ")}`;
}

function instagramHandle(value: string | undefined): string | null {
  if (!value) return null;
  const handle = value
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/^(?:www\.)?instagram\.com\//i, "")
    .replace(/^@/, "")
    .replace(/[/?#].*$/, "");
  return /^[A-Za-z0-9._]{1,30}$/.test(handle) ? handle : null;
}

/** Solo https y un dominio de verdad; "mitienda.com" se toma como https://mitienda.com. */
function httpsUrl(value: string | undefined): string | null {
  const raw = value?.trim();
  if (!raw || /\s/.test(raw)) return null;
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`);
    if (url.protocol !== "https:" || !url.hostname.includes(".") || url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

/** Contacto como lo dio la persona → datos limpios (lo que no es válido se descarta). */
export function normalizeContact(input: SiteContactInput): SiteContact {
  const whatsapp = digitsOf(input.whatsapp);
  const phone = digitsOf(input.phone);
  return {
    whatsapp: whatsapp.length >= 8 && whatsapp.length <= 15 ? whatsapp : null,
    phone:
      phone.length >= 7 && phone.length <= 15
        ? (input.phone ?? "").replace(/[^\d+()\s-]/g, "").replace(/\s+/g, " ").trim()
        : null,
    email: input.email ? input.email.trim().toLowerCase() : null,
    instagram: instagramHandle(input.instagram),
    website: httpsUrl(input.website),
    address: input.address?.trim() || null,
    hours: input.hours?.trim() || null,
  };
}

export type ContactKind = "whatsapp" | "phone" | "email" | "instagram" | "website";

export interface ContactLink {
  kind: ContactKind;
  label: string;
  /** Lo que se muestra ("+58 414 555 0101", "@cafe.nandu"). */
  detail: string;
  href: string;
}

/** Los enlaces de la página: solo estos, armados con los datos de la persona. */
export function contactLinks(contact: SiteContact): ContactLink[] {
  const links: ContactLink[] = [];
  if (contact.whatsapp) {
    links.push({ kind: "whatsapp", label: "WhatsApp", detail: formatIntlNumber(contact.whatsapp), href: `https://wa.me/${contact.whatsapp}` });
  }
  if (contact.phone) {
    const tel = `${contact.phone.trim().startsWith("+") ? "+" : ""}${digitsOf(contact.phone)}`;
    links.push({ kind: "phone", label: "Teléfono", detail: contact.phone, href: `tel:${tel}` });
  }
  if (contact.email) links.push({ kind: "email", label: "Correo", detail: contact.email, href: `mailto:${contact.email}` });
  if (contact.instagram) {
    links.push({ kind: "instagram", label: "Instagram", detail: `@${contact.instagram}`, href: `https://instagram.com/${contact.instagram}` });
  }
  if (contact.website) {
    links.push({ kind: "website", label: "Web", detail: new URL(contact.website).hostname.replace(/^www\./, ""), href: contact.website });
  }
  return links;
}

/** El botón principal: WhatsApp, si no teléfono, correo, Instagram o la web. */
export function primaryLink(contact: SiteContact): ContactLink | null {
  return contactLinks(contact)[0] ?? null;
}

const GOAL_VERB: Record<SiteGoal, string> = {
  vender: "Haz tu pedido",
  reservas: "Reserva",
  contacto: "Escríbenos",
  portafolio: "Hablemos",
  evento: "Aparta tu lugar",
  informar: "Escríbenos",
};

/** Texto del botón principal según para qué es la página y el contacto que hay. */
export function ctaLabelFor(goal: SiteGoal, link: ContactLink | null): string {
  const verb = GOAL_VERB[goal];
  switch (link?.kind) {
    case "whatsapp":
      return `${verb} por WhatsApp`;
    case "phone":
      return goal === "reservas" ? "Reserva por teléfono" : "Llámanos";
    case "email":
      return `${verb} por correo`;
    case "instagram":
      return "Escríbenos por Instagram";
    case "website":
      return "Visita nuestra web";
    default:
      return "Conoce más";
  }
}

// ── Textos ───────────────────────────────────────────────────────────────────

/** Aplica `fn` a cada texto de la página (sin tocar íconos ni paleta). */
export function mapCopyText(copy: SiteCopy, fn: (value: string) => string): SiteCopy {
  return {
    tagline: fn(copy.tagline),
    hero: { headline: fn(copy.hero.headline), subheadline: fn(copy.hero.subheadline), ctaLabel: fn(copy.hero.ctaLabel) },
    sections: copy.sections.map((section) => mapSectionText(section, fn)),
    closing: copy.closing ? { title: fn(copy.closing.title), text: fn(copy.closing.text) } : null,
    palette: copy.palette,
  };
}

function mapSectionText(section: SiteSection, fn: (value: string) => string): SiteSection {
  switch (section.kind) {
    case "features":
      return { ...section, title: fn(section.title), items: section.items.map((item) => ({ ...item, title: fn(item.title), text: fn(item.text) })) };
    case "about":
      return { ...section, title: fn(section.title), text: fn(section.text) };
    case "steps":
      return { ...section, title: fn(section.title), items: section.items.map((item) => ({ title: fn(item.title), text: fn(item.text) })) };
    case "pricing":
      return {
        ...section,
        title: fn(section.title),
        note: fn(section.note),
        items: section.items.map((item) => ({ name: fn(item.name), price: fn(item.price), detail: fn(item.detail) })),
      };
    case "faq":
      return { ...section, title: fn(section.title), items: section.items.map((item) => ({ question: fn(item.question), answer: fn(item.answer) })) };
  }
}

/** Todos los textos de la página en uno (para revisarlos de una vez). */
export function copyText(copy: SiteCopy): string {
  const parts: string[] = [];
  mapCopyText(copy, (value) => {
    parts.push(value);
    return value;
  });
  return parts.join("\n");
}

/** Los textos de una página ya armada. */
export function copyOf(content: SiteContent): SiteCopy {
  return { tagline: content.tagline, hero: content.hero, sections: content.sections, closing: content.closing, palette: content.palette };
}

const URL_IN_TEXT = /\b(?:https?:\/\/|www\.)[^\s)>\]]+/gi;

/**
 * Sin etiquetas HTML, caracteres de control, marcas de markdown ni direcciones web (los enlaces los pone la app).
 * Los saltos de párrafo se conservan.
 */
export function cleanText(value: string): string {
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(URL_IN_TEXT, " ")
    .replace(/\*\*|__|`|^#+\s*/gm, "")
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ── Cifras ───────────────────────────────────────────────────────────────────
// Una página no puede citar cifras que la persona no dio ("10 años de experiencia", "5.000 clientes", "24/7"). Se
// comparan los números de 2 o más dígitos, sin separadores: "1.500" y "1500" son el mismo.

function numberTokens(text: string): string[] {
  return [...text.matchAll(/\d[\d.,]*\d|\d/g)].map((match) => match[0].replace(/\D/g, "")).filter((digits) => digits.length >= 2);
}

/** Lo que dio la persona: de aquí pueden salir cifras. */
export function siteSourceText(brief: SiteBrief, extra: readonly string[] = []): string {
  const c = brief.contact;
  return [brief.name, brief.about, ...brief.offerings, brief.prices, c.whatsapp, c.phone, c.address, c.hours, ...extra]
    .filter((part): part is string => Boolean(part))
    .join("\n");
}

/** Cifras de la página que no salen de lo que dio la persona. */
export function unsupportedNumbers(copy: SiteCopy, source: string): string[] {
  const allowed = new Set(numberTokens(source));
  return [...new Set(numberTokens(copyText(copy)).filter((digits) => !allowed.has(digits)))];
}

function sentences(text: string): string[] {
  return text.split(/(?<=[.!?…])\s+/).filter(Boolean);
}

/** Quita las frases que citan alguna de esas cifras. */
function dropSentencesWith(text: string, unsupported: ReadonlySet<string>): string {
  return sentences(text)
    .filter((sentence) => numberTokens(sentence).every((digits) => !unsupported.has(digits)))
    .join(" ");
}

// ── Seguridad ────────────────────────────────────────────────────────────────

const ASKS_FOR_SECRETS =
  /\b(?:ingresa|introduce|escribe|env[ií]a(?:nos)?|comparte|d[ií]nos|danos|confirma|actualiza)\s+(?:tu|tus|su|sus)\s+(?:contrase(?:ñ|n)as?|claves?|pin|cvv|cvc|c[oó]digos?|datos bancarios|datos de (?:tu |la )?tarjeta|n[uú]mero de (?:tu |la )?tarjeta|usuario y contrase(?:ñ|n)a)\b/i;

/** ¿La página pide contraseñas, códigos o datos de tarjeta? Una página de Omni nunca los pide. */
export function asksForSecrets(copy: SiteCopy): boolean {
  return ASKS_FOR_SECRETS.test(copyText(copy));
}

// ── Revisión ─────────────────────────────────────────────────────────────────

/** Deja la página válida después de quitar frases: fuera los ítems vacíos y las secciones que quedan cortas. */
export function repairCopy(copy: SiteCopy, fallback: SiteCopy): SiteCopy {
  const sections = copy.sections.flatMap((section): SiteSection[] => {
    if (!section.title) return [];
    switch (section.kind) {
      case "features": {
        const items = section.items.filter((item) => item.title);
        return items.length >= 2 ? [{ ...section, items }] : [];
      }
      case "steps": {
        const items = section.items.filter((item) => item.title);
        return items.length >= 2 ? [{ ...section, items }] : [];
      }
      case "pricing": {
        const items = section.items.filter((item) => item.name && item.price);
        return items.length >= 1 ? [{ ...section, items }] : [];
      }
      case "faq": {
        const items = section.items.filter((item) => item.question && item.answer);
        return items.length >= 2 ? [{ ...section, items }] : [];
      }
      case "about":
        return section.text ? [section] : [];
    }
  });
  return siteCopySchema.parse({
    tagline: copy.tagline,
    hero: {
      headline: copy.hero.headline || fallback.hero.headline,
      subheadline: copy.hero.subheadline,
      ctaLabel: copy.hero.ctaLabel || fallback.hero.ctaLabel,
    },
    sections: sections.length ? sections.slice(0, 6) : fallback.sections,
    closing: copy.closing?.title ? copy.closing : null,
    palette: copy.palette,
  });
}

export type CopyReview = { ok: true; copy: SiteCopy; fixes: string[] } | { ok: false; reason: string };

/**
 * Revisión antes de publicar (sin IA): limpia el texto, quita lo que cite cifras que la persona no dio y rechaza la
 * página si pide claves o datos de tarjeta. `extraSource` suma de dónde pueden salir cifras (al cambiar una página:
 * la página actual y el cambio pedido).
 */
export function reviewCopy(copy: SiteCopy, brief: SiteBrief, extraSource: readonly string[] = []): CopyReview {
  const cleaned = mapCopyText(copy, cleanText);
  if (asksForSecrets(cleaned)) {
    return { ok: false, reason: "La página pedía contraseñas, códigos o datos de tarjeta, y eso no se publica." };
  }
  const fixes: string[] = [];
  if (/<[^>]*>|https?:\/\/|www\./i.test(copyText(copy))) fixes.push("Quité direcciones web y código del texto: los enlaces los pone Omni con tus datos.");
  const unsupported = unsupportedNumbers(cleaned, siteSourceText(brief, extraSource));
  const scrubbed = unsupported.length ? mapCopyText(cleaned, (value) => dropSentencesWith(value, new Set(unsupported))) : cleaned;
  if (unsupported.length) fixes.push(`Quité frases con cifras que no diste (${listJoin(unsupported)}).`);
  return { ok: true, copy: repairCopy(scrubbed, rulesCopy(brief)), fixes };
}

// ── Página por reglas (sin IA) ───────────────────────────────────────────────

const RULE_ICONS: FeatureIcon[] = ["check", "estrella", "chispa", "corazon", "rayo", "etiqueta"];

function truncateWords(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), Math.floor(max / 2))).replace(/[,;:\s]+$/, "")}…`;
}

/** Precios como los dio la persona: en lista si cada línea es "nombre: precio"; si no, tal cual. */
function pricesSection(prices: string | undefined): SiteSection | null {
  const raw = prices?.trim();
  if (!raw) return null;
  const parts = raw
    .split(/\n|;|•/)
    .map((part) => part.trim().replace(/^[-*]\s*/, ""))
    .filter(Boolean);
  const items = parts.flatMap((part) => {
    const match = part.match(/^(.{2,60}?)(?:\s*[:=]\s*|\s+[–—-]\s+)(.{1,40})$/);
    return match && /\d/.test(match[2]) ? [{ name: match[1].trim(), price: match[2].trim(), detail: "" }] : [];
  });
  if (items.length > 0 && items.length === parts.length) return { kind: "pricing", title: "Precios", items: items.slice(0, 8), note: "" };
  return { kind: "about", title: "Precios", text: truncateWords(raw, 900) };
}

/** Paleta fija por nombre (la misma página siempre sale del mismo color si la persona no eligió). */
export function pickPalette(name: string): PaletteId {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return PALETTE_IDS[hash % PALETTE_IDS.length];
}

/** La página solo con los datos de la persona, con sus palabras (cuando no hay IA o la IA falla). */
export function rulesCopy(brief: SiteBrief): SiteCopy {
  const about = sentences(brief.about);
  const link = primaryLink(normalizeContact(brief.contact));
  const sections: SiteSection[] = [];
  if (brief.offerings.length >= 2) {
    sections.push({
      kind: "features",
      title: brief.goal === "vender" ? "Lo que ofrecemos" : "Lo que hacemos",
      items: brief.offerings.slice(0, 6).map((offering, i) => ({ title: truncateWords(offering, 60), text: "", icon: RULE_ICONS[i % RULE_ICONS.length] })),
    });
  }
  const prices = pricesSection(brief.prices);
  if (prices) sections.push(prices);
  // El texto completo va como sección solo si dice más que el titular y la bajada.
  if (about.length > 2 || sections.length === 0) {
    sections.unshift({ kind: "about", title: truncateWords(`Sobre ${brief.name}`, 70), text: truncateWords(brief.about, 900) });
  }
  return siteCopySchema.parse({
    tagline: brief.offerings.length ? truncateWords(listJoin(brief.offerings.slice(0, 3)), 120) : "",
    hero: {
      headline: truncateWords((about[0] ?? brief.name).replace(/[.!?…]+$/, ""), 90),
      subheadline: truncateWords(about.slice(1, 3).join(" "), 240),
      ctaLabel: ctaLabelFor(brief.goal, link),
    },
    sections,
    closing: link ? { title: "¿Hablamos?", text: "Escríbenos y te respondemos." } : null,
    palette: brief.palette ?? pickPalette(brief.name),
  });
}

/** Página completa: los textos más el nombre y el contacto de la persona (la paleta elegida manda). */
export function assembleContent(brief: SiteBrief, copy: SiteCopy): SiteContent {
  return siteContentSchema.parse({ ...copy, palette: brief.palette ?? copy.palette, name: brief.name, contact: normalizeContact(brief.contact) });
}
