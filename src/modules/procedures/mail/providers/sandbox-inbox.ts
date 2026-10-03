// Bandeja de prueba: correos ficticios (dominios .test, reservados) con trámites reales de una familia:
// un permiso escolar con PDF rellenable, un reembolso con PDF plano, una cita con invitación .ics,
// una factura, una renovación, una reunión, libros por devolver y ruido (ofertas, envíos).
// Las fechas se calculan desde el día en que se conectó la bandeja, así el escenario no cambia entre sincronizaciones.
import { buildCalendar } from "../../calendar/ics";
import { dayOffset, longDate, numericDate } from "../../time/es-dates";
import { addLocalDays, atLocalTime, localDateKey, localParts, startOfLocalDay } from "../../time/tz";

export type SandboxAttachmentKind = "permission_form" | "reimbursement_form" | "ics_invite";

export interface SandboxAttachment {
  id: string;
  fileName: string;
  mimeType: string;
  size: number;
  kind: SandboxAttachmentKind;
}

export interface SandboxMessage {
  id: string;
  threadId: string;
  from: { name: string; email: string };
  to: string[];
  subject: string;
  bodyText: string;
  receivedAt: Date;
  labels: string[];
  attachments: SandboxAttachment[];
}

export interface SandboxContext {
  /** Inicio del día (hora local) en que se conectó la bandeja. */
  anchor: Date;
  timeZone: string;
  address: string;
  userFirstName: string | null;
}

/** Datos del escenario que también usan los PDF y la invitación (para que todo sea coherente). */
export function scenarioFacts(ctx: SandboxContext) {
  const tz = ctx.timeZone;
  const d = (days: number) => dayOffset(ctx.anchor, days, tz);
  // Lo escolar y las citas caen en días hábiles: sábado y domingo se mueven al lunes (o al viernes, hacia atrás).
  const weekday = (date: Date) => localParts(date, tz).weekday;
  const nextBusinessDay = (date: Date) => addLocalDays(date, weekday(date) === 6 ? 2 : weekday(date) === 0 ? 1 : 0, tz);
  const prevBusinessDay = (date: Date) => addLocalDays(date, weekday(date) === 6 ? -1 : weekday(date) === 0 ? -2 : 0, tz);
  const excursionDay = nextBusinessDay(d(5));
  const permissionDue = prevBusinessDay(addLocalDays(excursionDay, -2, tz));
  const dentalDay = nextBusinessDay(d(6));
  const vaccineDay = nextBusinessDay(d(8));
  return {
    excursionDay,
    permissionDue,
    parentsMeeting: atLocalTime(nextBusinessDay(d(4)), 18, 0, tz),
    dentalStart: atLocalTime(dentalDay, 10, 30, tz),
    dentalEnd: atLocalTime(dentalDay, 11, 15, tz),
    reimbursementDue: d(10),
    consultationDay: d(-9),
    billDue: d(8),
    passportExpiry: d(60),
    libraryDue: d(2),
    vaccineDay,
    vaccineReplyDue: prevBusinessDay(addLocalDays(vaccineDay, -2, tz)),
  };
}

export function sandboxInbox(ctx: SandboxContext): SandboxMessage[] {
  const { timeZone: tz } = ctx;
  const f = scenarioFacts(ctx);
  const at = (days: number, hour: number, minute: number) => atLocalTime(dayOffset(ctx.anchor, days, tz), hour, minute, tz);
  const greeting = ctx.userFirstName ? `Hola, ${ctx.userFirstName}:` : "Hola:";
  const to = [ctx.address];

  const messages: SandboxMessage[] = [
    {
      id: "sbx_msg_permiso_acuario",
      threadId: "sbx_thr_permiso_acuario",
      from: { name: "Carolina Rivera", email: "c.rivera@colegiolospinos.test" },
      to,
      subject: "Permiso para la excursión al Acuario Municipal",
      receivedAt: at(-1, 16, 40),
      labels: ["INBOX", "IMPORTANT"],
      bodyText: [
        "Estimadas familias de 3.º B:",
        "",
        `El ${longDate(f.excursionDay, tz)} haremos una excursión al Acuario Municipal. Saldremos del colegio a las 8:00 y regresaremos a las 14:00. El costo del transporte es de $12.`,
        "",
        `Adjunto el permiso. Por favor, devuélvanlo lleno y firmado a más tardar el ${longDate(f.permissionDue, tz)}, respondiendo a este correo o en la agenda del estudiante.`,
        "",
        "Gracias,",
        "Carolina Rivera",
        "Docente de 3.º B · Colegio Los Pinos",
      ].join("\n"),
      attachments: [
        {
          id: "sbx_att_permiso",
          fileName: "Permiso_excursion_acuario.pdf",
          mimeType: "application/pdf",
          size: 7_900,
          kind: "permission_form",
        },
      ],
    },
    {
      id: "sbx_msg_reembolso",
      threadId: "sbx_thr_reembolso",
      from: { name: "Seguros Horizonte · Reembolsos", email: "reembolsos@seguroshorizonte.test" },
      to,
      subject: "Solicitud de reembolso R-48213: falta el formulario",
      receivedAt: at(-2, 10, 5),
      labels: ["INBOX"],
      bodyText: [
        greeting,
        "",
        `Recibimos la factura de la consulta pediátrica del ${longDate(f.consultationDay, tz, false)} por $180.00. Para procesar tu reembolso necesitamos el formulario de solicitud adjunto, lleno y firmado.`,
        "",
        `Tienes hasta el ${longDate(f.reimbursementDue, tz)} para enviarlo respondiendo a este correo; después la solicitud se cierra.`,
        "",
        "Número de caso: R-48213",
        "",
        "Equipo de Reembolsos · Seguros Horizonte",
      ].join("\n"),
      attachments: [
        {
          id: "sbx_att_reembolso",
          fileName: "Formulario_reembolso_gastos_medicos.pdf",
          mimeType: "application/pdf",
          size: 6_400,
          kind: "reimbursement_form",
        },
      ],
    },
    {
      id: "sbx_msg_cita_dental",
      threadId: "sbx_thr_cita_dental",
      from: { name: "Clínica Dental Sonrisa", email: "citas@clinicasonrisa.test" },
      to,
      subject: "Confirmación de tu cita: limpieza dental",
      receivedAt: at(-3, 9, 12),
      labels: ["INBOX"],
      bodyText: [
        greeting,
        "",
        `Tu cita de limpieza dental quedó para el ${longDate(f.dentalStart, tz)} a las 10:30 con la Dra. Paula Méndez.`,
        "Dirección: Av. Los Álamos 245, consultorio 3",
        "",
        "Llega 10 minutos antes. Si necesitas cambiarla, responde a este correo.",
        "",
        "Clínica Dental Sonrisa",
      ].join("\n"),
      attachments: [
        { id: "sbx_att_cita", fileName: "cita.ics", mimeType: "text/calendar", size: 640, kind: "ics_invite" },
      ],
    },
    {
      id: "sbx_msg_factura_luz",
      threadId: "sbx_thr_factura_luz",
      from: { name: "Energía del Valle", email: "facturas@energiadelvalle.test" },
      to,
      subject: "Tu factura de septiembre ya está disponible",
      receivedAt: at(-4, 7, 30),
      labels: ["INBOX", "CATEGORY_UPDATES"],
      bodyText: [
        greeting,
        "",
        "Tu factura del servicio de energía ya está disponible.",
        "Total a pagar: $96.40",
        `Fecha de vencimiento: ${numericDate(f.billDue, tz)}`,
        "",
        "Evita recargos pagando a tiempo en nuestra app o en bancos autorizados.",
      ].join("\n"),
      attachments: [],
    },
    {
      id: "sbx_msg_pasaporte",
      threadId: "sbx_thr_pasaporte",
      from: { name: "Servicio de Pasaportes", email: "avisos@pasaportes.gob.test" },
      to,
      subject: "Tu pasaporte vence en 60 días",
      receivedAt: at(-5, 11, 0),
      labels: ["INBOX", "IMPORTANT"],
      bodyText: [
        greeting,
        "",
        `Te recordamos que tu pasaporte vence el ${longDate(f.passportExpiry, tz, false)}. Te recomendamos agendar tu cita de renovación con al menos 30 días de anticipación.`,
        "",
        "Requisitos: pasaporte actual, una foto reciente y el comprobante de pago del arancel.",
      ].join("\n"),
      attachments: [],
    },
    {
      id: "sbx_msg_reunion_padres",
      threadId: "sbx_thr_reunion_padres",
      from: { name: "Colegio Los Pinos", email: "comunicaciones@colegiolospinos.test" },
      to,
      subject: "Reunión de padres del primer trimestre",
      receivedAt: at(-2, 13, 20),
      labels: ["INBOX"],
      bodyText: [
        "Estimadas familias:",
        "",
        `Los invitamos a la reunión de padres el ${longDate(f.parentsMeeting, tz)} a las 18:00 en el auditorio del colegio. Duración aproximada: 1 hora.`,
        "",
        "Dirección del Colegio Los Pinos",
      ].join("\n"),
      attachments: [],
    },
    {
      id: "sbx_msg_biblioteca",
      threadId: "sbx_thr_biblioteca",
      from: { name: "Biblioteca Pública Central", email: "avisos@bibliotecacentral.test" },
      to,
      subject: "Recordatorio: tienes libros por devolver",
      receivedAt: at(-1, 8, 0),
      labels: ["INBOX"],
      bodyText: [
        greeting,
        "",
        `Tienes 2 libros prestados que debes devolver antes del ${longDate(f.libraryDue, tz)}. Puedes renovarlos una vez en línea.`,
        "",
        "Biblioteca Pública Central",
      ].join("\n"),
      attachments: [],
    },
    {
      id: "sbx_msg_ofertas",
      threadId: "sbx_thr_ofertas",
      from: { name: "Tienda Hogar+", email: "ofertas@tiendahogarplus.test" },
      to,
      subject: "¡Solo este fin de semana: 30% en electrodomésticos!",
      receivedAt: at(-1, 6, 15),
      labels: ["INBOX", "CATEGORY_PROMOTIONS"],
      bodyText: "Aprovecha descuentos de hasta 30% en licuadoras, cafeteras y más. Oferta válida hasta agotar existencias. Si no quieres recibir más correos, cancela tu suscripción aquí.",
      attachments: [],
    },
    {
      id: "sbx_msg_envio",
      threadId: "sbx_thr_envio",
      from: { name: "EnvíosYa", email: "notificaciones@enviosya.test" },
      to,
      subject: "Tu pedido va en camino",
      // Anoche: así la bandeja inicial es la misma a cualquier hora en que se conecte.
      receivedAt: at(-1, 21, 10),
      labels: ["INBOX", "CATEGORY_UPDATES"],
      bodyText: "Tu pedido #88213 salió del centro de distribución y llegará en 2 a 3 días hábiles. No necesitas hacer nada.",
      attachments: [],
    },
    {
      // Llega después: aparece en una sincronización posterior (así se prueba la sincronización incremental).
      id: "sbx_msg_vacunacion",
      threadId: "sbx_thr_vacunacion",
      from: { name: "Enfermería · Colegio Los Pinos", email: "enfermeria@colegiolospinos.test" },
      to,
      subject: "Jornada de vacunación: confirma tu autorización",
      receivedAt: at(1, 9, 30),
      labels: ["INBOX", "IMPORTANT"],
      bodyText: [
        "Estimadas familias de 3.º B:",
        "",
        `El ${longDate(f.vaccineDay, tz)} tendremos jornada de vacunación contra la influenza en el colegio. Si desean que su hijo o hija participe, confirmen su autorización respondiendo a este correo antes del ${longDate(f.vaccineReplyDue, tz)}.`,
        "",
        "Enfermería · Colegio Los Pinos",
      ].join("\n"),
      attachments: [],
    },
  ];
  return messages;
}

/** Rutina semanal simulada del calendario de prueba (sirve para que las fechas sugeridas eviten choques). */
const WEEKLY: { weekdays: number[]; hour: number; minute: number; minutes: number; title: string }[] = [
  { weekdays: [1], hour: 10, minute: 0, minutes: 60, title: "Reunión de equipo" },
  { weekdays: [3], hour: 12, minute: 30, minutes: 60, title: "Almuerzo con un cliente" },
  { weekdays: [2, 4], hour: 17, minute: 0, minutes: 60, title: "Natación de Sofía" },
  { weekdays: [1, 3, 5], hour: 19, minute: 0, minutes: 60, title: "Gimnasio" },
  { weekdays: [6], hour: 10, minute: 0, minutes: 120, title: "Mercado" },
  { weekdays: [0], hour: 19, minute: 0, minutes: 120, title: "Cena familiar" },
];

function calendarSlug(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Eventos del calendario de prueba entre dos fechas (hora local del usuario). */
export function sandboxWeeklyBusy(
  from: Date,
  to: Date,
  timeZone: string,
): { id: string; title: string; startsAt: Date; endsAt: Date; allDay: boolean }[] {
  const out: { id: string; title: string; startsAt: Date; endsAt: Date; allDay: boolean }[] = [];
  for (let day = startOfLocalDay(from, timeZone); day < to; day = addLocalDays(day, 1, timeZone)) {
    const weekday = localParts(day, timeZone).weekday;
    for (const item of WEEKLY) {
      if (!item.weekdays.includes(weekday)) continue;
      const startsAt = atLocalTime(day, item.hour, item.minute, timeZone);
      const endsAt = new Date(startsAt.getTime() + item.minutes * 60_000);
      if (endsAt <= from || startsAt >= to) continue;
      out.push({ id: `sbx_cal_${localDateKey(day, timeZone)}_${calendarSlug(item.title)}`, title: item.title, startsAt, endsAt, allDay: false });
    }
  }
  return out;
}

/** Invitación (.ics) de la cita dental del escenario, como la mandaría el sistema de la clínica. */
export function sandboxInviteIcs(ctx: SandboxContext): string {
  const f = scenarioFacts(ctx);
  return buildCalendar(
    [
      {
        uid: `cita-dental-${f.dentalStart.toISOString().slice(0, 10)}@clinicasonrisa.test`,
        title: "Limpieza dental · Clínica Dental Sonrisa",
        description: "Cita con la Dra. Paula Méndez. Llega 10 minutos antes.",
        location: "Av. Los Álamos 245, consultorio 3",
        startsAt: f.dentalStart,
        endsAt: f.dentalEnd,
        alarms: [60],
      },
    ],
    { name: "Clínica Dental Sonrisa", timeZone: ctx.timeZone, now: ctx.anchor },
  );
}
