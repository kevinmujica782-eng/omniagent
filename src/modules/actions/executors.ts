import "server-only";
import type { AgentAction } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { Errors } from "@/lib/errors";
import { isUuid } from "@/lib/validation";

// Ejecutores: se llaman SOLO después de que el usuario aprueba (ver actions.service.ts).
// Cancelación asistida, eventos de calendario, envío de correos (con el PDF rellenado) y publicación de páginas web.
// Las compras van por la hoja de pago del módulo de compras, que vuelve a confirmar el precio y cobra con el
// proveedor de pagos.
// Los módulos de trámites se importan al ejecutar para no crear dependencias circulares.

type Payload = Record<string, unknown>;
export type ExecutionResult = { message: string } & Record<string, unknown>;

const str = (p: Payload, key: string) => (typeof p[key] === "string" ? (p[key] as string) : null);

export async function executeAction(action: AgentAction): Promise<ExecutionResult> {
  const payload = (action.payload ?? {}) as unknown as Payload;
  switch (action.type) {
    case "CANCEL_SUBSCRIPTION":
      return cancelSubscription(action.userId, payload);
    case "PURCHASE":
      // Nunca llega aquí: las compras se ejecutan desde la hoja de pago (concierge/checkout.service.ts).
      throw Errors.conflict("Las compras se autorizan en la hoja de pago (Permitir o Denegar).");
    case "CREATE_CALENDAR_EVENT":
      return createCalendarEvent(action.userId, payload);
    case "SEND_EMAIL":
      return sendEmail(action.userId, payload);
    case "SUBMIT_FORM":
      throw Errors.badRequest("El envío directo a portales aún no está disponible: Omni puede enviarlo por correo.");
    case "PUBLISH_SITE":
      return publishSite(action.userId, payload);
    default:
      throw Errors.badRequest("Tipo de acción no soportado.");
  }
}

async function cancelSubscription(userId: string, p: Payload): Promise<ExecutionResult> {
  const id = str(p, "recurringChargeId");
  const charge = id && isUuid(id) ? await prisma.recurringCharge.findFirst({ where: { id, userId } }) : null;
  if (!charge) throw Errors.notFound("La suscripción");

  await prisma.recurringCharge.update({ where: { id: charge.id }, data: { status: "CANCELLATION_REQUESTED" } });
  // Cancelación asistida: sin integración directa con el comercio, dejamos un seguimiento verificable.
  const task = await prisma.task.create({
    data: {
      userId,
      type: "OTHER",
      priority: "MEDIUM",
      source: "agent",
      title: `Confirmar la cancelación de ${charge.merchantName}`,
      notes: charge.cancellationUrl
        ? `Enlace para cancelar: ${charge.cancellationUrl}`
        : "Omni revisará tu próximo estado de cuenta para confirmar que ya no se cobra.",
      dueAt: charge.nextExpectedAt,
    },
  });
  return {
    message: `${charge.merchantName} quedó marcada para cancelar. Si vuelve a cobrarse, te aviso.`,
    mode: "assisted",
    taskId: task.id,
  };
}

async function createCalendarEvent(userId: string, p: Payload): Promise<ExecutionResult> {
  const title = str(p, "title");
  const startsAt = str(p, "startsAt");
  if (!title || !startsAt || Number.isNaN(new Date(startsAt).getTime())) throw Errors.badRequest("Faltan datos del evento.");
  const endsAt = str(p, "endsAt");
  const taskId = str(p, "taskId");
  const task = taskId && isUuid(taskId) ? await prisma.task.findFirst({ where: { id: taskId, userId }, select: { id: true } }) : null;

  const { createCalendarEvents } = await import("@/modules/procedures/calendar/calendar.service");
  const [event] = await createCalendarEvents(userId, task?.id ?? null, [
    {
      kind: "EVENT",
      title,
      location: str(p, "location"),
      startsAt: new Date(startsAt),
      endsAt: endsAt ? new Date(endsAt) : null,
      allDay: false,
      reminderMinutes: [60],
    },
  ]);
  return {
    message:
      event.syncStatus === "SYNCED"
        ? "Evento agendado en tu calendario conectado y en OmniAgent."
        : "Evento guardado en OmniAgent. Suscríbete a tu calendario de OmniAgent o conecta tu correo para verlo también allí.",
    eventId: event.id,
  };
}

async function sendEmail(userId: string, p: Payload): Promise<ExecutionResult> {
  const to = str(p, "to");
  const subject = str(p, "subject");
  const body = str(p, "body");
  if (!to || !subject || !body) throw Errors.badRequest("Faltan datos del correo.");
  const attachmentDocumentId = str(p, "attachmentDocumentId");
  const taskId = str(p, "taskId");

  const { sendMail } = await import("@/modules/procedures/mail/mail.service");
  const sent = await sendMail(userId, {
    to,
    subject,
    body,
    attachmentDocumentId,
    replyToMessageId: str(p, "replyToMessageId"),
    connectionId: str(p, "connectionId"),
  });

  // Enviar el formulario rellenado era el último paso del trámite.
  let completed = false;
  if (attachmentDocumentId && taskId && isUuid(taskId)) {
    const { completeProcedure } = await import("@/modules/procedures/plan");
    completed = await completeProcedure(userId, taskId, "system").then(
      () => true,
      () => false,
    );
  }
  const where = sent.sandbox ? " desde la bandeja de prueba (no sale a internet)" : "";

  // Reclamo (o seguimiento) de Devoluciones: el caso pasa a "esperando a la tienda" y se agenda cuándo insistir.
  const returnCaseId = str(p, "returnCaseId");
  if (returnCaseId) {
    const { markClaimSent } = await import("@/modules/returns/returns.service");
    const marked = await markClaimSent(userId, returnCaseId, { sentAt: sent.sentAt, to: sent.to, messageId: sent.messageId, sandbox: sent.sandbox });
    const next = marked?.followUpText ? ` Si no responde, el ${marked.followUpText} preparo un seguimiento.` : "";
    return {
      message: `${marked?.followUp ? "Seguimiento" : "Reclamo"} enviado a ${sent.to}${where}.${next}`,
      messageId: sent.messageId,
      sandbox: sent.sandbox,
      returnCaseId,
    };
  }
  return {
    message: `Correo enviado a ${sent.to}${where}.${completed ? " Marqué el trámite como hecho." : ""}`,
    messageId: sent.messageId,
    sandbox: sent.sandbox,
  };
}

async function publishSite(userId: string, p: Payload): Promise<ExecutionResult> {
  const siteId = str(p, "siteId");
  if (!siteId || !isUuid(siteId)) throw Errors.notFound("La página");
  const { publishSite: publish } = await import("@/modules/sites/sites.service");
  const site = await publish(userId, siteId);
  return {
    message: str(p, "mode") === "update" ? `Cambios publicados en ${site.url}` : `Tu página ya está en línea: ${site.url}`,
    siteId: site.id,
    url: site.url,
  };
}
