import "server-only";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { AppError, Errors } from "@/lib/errors";
import { money } from "@/lib/format";
import { isUuid } from "@/lib/validation";
import { defineTool } from "@/modules/agent/registry";
import { getEntitlements } from "@/modules/billing/entitlements";
import type { AgentCard } from "@/types/cards";
import { listAlertViews } from "./alerts.service";
import { startCheckout } from "./checkout.service";
import {
  archiveTracking,
  checkNow,
  getTrackedDetail,
  listOrderViews,
  listTrackedViews,
  searchOffers,
  trackLink,
  trackManual,
  updateTracking,
} from "./tracking.service";

// Herramientas del concierge de compras. Seguir precios, revisarlos y preparar una compra son acciones directas;
// pagar nunca: la compra queda en la hoja de pago hasta que el usuario pulse Permitir (o Denegar).

const itemId = z.string().describe("id del seguimiento (de concierge_list_tracking o concierge_track_item)");

function assertId(id: string) {
  if (!isUuid(id)) throw Errors.badRequest("Ese id de seguimiento no es válido.");
}

export const conciergeTools = [
  defineTool({
    name: "concierge_search_offers",
    module: "CONCIERGE",
    description:
      "Busca productos, boletos de cine o conciertos, vuelos y hoteles en las tiendas de prueba (sandbox) con su precio de hoy. Úsala cuando el usuario quiera vigilar algo y no tenga el enlace.",
    input: z.object({ query: z.string().min(2).max(120).describe("Lo que busca, en pocas palabras") }),
    async run(input, ctx) {
      const results = searchOffers(input.query, ctx.now);
      return {
        data: {
          sandbox: true,
          results: results.map((r) => ({
            url: r.url,
            title: r.title,
            store: r.merchant,
            price: r.price,
            currency: r.currency,
            kind: r.kind,
            inStock: r.inStock,
            blocked: r.blocked?.message ?? null,
          })),
        },
        cards: results.length
          ? [{ kind: "offers", query: input.query, results, currency: ctx.currency, checkEveryMinutes: (await getEntitlements(ctx.userId)).limits.priceCheckMinutes }]
          : [],
      };
    },
  }),

  defineTool({
    name: "concierge_track_item",
    module: "CONCIERGE",
    description:
      "Empieza a vigilar el precio de un enlace (producto, boleto, vuelo u hotel) y avisa cuando baje de verdad. Lee el precio de la página. Sin enlace, crea un recordatorio que no se revisa solo: pide mejor el enlace o busca con concierge_search_offers.",
    input: z.object({
      url: z.string().max(2000).optional().describe("Enlace de la página del producto"),
      title: z.string().min(2).max(160).optional().describe("Nombre, si no hay enlace o para renombrarlo"),
      target_price: z.number().positive().optional().describe("Precio al que el usuario compraría"),
      drop_alert_pct: z.number().int().min(5).max(80).default(15).describe("Avisar si baja al menos este % frente a lo normal"),
      quantity: z.number().int().min(1).max(10).optional().describe("Cuántas unidades, boletos o noches quiere"),
      read_with_ai: z.boolean().default(false).describe("true solo si el usuario aceptó leer la página con IA"),
      current_price: z.number().positive().optional().describe("Solo sin enlace: precio que el usuario vio"),
      currency: z.string().length(3).optional(),
      kind: z.enum(["PRODUCT", "FLIGHT", "EVENT_TICKET", "HOTEL", "OTHER"]).default("PRODUCT"),
    }),
    async run(input, ctx) {
      if (input.url) {
        try {
          const { item, created } = await trackLink(
            ctx.userId,
            {
              url: input.url,
              title: input.title ?? null,
              targetPrice: input.target_price ?? null,
              dropAlertPct: input.drop_alert_pct,
              quantity: input.quantity,
              useAI: input.read_with_ai,
            },
            ctx.now,
          );
          return {
            data: {
              tracking: true,
              alreadyTracked: !created,
              itemId: item.id,
              title: item.title,
              price: item.currentPrice,
              currency: item.currency,
              checkEveryHours: Math.round(item.checkEveryMinutes / 60),
              readWithAI: item.method === "ai",
            },
            cards: [{ kind: "tracked_item", item }],
          };
        } catch (error) {
          if (error instanceof AppError && error.code === "needs_ai") {
            return { data: { tracking: false, needsAI: true, message: `${error.message} Pregúntale al usuario si quiere que la lea con IA.` } };
          }
          throw error;
        }
      }
      if (!input.title) throw Errors.badRequest("Necesito el enlace del producto o, al menos, su nombre.");
      const item = await trackManual(
        ctx.userId,
        {
          title: input.title,
          kind: input.kind,
          merchant: null,
          currency: (input.currency ?? ctx.currency).toUpperCase(),
          currentPrice: input.current_price ?? null,
          targetPrice: input.target_price ?? null,
          dropAlertPct: input.drop_alert_pct,
        },
        ctx.now,
      );
      return {
        data: { tracking: true, manual: true, itemId: item.id, note: "Sin enlace no se revisa solo: pide el enlace para vigilarlo automáticamente." },
        cards: [{ kind: "tracked_item", item }],
      };
    },
  }),

  defineTool({
    name: "concierge_list_tracking",
    module: "CONCIERGE",
    description: "Lista lo que Omni vigila: precio actual, cambio frente a lo normal, objetivo, estado y próxima revisión.",
    input: z.object({}),
    async run(_input, ctx) {
      const items = await listTrackedViews(ctx.userId, ctx.now);
      return {
        data: items.map((item) => ({
          id: item.id,
          title: item.title,
          kind: item.kind,
          status: item.status,
          store: item.merchant,
          currency: item.currency,
          price: item.currentPrice,
          normalPrice: item.referencePrice,
          changePct: item.changePct,
          lowest: item.lowestPrice,
          target: item.targetPrice,
          inStock: item.inStock,
          health: item.health,
          problem: item.lastError,
          nextCheckAt: item.nextCheckAt,
        })),
      };
    },
  }),

  defineTool({
    name: "concierge_price_history",
    module: "CONCIERGE",
    description: "Historial de precios de un seguimiento (hasta 90 días) con mínimo, máximo y mediana, para decidir si comprar ya o esperar.",
    input: z.object({ watchlist_item_id: itemId }),
    async run(input, ctx) {
      assertId(input.watchlist_item_id);
      const detail = await getTrackedDetail(ctx.userId, input.watchlist_item_id, ctx.now);
      return {
        data: { title: detail.item.title, currency: detail.item.currency, current: detail.item.currentPrice, ...detail.stats, points: detail.points.length },
        cards: [{ kind: "price_history", item: detail.item, points: detail.points, stats: detail.stats }],
      };
    },
  }),

  defineTool({
    name: "concierge_check_now",
    module: "CONCIERGE",
    description: "Revisa ahora mismo el precio de un seguimiento (con límite de frecuencia según el plan).",
    input: z.object({ watchlist_item_id: itemId }),
    async run(input, ctx) {
      assertId(input.watchlist_item_id);
      const result = await checkNow(ctx.userId, input.watchlist_item_id, ctx.now);
      const cards: AgentCard[] = result.alert ? [{ kind: "price_alert", alert: result.alert }] : [{ kind: "tracked_item", item: result.item }];
      return { data: { message: result.message, price: result.item.currentPrice, alert: Boolean(result.alert) }, cards };
    },
  }),

  defineTool({
    name: "concierge_update_tracking",
    module: "CONCIERGE",
    description: "Cambia el precio objetivo, la sensibilidad o la cantidad de un seguimiento, o lo pausa, reanuda o deja de seguir.",
    input: z.object({
      watchlist_item_id: itemId,
      target_price: z.number().positive().nullable().optional().describe("null para quitar el objetivo"),
      drop_alert_pct: z.number().int().min(5).max(80).optional(),
      quantity: z.number().int().min(1).max(10).optional(),
      action: z.enum(["pause", "resume", "stop"]).optional(),
    }),
    async run(input, ctx) {
      assertId(input.watchlist_item_id);
      if (input.action === "stop") {
        const item = await archiveTracking(ctx.userId, input.watchlist_item_id, ctx.now);
        return { data: { stopped: true, title: item.title } };
      }
      const item = await updateTracking(
        ctx.userId,
        input.watchlist_item_id,
        {
          targetPrice: input.target_price,
          dropAlertPct: input.drop_alert_pct,
          quantity: input.quantity,
          status: input.action === "pause" ? "PAUSED" : input.action === "resume" ? "ACTIVE" : undefined,
        },
        ctx.now,
      );
      return { data: { updated: true, status: item.status, target: item.targetPrice, dropAlertPct: item.dropAlertPct }, cards: [{ kind: "tracked_item", item }] };
    },
  }),

  defineTool({
    name: "concierge_list_alerts",
    module: "CONCIERGE",
    description: "Bajadas de precio detectadas en los últimos 7 días, con el resumen de Omni y si ya se preparó la compra.",
    input: z.object({}),
    async run(_input, ctx) {
      const alerts = await listAlertViews(ctx.userId, ctx.now);
      return {
        data: alerts.map((a) => ({
          alertId: a.id,
          itemId: a.itemId,
          title: a.title,
          headline: a.headline,
          price: a.price,
          currency: a.currency,
          dropPct: a.dropPct,
          verdict: a.verdict,
          purchase: a.actionStatus,
        })),
        cards: alerts.slice(0, 3).map((alert) => ({ kind: "price_alert", alert }) as AgentCard),
      };
    },
  }),

  defineTool({
    name: "concierge_propose_purchase",
    module: "CONCIERGE",
    description:
      "Prepara la compra de algo que Omni sigue. NO compra ni cobra: muestra la hoja de pago con el total, y el usuario decide con Permitir o Denegar. El cobro de hoy es simulado.",
    input: z.object({
      watchlist_item_id: itemId,
      quantity: z.number().int().min(1).max(10).optional(),
      max_total: z.number().positive().optional().describe("Total máximo que el usuario aceptó, si lo dijo"),
      alert_id: z.string().optional().describe("Alerta de bajada que originó la compra, si la hay"),
    }),
    async run(input, ctx) {
      assertId(input.watchlist_item_id);
      const checkout = await startCheckout(
        ctx.userId,
        {
          itemId: input.watchlist_item_id,
          quantity: input.quantity,
          alertId: input.alert_id && isUuid(input.alert_id) ? input.alert_id : null,
          conversationId: ctx.conversationId,
          actor: "agent",
        },
        ctx.now,
      );
      if (input.max_total !== undefined && checkout.total > input.max_total) {
        await prisma.agentAction.updateMany({ where: { id: checkout.actionId, status: "PENDING" }, data: { status: "EXPIRED" } });
        return {
          data: {
            proposed: false,
            reason: `El total de hoy (${money(checkout.total, checkout.currency, { cents: true })}) supera el máximo que dijo el usuario.`,
          },
        };
      }
      return {
        data: { proposed: true, actionId: checkout.actionId, total: checkout.total, currency: checkout.currency, status: "esperando Permitir o Denegar" },
        cards: [{ kind: "checkout", checkout }],
      };
    },
  }),

  defineTool({
    name: "concierge_list_orders",
    module: "CONCIERGE",
    description: "Pedidos hechos desde OmniAgent (simulados), con su número, total y entrega.",
    input: z.object({}),
    async run(_input, ctx) {
      const orders = await listOrderViews(ctx.userId, 10);
      return {
        data: orders.map((o) => ({ number: o.orderNumber, title: o.title, total: o.total, currency: o.currency, status: o.status, date: o.createdAt })),
        cards: orders.length ? [{ kind: "orders", items: orders }] : [],
      };
    },
  }),
];
