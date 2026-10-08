import "server-only";
import { z } from "zod";
import { defineTool, type AgentTool } from "@/modules/agent/registry";
import { archiveSite, listSites, siteUrl } from "./sites.service";

// Herramientas del agente para las páginas web ya creadas. Crear o cambiar una página va por el motor
// (engine_create_website / engine_update_website), con aprobación para publicar.

const STATUS_TEXT = { DRAFT: "vista previa (sin publicar)", PUBLISHED: "publicada", ARCHIVED: "retirada" } as const;

export const sitesTools: AgentTool[] = [
  defineTool({
    name: "sites_list",
    module: "GENERAL",
    description: "Lista las páginas web que Omni creó para la persona, con su enlace y si están publicadas.",
    input: z.object({}),
    async run(_input, ctx) {
      const sites = await listSites(ctx.userId);
      return {
        data: {
          sites: sites.map((site) => ({
            name: site.name,
            status: STATUS_TEXT[site.status],
            url: site.status === "PUBLISHED" ? siteUrl(site.slug) : null,
            preview: site.status === "ARCHIVED" ? null : site.previewPath,
            pendingChanges: site.hasPendingChanges,
          })),
        },
      };
    },
  }),
  defineTool({
    name: "sites_unpublish",
    module: "GENERAL",
    description: "Retira una página web publicada (su enlace deja de abrir). Solo si la persona lo pide. Identifica la página por su nombre o su enlace.",
    input: z.object({ site: z.string().trim().min(2).max(200).describe("Nombre o enlace de la página") }),
    async run({ site }, ctx) {
      const view = await archiveSite(ctx.userId, site);
      return { data: { name: view.name, status: STATUS_TEXT[view.status] } };
    },
  }),
];
