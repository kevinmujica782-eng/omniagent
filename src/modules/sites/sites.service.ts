import "server-only";
import { randomBytes } from "node:crypto";
import { Prisma, type Site } from "@/generated/prisma/client";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { AppError, Errors } from "@/lib/errors";
import { log } from "@/lib/log";
import { isUuid } from "@/lib/validation";
import { startOfMonthUtc } from "@/modules/billing/entitlements";
import { writeSiteCopy } from "./sites.ai";
import { SLUG_PATTERN, assembleContent, copyOf, copyText, rulesCopy, siteSourceText, slugBase, slugFor } from "./sites.rules";
import {
  siteBriefSchema,
  siteContentSchema,
  type SiteBrief,
  type SiteContactInput,
  type SiteContent,
  type SiteView,
} from "./sites.types";

// Páginas web de cada persona: escribirlas (IA o reglas), guardarlas como vista previa, publicarlas (solo desde una
// aprobación: ver actions/executors.ts), retirarlas y servirlas en /s/{slug}. Solo el servidor toca la tabla sites.

const json = (value: unknown) => value as Prisma.InputJsonValue;
const SLUG_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

function randomSuffix(): string {
  return Array.from(randomBytes(6), (byte) => SLUG_ALPHABET[byte % SLUG_ALPHABET.length]).join("");
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2002";
}

export function sitePaths(slug: string): { path: string; previewPath: string } {
  return { path: `/s/${slug}`, previewPath: `/s/${slug}?vista=previa` };
}

/** Dirección pública completa (para la memoria y para compartir). */
export function siteUrl(slug: string): string {
  return new URL(`/s/${slug}`, env().NEXT_PUBLIC_APP_URL).toString();
}

export function toSiteView(site: Site): SiteView {
  return {
    id: site.id,
    slug: site.slug,
    name: site.name,
    status: site.status,
    ...sitePaths(site.slug),
    hasPendingChanges: site.pendingContent !== null,
    createdAt: site.createdAt.toISOString(),
    publishedAt: site.publishedAt?.toISOString() ?? null,
  };
}

/** Lo que se guardó de lo que pidió la persona (el id del trabajo que la creó queda aparte). */
export function briefOf(site: Pick<Site, "brief">): SiteBrief | null {
  const parsed = siteBriefSchema.safeParse(site.brief);
  return parsed.success ? parsed.data : null;
}

export function contentOf(value: unknown): SiteContent | null {
  const parsed = siteContentSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

// ── Escribir ─────────────────────────────────────────────────────────────────

export interface DraftedSite {
  content: SiteContent;
  generator: "ai" | "rules";
  model: string | null;
}

/** Escribe la página: con IA si está configurada; si la IA falla, por reglas (solo con los datos de la persona). */
export async function draftSite(userId: string, brief: SiteBrief, opts: { model: string; signal?: AbortSignal }): Promise<DraftedSite> {
  if (env().ANTHROPIC_API_KEY) {
    try {
      const copy = await writeSiteCopy({ userId, brief, model: opts.model, signal: opts.signal, source: siteSourceText(brief) });
      return { content: assembleContent(brief, copy), generator: "ai", model: opts.model };
    } catch (error) {
      // Si se cortó por tiempo, que el motor lo reintente; si la IA se negó, la persona tiene que saberlo.
      if (opts.signal?.aborted) throw opts.signal.reason ?? error;
      if (error instanceof AppError && error.status < 500) throw error;
      log.warn("sites.ai_failed", { userId, error });
    }
  }
  return { content: assembleContent(brief, rulesCopy(brief)), generator: "rules", model: null };
}

export interface SiteChangeRequest {
  changes: string;
  contact?: SiteContactInput;
}

/** Datos de contacto nuevos sobre los anteriores (lo que no se indica se conserva). */
export function mergeContact(current: SiteContactInput, update: SiteContactInput | undefined): SiteContactInput {
  const next: SiteContactInput = { ...current };
  for (const [key, value] of Object.entries(update ?? {}) as [keyof SiteContactInput, string | undefined][]) {
    if (value !== undefined && value !== "") next[key] = value;
  }
  return next;
}

/**
 * Cambia una página: la IA aplica lo pedido sobre el texto actual (o el que espera aprobación). Sin IA solo se pueden
 * cambiar los datos de contacto.
 */
export async function reviseSite(
  userId: string,
  site: Site,
  request: SiteChangeRequest,
  opts: { model: string; signal?: AbortSignal },
): Promise<DraftedSite & { brief: SiteBrief; extraSource: string[] }> {
  const stored = briefOf(site);
  const current = contentOf(site.pendingContent) ?? contentOf(site.content);
  if (!stored || !current) throw Errors.conflict("Esta página se hizo con una versión anterior de Omni y no se puede cambiar. Pide una nueva.");
  const brief: SiteBrief = { ...stored, contact: mergeContact(stored.contact, request.contact) };
  const currentCopy = copyOf(current);
  const extraSource = [copyText(currentCopy), request.changes];

  if (!env().ANTHROPIC_API_KEY) {
    if (!request.contact) throw Errors.notConfigured("Cambiar el texto de la página con IA");
    return { content: assembleContent({ ...brief, palette: current.palette }, currentCopy), generator: "rules", model: null, brief, extraSource };
  }
  const copy = await writeSiteCopy({
    userId,
    brief,
    model: opts.model,
    signal: opts.signal,
    source: siteSourceText(brief, extraSource),
    revise: { current: currentCopy, changes: request.changes },
  });
  // La paleta la decide el texto nuevo (la persona pudo pedir otros colores).
  return { content: assembleContent({ ...brief, palette: copy.palette }, copy), generator: "ai", model: opts.model, brief, extraSource };
}

// ── Guardar y publicar ───────────────────────────────────────────────────────

/** Guarda la página nueva como vista previa (solo la ve su dueño). Si el trabajo ya la guardó, devuelve esa. */
export async function saveDraftSite(
  userId: string,
  input: { jobId: string; brief: SiteBrief; content: SiteContent; generator: "ai" | "rules"; model: string | null },
): Promise<SiteView> {
  const existing = await prisma.site.findFirst({ where: { userId, brief: { path: ["jobId"], equals: input.jobId } } });
  if (existing) return toSiteView(existing);
  for (let attempt = 0; attempt < 4; attempt++) {
    const slug = slugFor(input.content.name, randomSuffix());
    try {
      const site = await prisma.site.create({
        data: {
          userId,
          slug,
          name: input.content.name,
          status: "DRAFT",
          content: json(input.content),
          brief: json({ ...input.brief, jobId: input.jobId }),
          generator: input.generator,
          model: input.model,
        },
      });
      await audit({ userId, actor: "agent", action: "site.drafted", entity: "site", entityId: site.id, metadata: { generator: input.generator } });
      return toSiteView(site);
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
    }
  }
  throw Errors.conflict("No pude reservar la dirección de tu página. Inténtalo de nuevo.");
}

/** Deja un cambio esperando aprobación (la página publicada no cambia hasta aprobarlo). */
export async function stageSiteChanges(userId: string, siteId: string, change: { content: SiteContent; brief: SiteBrief }): Promise<SiteView> {
  const site = await findOwnedSiteById(userId, siteId);
  if (site.status === "ARCHIVED") throw Errors.conflict("Esta página está retirada. Pide una nueva.");
  const stored = site.brief as Record<string, unknown>;
  const updated = await prisma.site.update({
    where: { id: site.id },
    data: { pendingContent: json(change.content), brief: json({ ...change.brief, jobId: stored.jobId ?? null }) },
  });
  return toSiteView(updated);
}

/** Publica la página o su cambio pendiente. Solo lo llama el ejecutor de una aprobación PUBLISH_SITE. */
export async function publishSite(userId: string, siteId: string, now = new Date()): Promise<SiteView & { url: string }> {
  const site = await findOwnedSiteById(userId, siteId);
  if (site.status === "ARCHIVED") throw Errors.conflict("Esta página está retirada: pide a Omni una nueva.");
  const content = contentOf(site.pendingContent) ?? contentOf(site.content);
  if (!content) throw Errors.conflict("La página no se pudo leer. Pide a Omni que la arme de nuevo.");
  const updated = await prisma.site.update({
    where: { id: site.id },
    data: {
      content: json(content),
      pendingContent: Prisma.DbNull,
      name: content.name,
      status: "PUBLISHED",
      publishedAt: site.publishedAt ?? now,
      archivedAt: null,
    },
  });
  await audit({ userId, actor: "user", action: "site.published", entity: "site", entityId: site.id });
  return { ...toSiteView(updated), url: siteUrl(updated.slug) };
}

/** Retira una página: su enlace deja de abrir. */
export async function archiveSite(userId: string, ref: string, now = new Date()): Promise<SiteView> {
  const site = await findOwnedSite(userId, ref);
  if (site.status === "ARCHIVED") return toSiteView(site);
  const updated = await prisma.site.update({ where: { id: site.id }, data: { status: "ARCHIVED", archivedAt: now, pendingContent: Prisma.DbNull } });
  await audit({ userId, actor: "user", action: "site.archived", entity: "site", entityId: site.id });
  return toSiteView(updated);
}

// ── Leer ─────────────────────────────────────────────────────────────────────

async function findOwnedSiteById(userId: string, siteId: string): Promise<Site> {
  const site = isUuid(siteId) ? await prisma.site.findFirst({ where: { id: siteId, userId } }) : null;
  if (!site) throw Errors.notFound("La página");
  return site;
}

/** Una página de la persona por su id, su dirección (/s/slug o el enlace completo) o su nombre. */
export async function findOwnedSite(userId: string, ref: string): Promise<Site> {
  const value = ref.trim();
  // isUuid estrecha el tipo: si no es un id, `value` sigue siendo un texto (dirección o nombre).
  const isId: boolean = isUuid(value as unknown);
  if (isId) return findOwnedSiteById(userId, value);
  const slug = value.replace(/^.*\/s\//, "").replace(/[/?#].*$/, "").toLowerCase();
  if (SLUG_PATTERN.test(slug)) {
    const bySlug = await prisma.site.findFirst({ where: { userId, slug } });
    if (bySlug) return bySlug;
  }
  const byName = await prisma.site.findMany({
    where: { userId, status: { not: "ARCHIVED" } },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  const wanted = slugBase(value);
  const match = byName.find((site) => slugBase(site.name) === wanted) ?? byName.find((site) => slugBase(site.name).includes(wanted));
  if (!match) throw Errors.notFound("La página");
  return match;
}

export async function listSites(userId: string): Promise<SiteView[]> {
  const sites = await prisma.site.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 50 });
  return sites.map(toSiteView);
}

/** Páginas nuevas este mes (límite del plan; los cambios no cuentan). */
export async function sitesCreatedThisMonth(userId: string, now = new Date()): Promise<number> {
  return prisma.site.count({ where: { userId, createdAt: { gte: startOfMonthUtc(now) } } });
}

/** La página pública: solo si está publicada. */
export async function getPublishedSite(slug: string): Promise<SiteContent | null> {
  if (!SLUG_PATTERN.test(slug)) return null;
  const site = await prisma.site.findUnique({ where: { slug } });
  return site?.status === "PUBLISHED" ? contentOf(site.content) : null;
}

/** Vista previa para su dueño: el cambio que espera aprobación o, si no hay, lo que se publicaría. */
export async function getSitePreview(slug: string, userId: string): Promise<SiteContent | null> {
  if (!SLUG_PATTERN.test(slug)) return null;
  const site = await prisma.site.findUnique({ where: { slug } });
  if (!site || site.userId !== userId || site.status === "ARCHIVED") return null;
  return contentOf(site.pendingContent) ?? contentOf(site.content);
}
