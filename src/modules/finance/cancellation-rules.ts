// Seguimiento de una baja pedida con Omni: ¿se volvió a cobrar, ya se confirmó que no, o todavía no se sabe?
// Puro (sin base de datos): se prueba con fechas de ejemplo. Lo usa refreshRecurringCharges cada vez que llegan
// movimientos nuevos (estado de cuenta subido o banco sincronizado).
import { DAY_MS, type Cadence } from "./analyzers";

/**
 * Un cobro hecho justo antes de pedir la baja puede aparecer en el estado de cuenta un par de días después: lo que
 * cae dentro de estos días no se toma como "se volvió a cobrar".
 */
export const CANCEL_GRACE_DAYS = 3;

const CADENCE_DAYS: Record<Cadence, number> = { WEEKLY: 7, MONTHLY: 30.4, QUARTERLY: 91, YEARLY: 365 };

/** Margen después de la fecha esperada del siguiente cobro antes de darlo por no cobrado. */
const CONFIRM_MARGIN_DAYS: Record<Cadence, number> = { WEEKLY: 3, MONTHLY: 7, QUARTERLY: 14, YEARLY: 30 };

export type CancellationOutcome =
  | { status: "charged_again"; chargedAt: Date }
  | { status: "confirmed" }
  | { status: "waiting"; checkAfter: Date };

export function checkCancellation(input: {
  /** Cuándo se aprobó la baja. */
  requestedAt: Date;
  cadence: Cadence;
  /** Último cobro de ese comercio en los movimientos. */
  lastChargedAt: Date | null;
  /** Movimiento más reciente de la cuenta donde se cobra: hasta dónde llegan los datos. */
  dataThrough: Date | null;
}): CancellationOutcome {
  const graceEnd = input.requestedAt.getTime() + CANCEL_GRACE_DAYS * DAY_MS;
  if (input.lastChargedAt && input.lastChargedAt.getTime() > graceEnd) {
    return { status: "charged_again", chargedAt: input.lastChargedAt };
  }
  // El siguiente cobro habría caído un periodo después del último; con margen, si los datos ya pasan de esa fecha y
  // no apareció, la baja está hecha.
  const base = input.lastChargedAt ?? input.requestedAt;
  const checkAfter = new Date(base.getTime() + (CADENCE_DAYS[input.cadence] + CONFIRM_MARGIN_DAYS[input.cadence]) * DAY_MS);
  if (input.dataThrough && input.dataThrough.getTime() >= checkAfter.getTime()) return { status: "confirmed" };
  return { status: "waiting", checkAfter };
}
