import "server-only";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { proposeAction } from "@/modules/actions/actions.service";
import { rememberMemory } from "@/modules/memory/memory.service";
import { assembleContent, copyOf, reviewCopy } from "@/modules/sites/sites.rules";
import {
  draftSite,
  findOwnedSite,
  reviseSite,
  saveDraftSite,
  sitePaths,
  siteUrl,
  stageSiteChanges,
} from "@/modules/sites/sites.service";
import { siteBriefSchema, siteContactInputSchema, siteContentSchema, type SiteBrief } from "@/modules/sites/sites.types";
import { requireOutput } from "../engine.rules";
import { defineStep, done, waitFor, type StepDefinition } from "../engine.types";

// Pasos de las páginas web: escribir (o cambiar), revisar, armar la vista previa, esperar la aprobación para publicar
// y guardarla en la memoria de Omni. Publicar es público y va en nombre de la persona: por eso pasa por Aprobaciones,
// igual que un correo o una compra.

/** Lo que dura la aprobación para publicar antes de vencer. */
const APPROVAL_TTL_HOURS = 72;
const MINUTE = 60_000;

export const siteUpdateInputSchema = z.object({
  site: z.string().trim().min(2).max(200).describe("La página a cambiar: su dirección (/s/…) o su nombre"),
  changes: z.string().trim().min(3).max(800).describe("Qué cambiar, con las palabras de la persona"),
  contact: siteContactInputSchema.optional().describe("Datos de contacto nuevos, solo si los dio"),
});
export type SiteUpdateInput = z.output<typeof siteUpdateInputSchema>;

const draftOutput = z.object({
  /** null: página nueva; con id: cambio a una página existente. */
  siteId: z.string().nullable(),
  brief: siteBriefSchema,
  content: siteContentSchema,
  /** De dónde más pueden salir cifras (al cambiar: la página actual y el cambio pedido). */
  extraSource: z.array(z.string()),
  generator: z.enum(["ai", "rules"]),
  model: z.string().nullable(),
});
type SiteDraft = z.output<typeof draftOutput>;

/** Escribe una página nueva (IA o, sin IA, con las palabras de la persona). */
export const writeSite = defineStep<SiteBrief, SiteDraft>({
  key: "sites.write",
  title: "Escribir tu página",
  module: "GENERAL",
  output: draftOutput,
  timeoutMs: 45_000,
  maxAttempts: 2,
  async run(ctx) {
    const drafted = await draftSite(ctx.userId, ctx.input, { model: ctx.profile.model, signal: ctx.signal });
    return done(
      { siteId: null, brief: ctx.input, content: drafted.content, extraSource: [], generator: drafted.generator, model: drafted.model },
      drafted.generator === "ai" ? "Texto listo, solo con lo que me contaste." : "La armé con tus palabras (la IA no estaba disponible).",
    );
  },
});

/** Aplica lo pedido a una página que ya existe (sobre su versión publicada o la que espera aprobación). */
export const reviseExistingSite = defineStep<SiteUpdateInput, SiteDraft>({
  key: "sites.revise",
  title: "Aplicar tus cambios",
  module: "GENERAL",
  output: draftOutput,
  timeoutMs: 45_000,
  maxAttempts: 2,
  async run(ctx) {
    const site = await findOwnedSite(ctx.userId, ctx.input.site);
    if (site.status === "ARCHIVED") throw new AppError(409, "site_archived", "Esa página está retirada. Pídeme una nueva.");
    const revised = await reviseSite(ctx.userId, site, { changes: ctx.input.changes, contact: ctx.input.contact }, { model: ctx.profile.model, signal: ctx.signal });
    return done(
      { siteId: site.id, brief: revised.brief, content: revised.content, extraSource: revised.extraSource, generator: revised.generator, model: revised.model },
      revised.generator === "ai" ? "Cambios aplicados al texto." : "Actualicé tus datos de contacto.",
    );
  },
});

const reviewedOutput = z.object({ content: siteContentSchema, fixes: z.array(z.string()) });

/** Revisión sin IA: sin cifras que la persona no dio, sin enlaces ajenos, sin pedir claves ni datos de tarjeta. */
export function reviewSite<I>(draft: StepDefinition<never, SiteDraft>): StepDefinition<I, z.output<typeof reviewedOutput>> {
  return defineStep<I, z.output<typeof reviewedOutput>>({
    key: "sites.review",
    title: "Revisar que sea segura",
    module: "GENERAL",
    output: reviewedOutput,
    timeoutMs: 10_000,
    maxAttempts: 1,
    async run(ctx) {
      const drafted = requireOutput(ctx, draft);
      const review = reviewCopy(copyOf(drafted.content), drafted.brief, drafted.extraSource);
      if (!review.ok) throw new AppError(422, "site_rejected", review.reason);
      const content = assembleContent({ ...drafted.brief, palette: drafted.content.palette }, review.copy);
      return done(
        { content, fixes: review.fixes },
        review.fixes.length ? review.fixes.join(" ") : "Sin datos inventados, sin enlaces ajenos y sin pedir claves.",
      );
    },
  });
}

const stagedOutput = z.object({ siteId: z.string(), slug: z.string(), name: z.string(), mode: z.enum(["create", "update"]) });

/** Guarda la vista previa: la página nueva como borrador, o el cambio esperando aprobación (la publicada no cambia). */
export function stageSite<I>(
  draft: StepDefinition<never, SiteDraft>,
  review: StepDefinition<never, z.output<typeof reviewedOutput>>,
): StepDefinition<I, z.output<typeof stagedOutput>> {
  return defineStep<I, z.output<typeof stagedOutput>>({
    key: "sites.preview",
    title: "Armar la vista previa",
    module: "GENERAL",
    output: stagedOutput,
    timeoutMs: 15_000,
    maxAttempts: 2,
    async run(ctx) {
      const drafted = requireOutput(ctx, draft);
      const { content } = requireOutput(ctx, review);
      if (drafted.siteId) {
        const site = await stageSiteChanges(ctx.userId, drafted.siteId, { content, brief: drafted.brief });
        return done({ siteId: site.id, slug: site.slug, name: content.name, mode: "update" }, "Vista previa lista con tus cambios.");
      }
      const site = await saveDraftSite(ctx.userId, {
        jobId: ctx.jobId,
        brief: drafted.brief,
        content,
        generator: drafted.generator,
        model: drafted.model,
      });
      return done({ siteId: site.id, slug: site.slug, name: site.name, mode: "create" }, "Vista previa lista: por ahora solo la ves tú.");
    },
  });
}

const publishOutput = z.object({ published: z.boolean(), decision: z.enum(["approved", "rejected", "expired"]) });

/** Una propuesta abierta de este mismo trabajo (si un intento anterior alcanzó a crearla, no se duplica). */
async function openProposal(userId: string, jobId: string): Promise<string | null> {
  const action = await prisma.agentAction.findFirst({
    where: { userId, type: "PUBLISH_SITE", status: "PENDING", payload: { path: ["jobId"], equals: jobId } },
    select: { id: true },
  });
  return action?.id ?? null;
}

/**
 * Pide la aprobación para publicar y espera la decisión. El trabajo se pausa (sin ocupar al servidor) y sigue solo
 * cuando la persona aprueba o rechaza en Aprobaciones, o cuando la aprobación vence.
 */
export function approvePublication<I>(stage: StepDefinition<never, z.output<typeof stagedOutput>>): StepDefinition<I, z.output<typeof publishOutput>> {
  return defineStep<I, z.output<typeof publishOutput>>({
    key: "sites.publish",
    title: "Esperar tu aprobación para publicar",
    module: "GENERAL",
    output: publishOutput,
    timeoutMs: 15_000,
    maxAttempts: 3,
    async run(ctx) {
      const staged = requireOutput(ctx, stage);
      const waitNote = staged.mode === "create" ? "Mira la vista previa y apruébala para publicarla." : "Mira la vista previa y aprueba los cambios.";
      const actionId = ctx.resumed?.actionIds[0] ?? (await openProposal(ctx.userId, ctx.jobId));

      if (!actionId) {
        const card = await proposeAction({
          userId: ctx.userId,
          conversationId: ctx.conversationId,
          module: "GENERAL",
          type: "PUBLISH_SITE",
          title: staged.name,
          summary:
            staged.mode === "create"
              ? "Tu página nueva queda pública en este enlace. Mira la vista previa antes de decidir."
              : "Los cambios se publican en tu página. Mira la vista previa antes de decidir.",
          lines: [{ label: "Enlace", value: siteUrl(staged.slug) }],
          link: { label: "Ver la vista previa", href: sitePaths(staged.slug).previewPath },
          payload: { siteId: staged.siteId, mode: staged.mode, jobId: ctx.jobId },
          ttlHours: APPROVAL_TTL_HOURS,
          now: ctx.now,
        });
        return waitFor({
          note: waitNote,
          actionIds: [card.actionId],
          recheckAt: new Date(ctx.now.getTime() + APPROVAL_TTL_HOURS * 60 * MINUTE + MINUTE),
        });
      }

      const action = await prisma.agentAction.findFirst({
        where: { id: actionId, userId: ctx.userId },
        select: { status: true, expiresAt: true, decidedAt: true, errorMessage: true },
      });
      if (!action || action.status === "EXPIRED" || (action.status === "PENDING" && action.expiresAt !== null && action.expiresAt <= ctx.now)) {
        return done({ published: false, decision: "expired" }, "La aprobación venció: la página queda como vista previa.");
      }
      switch (action.status) {
        case "EXECUTED":
          return done({ published: true, decision: "approved" }, staged.mode === "create" ? "Aprobada y publicada." : "Cambios aprobados y publicados.");
        case "REJECTED":
          return done({ published: false, decision: "rejected" }, staged.mode === "create" ? "No la publicaste: queda como vista previa." : "No publicaste los cambios: tu página sigue igual.");
        case "FAILED":
          throw new AppError(409, "publish_failed", action.errorMessage ?? "No se pudo publicar la página.");
        case "APPROVED":
          // Aprobada y publicándose; si quedó así más de 10 minutos, la publicación se cortó.
          if (action.decidedAt && ctx.now.getTime() - action.decidedAt.getTime() > 10 * MINUTE) {
            throw new AppError(409, "publish_stuck", "La publicación se quedó a medias. Pídemela de nuevo.");
          }
          return waitFor({ note: waitNote, actionIds: [actionId], recheckAt: new Date(ctx.now.getTime() + 2 * MINUTE) });
        default:
          return waitFor({
            note: waitNote,
            actionIds: [actionId],
            recheckAt: action.expiresAt ? new Date(action.expiresAt.getTime() + MINUTE) : new Date(ctx.now.getTime() + 60 * MINUTE),
          });
      }
    },
  });
}

/** Hoy en la zona de la persona (AAAA-MM-DD). */
function today(timeZone: string, now: Date): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

/** La página queda en la memoria de Omni (con su enlace y si está publicada), para recordarla en otras charlas. */
export function rememberSite<I>(
  draft: StepDefinition<never, SiteDraft>,
  stage: StepDefinition<never, z.output<typeof stagedOutput>>,
  publish: StepDefinition<never, z.output<typeof publishOutput>>,
): StepDefinition<I, { memoryId: string }> {
  return defineStep<I, { memoryId: string }>({
    key: "sites.memory",
    title: "Guardarla en tu memoria",
    module: "GENERAL",
    output: z.object({ memoryId: z.string() }),
    timeoutMs: 10_000,
    maxAttempts: 2,
    optional: true,
    async run(ctx) {
      const drafted = requireOutput(ctx, draft);
      const staged = requireOutput(ctx, stage);
      const { published } = requireOutput(ctx, publish);
      // Un cambio rechazado no despublica: lo que cuenta es cómo quedó la página.
      const site = await prisma.site.findFirst({ where: { id: staged.siteId, userId: ctx.userId }, select: { status: true } });
      const live = site?.status === "PUBLISHED";
      const { memory } = await rememberMemory(
        ctx.userId,
        {
          kind: "WEBSITE",
          title: staged.name,
          data: {
            url: siteUrl(staged.slug),
            platform: "OmniAgent",
            purpose: drafted.brief.about.slice(0, 280),
            status: live ? "publicada" : "en_construccion",
            stack: [],
            ...(published && staged.mode === "create" ? { launchedOn: today(ctx.profile.timezone, ctx.now) } : {}),
          },
        },
        { source: "SYSTEM", conversationId: ctx.conversationId, now: ctx.now },
      );
      return done({ memoryId: memory.id }, live ? "La recordaré con su enlace." : "La recordaré como vista previa.");
    },
  });
}
