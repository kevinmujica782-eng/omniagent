import "server-only";
import { z } from "zod";
import { defineTool, type AgentTool } from "@/modules/agent/registry";
import type { JobView } from "@/types/engine";
import { INVOCATION_BUDGET_MS } from "./engine.rules";
import { cancelJob, getJob, latestJob, startJob } from "./engine.service";
import type { PlaybookDefinition } from "./engine.types";
import { dailySweep, financeAnalysis, websiteCreate, websiteUpdate } from "./playbooks";

// Herramientas del agente para el motor (function calling): una por playbook, más consultar y detener. Todas
// responden al instante con la tarjeta del trabajo; el trabajo sigue en segundo plano.

/** Lo que recibe el modelo de un trabajo: corto y sin datos internos. */
function jobData(job: JobView, created: boolean) {
  return {
    jobId: job.id,
    created,
    status: job.status,
    steps: job.steps.map((step) => ({ title: step.title, status: step.status, note: step.note })),
    result: job.result?.summary ?? null,
    error: job.error,
  };
}

function playbookTool<S extends z.ZodType>(playbook: PlaybookDefinition<S>, info: { name: string; description: string }): AgentTool<S> {
  return defineTool({
    name: info.name,
    description: info.description,
    module: playbook.module,
    input: playbook.input,
    async run(input, ctx) {
      const { job, created } = await startJob({
        userId: ctx.userId,
        playbook: playbook.id,
        input,
        source: "agent",
        conversationId: ctx.conversationId,
        // El turno del chat empezó en ctx.now: el trabajo usa lo que le queda a esta invocación.
        deadline: ctx.now.getTime() + INVOCATION_BUDGET_MS,
      });
      return {
        data: {
          ...jobData(job, created),
          note: created
            ? "Corre en segundo plano: la tarjeta muestra cada paso en vivo. No digas que ya terminó ni inventes el resultado."
            : "Ya estaba en marcha: es el mismo trabajo.",
        },
        cards: [{ kind: "job", job }],
      };
    },
  });
}

export const engineTools: AgentTool[] = [
  playbookTool(financeAnalysis, {
    name: "engine_analyze_finances",
    description:
      "Análisis financiero completo en segundo plano: actualiza los bancos conectados, revisa suscripciones y gastos hormiga y prepara un informe nuevo con IA (queda en Finanzas y llega un aviso). Úsala cuando la persona pide analizar sus finanzas o un informe nuevo.",
  }),
  playbookTool(dailySweep, {
    name: "engine_daily_sweep",
    description:
      "Pone todo al día en segundo plano, un módulo detrás de otro: bancos, correo, precios vigilados y pedidos, y al final resume lo nuevo y avisa. Úsala para «ponme al día», «revisa todo» o «¿qué hay de nuevo?».",
  }),
  playbookTool(websiteCreate, {
    name: "engine_create_website",
    description:
      "Crea en segundo plano una página web (landing) para el negocio o proyecto de la persona: escribe el texto, lo revisa, arma una vista previa y le pide aprobación para publicarla en su propio enlace. Necesitas el nombre y qué ofrece; agrega productos, precios y contacto solo si los dio. Nunca inventes datos.",
  }),
  playbookTool(websiteUpdate, {
    name: "engine_update_website",
    description:
      "Cambia una página web que Omni ya creó (textos, colores o datos de contacto) y pide aprobación para publicar los cambios. Identifica la página por su nombre o su enlace.",
  }),
  defineTool({
    name: "engine_job_status",
    module: "GENERAL",
    description: "Estado de un trabajo en segundo plano: sus pasos y su resultado. Sin job_id, el último trabajo de la persona.",
    input: z.object({ job_id: z.uuid().optional().describe("Id del trabajo (jobId)") }),
    async run({ job_id }, ctx) {
      const job = job_id ? await getJob(ctx.userId, job_id) : await latestJob(ctx.userId);
      if (!job) return { data: { found: false, hint: "La persona no tiene trabajos en segundo plano." } };
      return { data: jobData(job, false), cards: [{ kind: "job", job }] };
    },
  }),
  defineTool({
    name: "engine_cancel_job",
    module: "GENERAL",
    description: "Detiene un trabajo en segundo plano que sigue en marcha. Lo que ya hizo queda hecho; si esperaba una aprobación, esa aprobación vence.",
    input: z.object({ job_id: z.uuid().describe("Id del trabajo (jobId)") }),
    async run({ job_id }, ctx) {
      const job = await cancelJob(ctx.userId, job_id);
      return { data: jobData(job, false), cards: [{ kind: "job", job }] };
    },
  }),
];
