// Estado de la entrega de un pedido y sus plazos: cuándo va tarde, cuándo conviene reclamar, cuándo se da por
// perdido, hasta cuándo se puede devolver y cuándo insistir si la tienda no responde.
// Puro y determinista (en la hora local del usuario): lo usan el servicio, la vista previa y las pruebas.
import { addLocalDays, atLocalTime, localDayDiff, localParts, startOfLocalDay } from "@/modules/procedures/time/tz";

/** Días de retraso a partir de los cuales Omni propone reclamar (un día de gracia para la paquetería). */
export const CLAIM_AFTER_DAYS_LATE = 2;
/** Días de retraso a partir de los cuales el pedido probablemente se perdió. */
export const LOST_AFTER_DAYS_LATE = 10;
/** Días hábiles de espera antes de cada seguimiento: tras el reclamo, tras el primer seguimiento y antes de escalar. */
export const FOLLOW_UP_WAIT_BUSINESS_DAYS = [2, 3, 3] as const;
/** Seguimientos por correo antes de sugerir escalar (plataforma o banco). */
export const MAX_FOLLOW_UPS = 2;
/** Días que Omni busca en tus cuentas un reembolso aprobado (uno por transferencia puede tardar semanas). */
export const REFUND_WATCH_DAYS = 60;

export type ShipmentStatusId = "ORDERED" | "SHIPPED" | "DELIVERED" | "CANCELED";
export type DeliveryKind = "on_the_way" | "due_today" | "late" | "delivered" | "canceled";

export interface OrderTiming {
  status: ShipmentStatusId;
  expectedBy: Date | null;
  deliveredAt: Date | null;
  returnWindowDays: number | null;
}

export interface DeliveryState {
  kind: DeliveryKind;
  /** Días que faltan para la fecha prometida (0 = hoy). */
  daysLeft: number | null;
  /** Días de retraso frente a la fecha prometida. */
  daysLate: number | null;
  /** Ya conviene reclamar (retraso de CLAIM_AFTER_DAYS_LATE días o más). */
  claimable: boolean;
  /** Tanto retraso que probablemente se perdió: se reclama como no recibido. */
  likelyLost: boolean;
  /** Último momento para devolver (fin del día) y días que quedan (negativo: ya venció). */
  returnBy: Date | null;
  returnDaysLeft: number | null;
}

/** 23:59:59.999 del mismo día local. */
export function endOfLocalDay(date: Date, timeZone: string): Date {
  return new Date(startOfLocalDay(addLocalDays(startOfLocalDay(date, timeZone), 1, timeZone), timeZone).getTime() - 1);
}

/** Suma días hábiles (lunes a viernes) en la zona del usuario, conservando la hora local. */
export function addBusinessDays(date: Date, days: number, timeZone: string): Date {
  let out = date;
  let added = 0;
  while (added < days) {
    out = addLocalDays(out, 1, timeZone);
    const weekday = localParts(out, timeZone).weekday;
    if (weekday !== 0 && weekday !== 6) added++;
  }
  return out;
}

export function deliveryState(order: OrderTiming, now: Date, timeZone: string): DeliveryState {
  const base: DeliveryState = {
    kind: "on_the_way",
    daysLeft: null,
    daysLate: null,
    claimable: false,
    likelyLost: false,
    returnBy: null,
    returnDaysLeft: null,
  };
  if (order.status === "CANCELED") return { ...base, kind: "canceled" };
  if (order.status === "DELIVERED" || order.deliveredAt) {
    const returnBy =
      order.deliveredAt && order.returnWindowDays !== null
        ? endOfLocalDay(addLocalDays(order.deliveredAt, order.returnWindowDays, timeZone), timeZone)
        : null;
    return { ...base, kind: "delivered", returnBy, returnDaysLeft: returnBy ? localDayDiff(now, returnBy, timeZone) : null };
  }
  if (!order.expectedBy) return base;
  if (now.getTime() <= order.expectedBy.getTime()) {
    const daysLeft = Math.max(0, localDayDiff(now, order.expectedBy, timeZone));
    return { ...base, kind: daysLeft === 0 ? "due_today" : "on_the_way", daysLeft };
  }
  const daysLate = Math.max(1, localDayDiff(order.expectedBy, now, timeZone));
  return {
    ...base,
    kind: "late",
    daysLate,
    claimable: daysLate >= CLAIM_AFTER_DAYS_LATE,
    likelyLost: daysLate >= LOST_AFTER_DAYS_LATE,
  };
}

/**
 * Cuándo toca revisar si la tienda respondió: a las 9:00 (hora local) del día hábil que corresponde, contado desde
 * el último envío. `done` es cuántos seguimientos ya se hicieron (0 tras el reclamo). Pasado el último, se escala.
 */
export function nextFollowUpAt(lastSentAt: Date, done: number, timeZone: string): Date {
  const wait = FOLLOW_UP_WAIT_BUSINESS_DAYS[Math.min(done, FOLLOW_UP_WAIT_BUSINESS_DAYS.length - 1)];
  return atLocalTime(addBusinessDays(lastSentAt, wait, timeZone), 9, 0, timeZone);
}
