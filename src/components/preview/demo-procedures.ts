// Trámites de ejemplo para /preview: la bandeja de prueba pasa por las mismas reglas, el mismo planificador
// y la misma vista que en producción (sin base de datos ni IA). Así las capturas muestran el comportamiento real.
import { parseIcs } from "@/modules/procedures/calendar/ics";
import type { BusyBlock } from "@/modules/procedures/calendar/scheduler";
import {
  sandboxInbox,
  sandboxInviteIcs,
  sandboxWeeklyBusy,
  type SandboxContext,
  type SandboxMessage,
} from "@/modules/procedures/mail/providers/sandbox-inbox";
import { triageWithRules, type TriageResult } from "@/modules/procedures/mail/triage/rules";
import { calendarEventsFor, draftFromTriage, factsFrom, nextDateOf, procedureView, type PlanDraft } from "@/modules/procedures/plan-rules";
import { addLocalDays, startOfLocalDay } from "@/modules/procedures/time/tz";
import type {
  AgendaItemView,
  CalendarSyncView,
  ChatMessageView,
  FormCard,
  FormDocumentView,
  FormExtractionView,
  InboxDigestCard,
  MailboxView,
  PersonalDataView,
  ProcedureView,
  TaskStatusId,
} from "@/types/cards";

const DAY = 86_400_000;
const ADDRESS = "laura.demo@correo-demo.test";

/** Formularios que llegan en la bandeja de prueba (ids de documento de ejemplo). */
const FORMS: Record<string, { id: string; fileName: string; missing: number }> = {
  sbx_msg_permiso_acuario: { id: "demo-form-permiso", fileName: "Permiso_excursion_acuario.pdf", missing: 1 },
  sbx_msg_reembolso: { id: "demo-form-reembolso", fileName: "Formulario_reembolso_gastos_medicos.pdf", missing: 2 },
};

/** Estado de cada trámite en la pantalla de Trámites (en el chat, todos llegan como sugeridos). */
const STATUS: Record<string, TaskStatusId> = {
  sbx_msg_cita_dental: "PENDING",
  sbx_msg_factura_luz: "PENDING",
  sbx_msg_biblioteca: "DONE",
};

function urgency(result: TriageResult): number {
  const dates = [result.dueAt, result.eventStartsAt].filter((d): d is Date => d !== null).map((d) => d.getTime());
  return dates.length ? Math.min(...dates) : Number.MAX_SAFE_INTEGER;
}

export function demoProcedures(now: Date, timeZone: string) {
  const ctx: SandboxContext = { anchor: startOfLocalDay(now, timeZone), timeZone, address: ADDRESS, userFirstName: "Laura" };
  const calendar = sandboxWeeklyBusy(now, new Date(now.getTime() + 60 * DAY), timeZone);
  const busy: BusyBlock[] = calendar.map((e) => ({ start: e.startsAt, end: e.endsAt, title: e.title }));
  const invite = parseIcs(sandboxInviteIcs(ctx), timeZone);
  const received = sandboxInbox(ctx).filter((m) => m.receivedAt <= now);

  const triaged = received.map((message) => ({
    message,
    triage: triageWithRules(
      {
        subject: message.subject,
        fromName: message.from.name,
        fromEmail: message.from.email,
        bodyText: message.bodyText,
        labels: message.labels,
        attachments: message.attachments.map((a) => ({ fileName: a.fileName, mimeType: a.mimeType })),
        receivedAt: message.receivedAt,
        ics: message.attachments.some((a) => a.kind === "ics_invite") ? invite : [],
      },
      now,
      timeZone,
    ),
  }));

  // Igual que el servicio de clasificación: lo más urgente primero y cada sugerencia ocupa su horario.
  const plans: { message: SandboxMessage; draft: PlanDraft }[] = [];
  for (const { message, triage } of triaged.filter((t) => t.triage.actionRequired).sort((a, b) => urgency(a.triage) - urgency(b.triage))) {
    const draft = draftFromTriage(triage, message.subject, { now, timeZone, busy });
    if (!draft) continue;
    plans.push({ message, draft });
    if (draft.plannedAt) {
      const title = draft.title.length > 40 ? `${draft.title.slice(0, 39).trimEnd()}…` : draft.title;
      busy.push({ start: draft.plannedAt, end: new Date(draft.plannedAt.getTime() + 30 * 60_000), title });
    }
  }

  const view = (message: SandboxMessage, draft: PlanDraft, status: TaskStatusId): ProcedureView => {
    const form = FORMS[message.id];
    return procedureView(
      {
        taskId: `demo-${message.id}`,
        status,
        type: draft.type,
        title: draft.title,
        notes: draft.notes,
        dueAt: draft.dueAt,
        plannedAt: draft.plannedAt,
        remindAt: status === "DONE" ? null : draft.remindAt,
        confirmedAt: status === "SUGGESTED" ? null : new Date(now.getTime() - 3_600_000),
        completedAt: status === "DONE" ? new Date(now.getTime() - 2 * 3_600_000) : null,
        metadata: draft.meta,
        mail: { fromName: message.from.name, fromEmail: message.from.email, subject: message.subject, receivedAt: message.receivedAt },
        calendarSynced: status !== "SUGGESTED",
        documents: form
          ? [{ id: form.id, fileName: form.fileName, extracted: true, missingCount: form.missing, filledDocumentId: null, filledFileName: null }]
          : [],
      },
      now,
      timeZone,
    );
  };

  const allSuggested = plans.map(({ message, draft }) => view(message, draft, "SUGGESTED"));
  const board = plans.map(({ message, draft }) => view(message, draft, STATUS[message.id] ?? "SUGGESTED"));
  const suggested = board.filter((p) => p.status === "SUGGESTED").sort((a, b) => nextDateOf(a) - nextDateOf(b));
  const active = board.filter((p) => p.status === "PENDING" || p.status === "IN_PROGRESS").sort((a, b) => nextDateOf(a) - nextDateOf(b));
  const done = board.filter((p) => p.status === "DONE");

  // Agenda de la semana: eventos de lo confirmado y lo ocupado del calendario de prueba.
  const weekEnd = addLocalDays(startOfLocalDay(now, timeZone), 7, timeZone);
  const agenda: AgendaItemView[] = [];
  for (const { message, draft } of plans) {
    if (STATUS[message.id] !== "PENDING") continue;
    const facts = factsFrom(draft.title, draft.dueAt ? { at: draft.dueAt, hasTime: draft.meta.dueHasTime } : null, draft.meta);
    const events = calendarEventsFor(
      facts,
      { plannedAt: draft.plannedAt, plannedEndAt: draft.meta.plannedEndAt ? new Date(draft.meta.plannedEndAt) : null },
      draft.meta.steps,
      now,
      timeZone,
    );
    events.forEach((event, index) =>
      agenda.push({
        id: `demo-evt-${message.id}-${index}`,
        kind: event.kind,
        title: event.title,
        startsAt: event.startsAt.toISOString(),
        endsAt: event.endsAt?.toISOString() ?? null,
        allDay: event.allDay,
        location: event.location,
        taskId: `demo-${message.id}`,
        synced: true,
      }),
    );
  }
  for (const block of calendar) {
    if (block.startsAt >= weekEnd || block.endsAt <= now) continue;
    agenda.push({
      id: `demo-busy-${block.id}`,
      kind: "BUSY",
      title: block.title,
      startsAt: block.startsAt.toISOString(),
      endsAt: block.endsAt.toISOString(),
      allDay: false,
      location: null,
      taskId: null,
      synced: true,
    });
  }
  const weekAgenda = agenda
    .filter((item) => new Date(item.startsAt) < weekEnd && new Date(item.endsAt ?? item.startsAt) >= startOfLocalDay(now, timeZone))
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));

  const mailbox: MailboxView = {
    id: "demo-mailbox",
    address: ADDRESS,
    displayName: "Correo de prueba (estilo Gmail)",
    flavor: "gmail",
    provider: "sandbox",
    status: "ACTIVE",
    lastSyncedAt: new Date(now.getTime() - 25 * 60_000).toISOString(),
    messageCount: received.length,
  };

  const calendarSync: CalendarSyncView = {
    calendars: [{ id: "demo-mailbox", name: mailbox.displayName, address: ADDRESS }],
    feedUrl: "https://omniagent.example/api/calendar/8f14e45f-ceea-467a-9575-6d8f1c3b2a10.q3Vx9kLmR2tYp8WnZs4HcA7uEo1BdF6g.ics",
    webcalUrl: "webcal://omniagent.example/api/calendar/8f14e45f-ceea-467a-9575-6d8f1c3b2a10.q3Vx9kLmR2tYp8WnZs4HcA7uEo1BdF6g.ics",
  };

  const permission = plans.find((p) => p.message.id === "sbx_msg_permiso_acuario");
  const today = new Intl.DateTimeFormat("es-US", { day: "2-digit", month: "2-digit", year: "numeric", timeZone }).format(now);
  const formExtraction: FormExtractionView = {
    documentId: "demo-form-permiso",
    fileName: "Permiso_excursion_acuario.pdf",
    title: "Permiso para la excursión al Acuario Municipal",
    docType: "permiso",
    issuer: "Colegio Los Pinos",
    summary: "Autorización para que Sofía (3.º B) salga con su curso al Acuario Municipal. Hay que devolverla firmada a la docente.",
    dueDate: permission?.draft.dueAt?.toISOString().slice(0, 10) ?? null,
    person: "Sofía",
    requiresSignature: true,
    steps: ["Marcar la autorización", "Firmar el permiso", "Enviarlo a c.rivera@colegiolospinos.test"],
    source: "AI",
    flat: false,
    pageCount: 1,
    fields: [
      { id: "f1", label: "Nombre del estudiante", kind: "text", value: "Sofía Gómez Rivas", source: "mis_datos", confidence: 0.97, required: true, note: null, page: 1, profileKey: { key: "full_name", person: "Sofía" } },
      { id: "f2", label: "Grado y sección", kind: "text", value: "3.º B", source: "mis_datos", confidence: 0.95, required: true, note: null, page: 1, profileKey: { key: "grade", person: "Sofía" } },
      { id: "f3", label: "Nombre completo del acudiente", kind: "text", value: "Laura Gómez Rivas", source: "mis_datos", confidence: 0.96, required: true, note: null, page: 1, profileKey: { key: "full_name", person: "yo" } },
      { id: "f4", label: "Teléfono de contacto", kind: "text", value: "+1 305 555 0142", source: "mis_datos", confidence: 0.95, required: true, note: null, page: 1, profileKey: { key: "phone", person: "yo" } },
      { id: "f5", label: "Contacto de emergencia (nombre y teléfono)", kind: "text", value: "Andrés Gómez · +1 305 555 0178", source: "mis_datos", confidence: 0.9, required: false, note: null, page: 1, profileKey: { key: "emergency_contact", person: "yo" } },
      { id: "f6", label: "Alergias o condiciones médicas", kind: "text", value: "Ninguna", source: "mis_datos", confidence: 0.8, required: false, note: null, page: 1, profileKey: { key: "allergies", person: "Sofía" } },
      { id: "f7", label: "Autorizo a mi hijo(a) a participar en la salida pedagógica al Acuario Municipal", kind: "checkbox", value: null, source: "vacio", confidence: 0, required: true, note: "Confírmalo tú", page: 1, profileKey: null },
      { id: "f8", label: "Firma del padre, madre o acudiente", kind: "signature", value: null, source: "vacio", confidence: 0, required: true, note: "Fírmalo tú", page: 1, profileKey: null },
      { id: "f9", label: "Fecha", kind: "date", value: today, source: "fecha_de_hoy", confidence: 0.99, required: false, note: null, page: 1, profileKey: null },
    ],
    filledDocumentId: null,
    filledAt: null,
    taskId: "demo-sbx_msg_permiso_acuario",
    mail: { subject: "Permiso para la excursión al Acuario Municipal", from: "Carolina Rivera", replyTo: "c.rivera@colegiolospinos.test" },
    note: null,
  };

  const forms: FormDocumentView[] = [
    {
      id: "demo-form-permiso",
      fileName: "Permiso_excursion_acuario.pdf",
      source: "email",
      createdAt: new Date(now.getTime() - 20 * 3_600_000).toISOString(),
      taskId: "demo-sbx_msg_permiso_acuario",
      taskTitle: permission?.draft.title ?? null,
      title: formExtraction.title,
      extracted: true,
      readWithAI: true,
      totalFields: 8,
      missingCount: 1,
      filledDocumentId: null,
      filledFileName: null,
      filledAt: null,
    },
    {
      id: "demo-form-reembolso",
      fileName: "Formulario_reembolso_gastos_medicos.pdf",
      source: "email",
      createdAt: new Date(now.getTime() - 44 * 3_600_000).toISOString(),
      taskId: "demo-sbx_msg_reembolso",
      taskTitle: "Enviar el formulario de reembolso (R-48213)",
      title: "Solicitud de reembolso de gastos médicos",
      extracted: true,
      readWithAI: false,
      totalFields: 11,
      missingCount: 2,
      filledDocumentId: null,
      filledFileName: null,
      filledAt: null,
    },
  ];

  const personal: PersonalDataView = {
    persons: [
      {
        person: "yo",
        relation: null,
        isSelf: true,
        fields: [
          { id: "p1", key: "full_name", label: "Nombre completo", value: "Laura Gómez Rivas", source: "demo" },
          { id: "p2", key: "phone", label: "Teléfono", value: "+1 305 555 0142", source: "demo" },
          { id: "p3", key: "email", label: "Correo", value: "laura@ejemplo.com", source: "demo" },
          { id: "p4", key: "address", label: "Dirección", value: "Calle Los Cedros 118, apto. 4B", source: "demo" },
          { id: "p5", key: "emergency_contact", label: "Contacto de emergencia", value: "Andrés Gómez · +1 305 555 0178", source: "demo" },
          { id: "p6", key: "insurance_policy", label: "Número de póliza", value: "SH-2026-004417", source: "demo" },
        ],
      },
      {
        person: "Sofía",
        relation: "hija",
        isSelf: false,
        fields: [
          { id: "s1", key: "full_name", label: "Nombre completo", value: "Sofía Gómez Rivas", source: "demo" },
          { id: "s2", key: "school", label: "Colegio", value: "Colegio Los Pinos", source: "demo" },
          { id: "s3", key: "grade", label: "Grado y sección", value: "3.º B", source: "demo" },
          { id: "s4", key: "allergies", label: "Alergias o condiciones médicas", value: "Ninguna", source: "demo" },
          { id: "s5", key: "birth_date", label: "Fecha de nacimiento", value: "14/03/2018", source: "demo" },
        ],
      },
    ],
  };

  // Conversación del asistente de trámites.
  const digest: InboxDigestCard = { kind: "inbox_digest", scanned: received.length, newCount: allSuggested.length, source: "AI", items: allSuggested };
  const formCard: FormCard = {
    kind: "form",
    documentId: "demo-form-permiso",
    fileName: formExtraction.fileName,
    title: formExtraction.title,
    summary: formExtraction.summary,
    totalFields: 8,
    filledFields: 7,
    missingFields: ["Autorizo a mi hijo(a) a participar en la salida pedagógica al Acuario Municipal"],
    requiresSignature: true,
    filledDocumentId: null,
    dueAt: permission?.draft.dueAt?.toISOString() ?? null,
  };
  const at = (minutes: number) => new Date(now.getTime() - minutes * 60_000).toISOString();
  const conversation: ChatMessageView[] = [
    { id: "t1", role: "user", text: "Revisa mi correo y dime qué trámites tengo", cards: [], createdAt: at(6) },
    {
      id: "t2",
      role: "assistant",
      text: `Revisé ${received.length} correos y encontré **${allSuggested.length} trámites**. Lo más urgente: devolver los libros a la biblioteca y el permiso de la excursión de Sofía, que ya prellené con tus datos. Te propuse fechas que no chocan con tu calendario; confírmalas con un toque.`,
      cards: [digest],
      suggestions: ["Llena el permiso con mis datos", "¿Qué vence primero?"],
      createdAt: at(5),
    },
    { id: "t3", role: "user", text: "Llena el permiso con mis datos", cards: [], createdAt: at(3) },
    {
      id: "t4",
      role: "assistant",
      text: "Llené 7 de 8 campos con los datos de Sofía y los tuyos. Faltan dos cosas que decides tú: **marcar la autorización y firmar**. Revísalo y, si quieres, se lo devuelvo a Carolina Rivera; te pido aprobación antes de enviarlo.",
      cards: [formCard],
      createdAt: at(2),
    },
  ];

  return { suggested, active, done, agenda: weekAgenda, mailbox, calendarSync, formExtraction, forms, personal, conversation, digest };
}

export type DemoProcedures = ReturnType<typeof demoProcedures>;
