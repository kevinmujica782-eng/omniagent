import "server-only";
import { z } from "zod";
import { Errors } from "@/lib/errors";
import { REASON_LABEL } from "@/lib/returns-copy";
import { isUuid } from "@/lib/validation";
import { defineTool } from "@/modules/agent/registry";
import { localDateKey } from "@/modules/procedures/time/tz";
import type { AgentCard, TrackedOrderView } from "@/types/cards";
import {
  addManualOrder,
  getOrderView,
  listOrderViews,
  refreshReturns,
  reportProblem,
  updateCase,
  updateOrder,
  type CaseUpdate,
} from "./returns.service";

// Herramientas de pedidos y devoluciones. Seguir pedidos, marcarlos y preparar reclamos son acciones directas;
// enviar algo a la tienda nunca: el correo queda en Aprobaciones hasta que el usuario pulse Aprobar.

const REASON = z.enum(["LATE", "NOT_RECEIVED", "DAMAGED", "WRONG_ITEM", "NOT_AS_DESCRIBED", "CHANGED_MIND"]);
const DESIRED = z.enum(["REFUND", "REPLACEMENT", "STORE_CREDIT", "ARRIVED"]);
const DATE = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .describe("Fecha local AAAA-MM-DD");

function assertId(id: string, what: string) {
  if (!isUuid(id)) throw Errors.badRequest(`Ese id de ${what} no es válido.`);
}

/** Lo que recibe el modelo de cada pedido: compacto y en fechas locales. */
function orderData(o: TrackedOrderView, timeZone: string) {
  const day = (iso: string | null) => (iso ? localDateKey(new Date(iso), timeZone) : null);
  return {
    id: o.id,
    merchant: o.merchant,
    title: o.title,
    orderNumber: o.orderNumber,
    total: o.total,
    currency: o.currency,
    status: o.status,
    delivery: o.delivery,
    daysLate: o.daysLate,
    expectedOn: day(o.expectedBy),
    deliveredOn: day(o.deliveredAt),
    returnUntil: day(o.returnBy),
    canEmailStore: Boolean(o.supportEmail),
    sandbox: o.sandbox,
    dismissed: o.dismissed,
    openCase: o.openCase
      ? {
          id: o.openCase.id,
          status: o.openCase.status,
          reason: o.openCase.reason,
          channel: o.openCase.channel,
          pendingApproval: o.openCase.approval?.status === "PENDING",
          nextStep: o.openCase.nextStep,
        }
      : null,
  };
}

const ordersCard = (title: string, items: TrackedOrderView[]): AgentCard => ({ kind: "tracked_orders", title, items: items.slice(0, 8) });

export const returnsTools = [
  defineTool({
    name: "returns_list_orders",
    module: "CONCIERGE",
    description:
      "Lista los pedidos que Omni sigue (comprados con OmniAgent, detectados en el correo o agregados a mano): si van a tiempo, tarde o ya llegaron, hasta cuándo se pueden devolver y si tienen un reclamo abierto. Úsala para \"¿dónde está mi pedido?\", \"no me ha llegado\" o antes de reclamar.",
    input: z.object({
      filter: z.enum(["all", "active", "late", "problems", "delivered"]).default("all").describe("active: en camino; problems: tarde o con reclamo"),
    }),
    async run(input, ctx) {
      await refreshReturns(ctx.userId, ctx.now);
      const items = await listOrderViews(ctx.userId, input.filter, ctx.now, 20);
      const title =
        input.filter === "late" ? "Pedidos con retraso" : input.filter === "problems" ? "Pedidos con problemas" : input.filter === "delivered" ? "Pedidos entregados" : "Tus pedidos";
      return {
        data: {
          count: items.length,
          orders: items.map((o) => orderData(o, ctx.timezone)),
          ...(items.length === 0 ? { hint: "No hay pedidos: pide la tienda, qué compró y la fecha, y usa returns_add_order." } : {}),
        },
        cards: items.length ? [ordersCard(title, items)] : [],
      };
    },
  }),

  defineTool({
    name: "returns_add_order",
    module: "CONCIERGE",
    description:
      "Agrega un pedido para seguirlo hasta que llegue (una compra hecha fuera de OmniAgent). Con la fecha prometida, Omni avisa si se atrasa. Si el usuario da el correo de atención de la tienda, Omni podrá enviarle reclamos (con aprobación).",
    input: z.object({
      merchant: z.string().min(2).max(80).describe("Tienda o marketplace"),
      title: z.string().min(2).max(160).describe("Qué compró"),
      order_number: z.string().max(40).optional(),
      ordered_on: DATE.optional(),
      expected_on: DATE.optional().describe("Día prometido de entrega"),
      delivered_on: DATE.optional().describe("Solo si ya llegó"),
      total: z.number().positive().max(1_000_000).optional(),
      currency: z.string().length(3).optional(),
      support_email: z.email().optional().describe("Correo de atención al cliente de la tienda, si el usuario lo tiene"),
    }),
    async run(input, ctx) {
      const { order, created } = await addManualOrder(
        ctx.userId,
        {
          merchant: input.merchant,
          title: input.title,
          orderNumber: input.order_number ?? null,
          orderedOn: input.ordered_on ?? null,
          expectedOn: input.expected_on ?? null,
          deliveredOn: input.delivered_on ?? null,
          total: input.total ?? null,
          currency: input.currency ?? ctx.currency,
          supportEmail: input.support_email ?? null,
        },
        ctx.now,
      );
      return {
        data: { added: created, alreadyTracked: !created, order: orderData(order, ctx.timezone) },
        cards: [ordersCard(created ? "Pedido agregado" : "Ya lo seguía", [order])],
      };
    },
  }),

  defineTool({
    name: "returns_report_problem",
    module: "CONCIERGE",
    description:
      "Prepara el reclamo o la devolución de un pedido (retraso, no llegó, dañado, producto equivocado, distinto al anuncio o ya no lo quiere). Omni redacta el mensaje con los datos del pedido. Si la tienda atiende por correo y hay bandeja conectada, queda en Aprobaciones; si no, el usuario lo envía desde la tienda con el texto listo. NUNCA se envía solo.",
    input: z.object({
      order_id: z.string().describe("id del pedido (de returns_list_orders o returns_add_order)"),
      reason: REASON,
      desired: DESIRED.optional().describe("Qué pide: reembolso, cambio, saldo a favor o que llegue (retrasos)"),
      details: z.string().max(600).optional().describe("Lo que contó el usuario, con sus palabras (qué se dañó, qué llegó en vez de lo pedido)"),
    }),
    async run(input, ctx) {
      assertId(input.order_id, "pedido");
      const prepared = await reportProblem(
        ctx.userId,
        input.order_id,
        { reason: input.reason, desired: input.desired ?? null, details: input.details ?? null },
        { conversationId: ctx.conversationId, now: ctx.now },
      );
      const c = prepared.returnCase;
      const cards: AgentCard[] = [{ kind: "return_case", returnCase: c }];
      if (prepared.approval && prepared.approval.status === "PENDING") cards.push(prepared.approval);
      return {
        data: {
          caseId: c.id,
          existing: prepared.existing,
          status: c.status,
          reason: REASON_LABEL[c.reason],
          channel: c.channel,
          sendTo: c.sendTo,
          pendingApproval: prepared.approval?.status === "PENDING",
          next:
            c.channel === "EMAIL"
              ? "El correo quedó pendiente: se envía solo si el usuario pulsa Aprobar."
              : c.howToClaim
                ? `El usuario debe enviarlo en la tienda: ${c.howToClaim} Cuando lo haga, marca el reclamo como enviado.`
                : "El usuario debe enviarlo a la tienda (su página, chat o correo) con el texto listo. Cuando lo haga, marca el reclamo como enviado.",
        },
        cards,
      };
    },
  }),

  defineTool({
    name: "returns_update_case",
    module: "CONCIERGE",
    description:
      "Actualiza un reclamo cuando el usuario cuenta algo: que lo envió él mismo (sent), qué respondió la tienda (store_replied, con reply_text si lo pegó o reply_kind si lo resumió), que ya devolvió el paquete (package_sent), que ya mandó los datos que pedían (info_sent), que recibió el dinero (refund_received), o cerrar o reabrir el caso.",
    input: z.object({
      case_id: z.string().describe("id del reclamo (openCase.id de returns_list_orders)"),
      action: z.enum(["sent", "store_replied", "package_sent", "info_sent", "refund_received", "close", "reopen"]),
      reply_text: z.string().max(4000).optional().describe("Texto de la respuesta de la tienda, tal cual"),
      reply_kind: z
        .enum(["refund", "replacement", "store_credit", "return_label", "needs_info", "rejected", "shipping_update", "ack"])
        .optional()
        .describe("Resumen de la respuesta si no hay texto"),
      amount: z.number().positive().max(1_000_000).optional().describe("Monto del reembolso o saldo, si se conoce"),
    }),
    async run(input, ctx) {
      assertId(input.case_id, "reclamo");
      const update: CaseUpdate =
        input.action === "store_replied"
          ? { action: "reply", text: input.reply_text ?? null, kind: input.reply_kind ?? null, amount: input.amount ?? null }
          : input.action === "refund_received"
            ? { action: "refund_received", amount: input.amount ?? null }
            : { action: input.action };
      const updated = await updateCase(ctx.userId, input.case_id, update, { now: ctx.now, conversationId: ctx.conversationId });
      return {
        data: {
          caseId: updated.id,
          status: updated.status,
          outcome: updated.outcome,
          nextStep: updated.nextStep,
          refundAmount: updated.refundAmount,
          escalation: updated.escalation,
        },
        cards: [{ kind: "return_case", returnCase: updated }],
      };
    },
  }),

  defineTool({
    name: "returns_update_order",
    module: "CONCIERGE",
    description:
      "Marca un pedido como entregado, deja de seguirlo (dismiss) o lo vuelve a seguir (restore), o corrige sus datos (edit: tienda, correo de atención, fecha prometida, número o total).",
    input: z.object({
      order_id: z.string(),
      action: z.enum(["delivered", "dismiss", "restore", "edit"]),
      delivered_on: DATE.optional(),
      merchant: z.string().min(2).max(80).optional(),
      title: z.string().min(2).max(160).optional(),
      order_number: z.string().max(40).optional(),
      expected_on: DATE.optional(),
      support_email: z.email().optional(),
      total: z.number().positive().max(1_000_000).optional(),
    }),
    async run(input, ctx) {
      assertId(input.order_id, "pedido");
      if (input.action === "edit") {
        await updateOrder(
          ctx.userId,
          input.order_id,
          {
            action: "edit",
            merchant: input.merchant,
            title: input.title,
            orderNumber: input.order_number,
            expectedOn: input.expected_on,
            supportEmail: input.support_email,
            total: input.total,
          },
          ctx.now,
        );
      } else if (input.action === "delivered") {
        await updateOrder(ctx.userId, input.order_id, { action: "delivered", deliveredOn: input.delivered_on ?? null }, ctx.now);
      } else {
        await updateOrder(ctx.userId, input.order_id, { action: input.action }, ctx.now);
      }
      const order = await getOrderView(ctx.userId, input.order_id, ctx.now);
      return { data: { order: orderData(order, ctx.timezone) }, cards: [ordersCard("Pedido actualizado", [order])] };
    },
  }),
];
