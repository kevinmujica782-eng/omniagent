import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { MailAttachment, MailMessage, Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { anthropic } from "@/modules/agent/anthropic";
import type { ParsedIcsEvent } from "../../calendar/ics";
import type { BusyBlock } from "../../calendar/scheduler";
import { busyWindow, suggestFromMessage, userTimeZone } from "../../plan";
import {
  TRIAGE_SYSTEM_PROMPT,
  TRIAGE_TOOL_NAME,
  buildTriagePrompt,
  mergeTriage,
  triageSchema,
  type TriageOutput,
} from "./ai";
import { triageWithRules, type TriageInput, type TriageResult } from "./rules";

// Clasificación de la bandeja: reglas para cada correo nuevo y, si hay clave de Anthropic, Claude en lotes
// con salida estructurada (tool use forzado). Cada correo accionable se convierte en un trámite sugerido.
// Clasificar es una tarea corta y automática: usa el modelo rápido en todos los planes y no consume cuota del chat.

const AI_BATCH = 15;
const MAX_PER_RUN = 60;

type StoredIcs = { title: string | null; location: string | null; startsAt: string; endsAt: string | null; allDay: boolean };

/** Datos detectados que se guardan en mail_messages.extracted. */
export type MailExtracted = {
  ics?: StoredIcs[];
  amount?: number | null;
  currency?: string;
  reference?: string | null;
  eventTitle?: string | null;
  eventAllDay?: boolean;
  dueHasTime?: boolean;
  taskTitle?: string | null;
  taskType?: string | null;
  replyTo?: string | null;
  hasForm?: boolean;
};

export function toStoredIcs(events: ParsedIcsEvent[]): StoredIcs[] {
  return events.slice(0, 3).map((e) => ({
    title: e.title,
    location: e.location,
    startsAt: e.startsAt.toISOString(),
    endsAt: e.endsAt?.toISOString() ?? null,
    allDay: e.allDay,
  }));
}

function fromStoredIcs(events: StoredIcs[] | undefined): ParsedIcsEvent[] {
  return (events ?? []).map((e) => ({
    title: e.title,
    location: e.location,
    description: null,
    startsAt: new Date(e.startsAt),
    endsAt: e.endsAt ? new Date(e.endsAt) : null,
    allDay: e.allDay,
  }));
}

type MessageWithAttachments = MailMessage & { attachments: MailAttachment[] };

function toInput(message: MessageWithAttachments): TriageInput {
  const extracted = (message.extracted ?? {}) as MailExtracted;
  return {
    subject: message.subject,
    fromName: message.fromName,
    fromEmail: message.fromEmail,
    bodyText: message.bodyText,
    labels: message.labels,
    attachments: message.attachments.map((a) => ({ fileName: a.fileName, mimeType: a.mimeType })),
    receivedAt: message.receivedAt,
    ics: fromStoredIcs(extracted.ics),
  };
}

/** Un lote de correos a Claude. Exportada para probarla con un cliente simulado. */
export async function classifyWithClaude(
  batch: { key: string; message: MessageWithAttachments }[],
  now: Date,
  timeZone: string,
  model: string,
): Promise<{ output: TriageOutput; usage: { input: number; output: number } }> {
  const schema = z.toJSONSchema(triageSchema, { io: "input" }) as Record<string, unknown>;
  delete schema.$schema;
  const tool: Anthropic.Tool = {
    name: TRIAGE_TOOL_NAME,
    description: "Registra la clasificación de cada correo y el trámite que implica.",
    input_schema: schema as unknown as Anthropic.Tool["input_schema"],
  };
  const prompt = buildTriagePrompt(
    batch.map(({ key, message }) => ({
      key,
      fromName: message.fromName,
      fromEmail: message.fromEmail,
      subject: message.subject,
      receivedAt: message.receivedAt,
      bodyText: message.bodyText,
      attachments: message.attachments.map((a) => a.fileName),
    })),
    now,
    timeZone,
  );
  const response = await anthropic().messages.create({
    model,
    max_tokens: 4000,
    system: [{ type: "text", text: TRIAGE_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
    tools: [tool],
    tool_choice: { type: "tool", name: TRIAGE_TOOL_NAME },
    messages: [{ role: "user", content: prompt }],
  });
  const block = response.content.find((b) => b.type === "tool_use" && b.name === TRIAGE_TOOL_NAME);
  if (!block || block.type !== "tool_use") throw new Error("El modelo no devolvió la clasificación.");
  const parsed = triageSchema.safeParse(block.input);
  if (!parsed.success) throw new Error(`Clasificación inválida: ${parsed.error.issues.map((i) => i.path.join(".")).join(", ")}`);
  return { output: parsed.data, usage: { input: response.usage.input_tokens, output: response.usage.output_tokens } };
}

export interface TriageRunResult {
  triaged: number;
  /** Trámites sugeridos nuevos en esta corrida. */
  suggested: number;
  source: "AI" | "RULES" | null;
  taskIds: string[];
}

/** La fecha que más apremia de un correo (para repartir primero los mejores horarios). */
function urgency(result: TriageResult): number {
  const dates = [result.dueAt, result.eventStartsAt].filter((d): d is Date => d !== null).map((d) => d.getTime());
  return dates.length ? Math.min(...dates) : Number.MAX_SAFE_INTEGER;
}

/** Clasifica los correos sin clasificar del usuario y crea los trámites sugeridos. */
export async function triageInbox(userId: string, opts: { preferAI?: boolean } = {}): Promise<TriageRunResult> {
  const messages = await prisma.mailMessage.findMany({
    where: { userId, folder: "inbox", triagedAt: null },
    include: { attachments: true },
    orderBy: { receivedAt: "desc" },
    take: MAX_PER_RUN,
  });
  if (messages.length === 0) return { triaged: 0, suggested: 0, source: null, taskIds: [] };

  const now = new Date();
  const timeZone = await userTimeZone(userId);
  const inputs = new Map(messages.map((m) => [m.id, toInput(m)]));
  const results = new Map<string, TriageResult>(messages.map((m) => [m.id, triageWithRules(inputs.get(m.id)!, now, timeZone)]));

  let source: "AI" | "RULES" = "RULES";
  if ((opts.preferAI ?? true) && env().ANTHROPIC_API_KEY) {
    // La publicidad que el propio proveedor marcó como tal no pasa por la IA.
    const candidates = messages.filter((m) => !m.labels.includes("CATEGORY_PROMOTIONS"));
    const model = env().ANTHROPIC_MODEL_FREE;
    for (let i = 0; i < candidates.length; i += AI_BATCH) {
      const batch = candidates.slice(i, i + AI_BATCH).map((message, j) => ({ key: `m${j + 1}`, message }));
      try {
        const { output, usage } = await classifyWithClaude(batch, now, timeZone, model);
        for (const item of output.correos) {
          const entry = batch.find((b) => b.key === item.id);
          if (!entry) continue;
          const input = inputs.get(entry.message.id)!;
          results.set(
            entry.message.id,
            mergeTriage(results.get(entry.message.id)!, item, {
              now,
              timeZone,
              receivedAt: entry.message.receivedAt,
              fromEmail: entry.message.fromEmail,
              bodyText: entry.message.bodyText,
              hasIcs: input.ics.length > 0,
            }),
          );
        }
        source = "AI";
        await prisma.aiUsageLog.create({
          data: { userId, module: "PROCEDURES", kind: "triage", model, inputTokens: usage.input, outputTokens: usage.output },
        });
      } catch (error) {
        console.error("[triage] la clasificación con IA falló; se usan reglas", error);
      }
    }
  }

  for (const message of messages) {
    const r = results.get(message.id)!;
    const extracted: MailExtracted = {
      ...((message.extracted ?? {}) as MailExtracted),
      amount: r.amount,
      currency: r.currency,
      reference: r.reference,
      eventTitle: r.eventTitle,
      eventAllDay: r.eventAllDay,
      dueHasTime: r.dueHasTime,
      taskTitle: r.taskTitle,
      taskType: r.taskType,
      replyTo: r.replyTo,
      hasForm: r.hasForm,
    };
    await prisma.mailMessage.update({
      where: { id: message.id },
      data: {
        category: r.category,
        importance: r.importance,
        triageSource: r.source,
        triagedAt: now,
        summary: r.summary,
        actionRequired: r.actionRequired,
        dueAt: r.dueAt,
        eventStartsAt: r.eventStartsAt,
        eventEndsAt: r.eventEndsAt,
        eventLocation: r.eventLocation,
        extracted: extracted as unknown as Prisma.InputJsonValue,
      },
    });
  }

  // Lo más urgente primero, y cada sugerencia ocupa su horario para que no caigan dos a la misma hora.
  const actionable = messages
    .filter((m) => results.get(m.id)!.actionRequired)
    .sort((a, b) => urgency(results.get(a.id)!) - urgency(results.get(b.id)!));
  const busy: BusyBlock[] = actionable.length ? await busyWindow(userId, now) : [];
  const taskIds: string[] = [];
  let created = 0;
  for (const message of actionable) {
    try {
      const out = await suggestFromMessage(userId, message, results.get(message.id)!, { now, timeZone, busy });
      if (!out) continue;
      taskIds.push(out.task.id);
      if (out.created) created += 1;
      if (out.task.plannedAt) {
        const end = new Date(out.task.plannedAt.getTime() + 30 * 60_000);
        const title = out.task.title.length > 40 ? `${out.task.title.slice(0, 39).trimEnd()}…` : out.task.title;
        busy.push({ start: out.task.plannedAt, end, title });
      }
    } catch (error) {
      console.error("[triage] no se pudo crear el trámite sugerido", message.id, error);
    }
  }

  if (created > 0) {
    await prisma.appNotification.create({
      data: {
        userId,
        type: "ACTION_REQUIRED",
        title: created === 1 ? "Encontré un trámite en tu correo" : `Encontré ${created} trámites en tu correo`,
        body: "Revisa las fechas que te propongo y confírmalas con un toque.",
        href: "/tramites",
        data: { taskIds },
      },
    });
  }
  return { triaged: messages.length, suggested: created, source, taskIds };
}
