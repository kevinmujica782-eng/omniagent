import "server-only";
import { Errors } from "@/lib/errors";
import { planLimitError } from "@/modules/billing/entitlements";
import { PLANS } from "@/modules/billing/plans";
import { collectStrings, sensitiveReason } from "@/modules/memory/memory.rules";
import { slugBase } from "@/modules/sites/sites.rules";
import { findOwnedSite, sitePaths, sitesCreatedThisMonth } from "@/modules/sites/sites.service";
import { siteBriefSchema, type SiteBrief } from "@/modules/sites/sites.types";
import { definePlaybook } from "../engine.types";
import {
  approvePublication,
  rememberSite,
  reviewSite,
  reviseExistingSite,
  siteUpdateInputSchema,
  stageSite,
  writeSite,
  type SiteUpdateInput,
} from "../steps/sites.steps";

/** Una página web muestra datos públicos: nunca números de tarjeta, claves ni llaves. */
function assertNothingSecret(value: unknown): void {
  const reason = sensitiveReason(collectStrings(value).join("\n"));
  if (reason === "tarjeta" || reason === "credencial" || reason === "llave") {
    throw Errors.badRequest("Quita los números de tarjeta, claves o llaves del pedido: una página web nunca los muestra.");
  }
}

// ── Crear ────────────────────────────────────────────────────────────────────

const createReview = reviewSite<SiteBrief>(writeSite);
const createStage = stageSite<SiteBrief>(writeSite, createReview);
const createPublish = approvePublication<SiteBrief>(createStage);
const createMemory = rememberSite<SiteBrief>(writeSite, createStage, createPublish);

/** "Créame una página web": escribirla, revisarla, armar la vista previa, publicarla con aprobación y recordarla. */
export const websiteCreate = definePlaybook({
  id: "website.create",
  module: "GENERAL",
  input: siteBriefSchema,
  title: (brief) => `Crear la página de ${brief.name}`,
  activeKey: (brief) => slugBase(brief.name),
  async preflight(brief, { userId, plan, limits, now }) {
    assertNothingSecret(brief);
    const used = await sitesCreatedThisMonth(userId, now);
    if (used >= limits.monthlySites) {
      throw planLimitError(
        { plan },
        "sites",
        plan === "FREE"
          ? `En el plan Gratis, Omni arma ${limits.monthlySites} página web nueva al mes y ya la usaste. Con Pro son ${PLANS.PRO.monthlySites} al mes.`
          : `Ya armaste las ${limits.monthlySites} páginas web de este mes. Se renueva el día 1.`,
        { limit: limits.monthlySites },
      );
    }
  },
  steps: [writeSite, createReview, createStage, createPublish, createMemory],
  finish({ outputOf }) {
    const staged = outputOf(createStage);
    const publication = outputOf(createPublish);
    if (!staged) return { summary: "Tu página quedó lista.", notify: false };
    const paths = sitePaths(staged.slug);
    if (publication?.published) {
      return { summary: `La página de ${staged.name} ya está en línea.`, href: paths.path, linkLabel: "Abrir tu página", notify: false };
    }
    const why = publication?.decision === "expired" ? "La aprobación venció" : "No la publicaste";
    return {
      summary: `${why}: la página de ${staged.name} quedó como vista previa y solo la ves tú.`,
      href: paths.previewPath,
      linkLabel: "Ver la vista previa",
      notify: false,
    };
  },
});

// ── Cambiar ──────────────────────────────────────────────────────────────────

const updateReview = reviewSite<SiteUpdateInput>(reviseExistingSite);
const updateStage = stageSite<SiteUpdateInput>(reviseExistingSite, updateReview);
const updatePublish = approvePublication<SiteUpdateInput>(updateStage);
const updateMemory = rememberSite<SiteUpdateInput>(reviseExistingSite, updateStage, updatePublish);

/** "Cambia el teléfono de mi página": aplicar el cambio, revisarlo y publicarlo con aprobación. */
export const websiteUpdate = definePlaybook({
  id: "website.update",
  module: "GENERAL",
  input: siteUpdateInputSchema,
  title: () => "Cambiar tu página web",
  activeKey: (input) => slugBase(input.site.replace(/^.*\/s\//, "")),
  async preflight(input, { userId }) {
    assertNothingSecret([input.changes, input.contact]);
    const site = await findOwnedSite(userId, input.site);
    if (site.status === "ARCHIVED") throw Errors.conflict("Esa página está retirada. Pídeme una nueva.");
  },
  steps: [reviseExistingSite, updateReview, updateStage, updatePublish, updateMemory],
  finish({ outputOf }) {
    const staged = outputOf(updateStage);
    const publication = outputOf(updatePublish);
    if (!staged) return { summary: "Tus cambios quedaron listos.", notify: false };
    const paths = sitePaths(staged.slug);
    if (publication?.published) {
      return { summary: `Los cambios de ${staged.name} ya están en línea.`, href: paths.path, linkLabel: "Abrir tu página", notify: false };
    }
    return {
      summary: `Tu página sigue igual: ${publication?.decision === "expired" ? "la aprobación venció" : "no publicaste los cambios"}.`,
      href: paths.previewPath,
      linkLabel: "Ver los cambios",
      notify: false,
    };
  },
});
