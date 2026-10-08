// Textos de las acciones que el usuario aprueba (compartidos por servidor, chat y aprobaciones).
import type { ActionKind } from "@/types/cards";

export const ACTION_KIND_LABEL: Record<ActionKind, string> = {
  PURCHASE: "Compra",
  CANCEL_SUBSCRIPTION: "Cancelación",
  SEND_EMAIL: "Correo",
  CREATE_CALENDAR_EVENT: "Evento",
  SUBMIT_FORM: "Formulario",
  PUBLISH_SITE: "Página web",
};

/** Frase que antecede al título en la boleta: "Omni quiere comprar en SonidoMax". */
export function actionIntro(type: ActionKind, merchant: string | null): string {
  switch (type) {
    case "PURCHASE":
      return merchant ? `Omni quiere comprar en ${merchant}` : "Omni quiere hacer una compra";
    case "CANCEL_SUBSCRIPTION":
      return "Omni quiere darte de baja de";
    case "SEND_EMAIL":
      return "Omni quiere enviar un correo";
    case "CREATE_CALENDAR_EVENT":
      return "Omni quiere agendar";
    case "SUBMIT_FORM":
      return "Omni quiere enviar un formulario";
    case "PUBLISH_SITE":
      return "Omni quiere publicar";
  }
}

/** Etiqueta del monto en la boleta. */
export function amountLabel(type: ActionKind): string {
  return type === "CANCEL_SUBSCRIPTION" ? "Dejas de pagar" : "Total estimado";
}
