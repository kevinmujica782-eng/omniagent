import "server-only";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { listJoin } from "@/lib/format";
import { definePlaybook } from "../engine.types";
import { syncAccounts } from "../steps/finance.steps";
import { checkPrices, refreshOrders, summarizeDay, syncMail } from "../steps/sweep.steps";

/** Entre una puesta al día y la siguiente (cada módulo además se revisa solo según el plan). */
const SWEEP_COOLDOWN_MINUTES = 5;

/**
 * "Ponme al día": bancos, correo, precios y pedidos, uno detrás de otro, y un resumen de lo nuevo. Si un módulo falla,
 * los demás siguen (el fallo queda como aviso en el resultado).
 */
export const dailySweep = definePlaybook({
  id: "daily.sweep",
  module: "GENERAL",
  input: z.object({}),
  title: () => "Poner todo al día",
  activeKey: () => "todo",
  async preflight(_input, { userId, now }) {
    const last = await prisma.engineJob.findFirst({
      where: { userId, playbook: "daily.sweep", status: "SUCCEEDED" },
      orderBy: { finishedAt: "desc" },
      select: { finishedAt: true },
    });
    const minutes = last?.finishedAt ? (now.getTime() - last.finishedAt.getTime()) / 60_000 : Infinity;
    if (minutes < SWEEP_COOLDOWN_MINUTES) {
      throw new AppError(429, "rate_limited", "Te acabo de poner al día hace un momento. Vuelve a pedírmelo en unos minutos.");
    }
  },
  steps: [syncAccounts, syncMail, checkPrices, refreshOrders, summarizeDay],
  finish({ outputOf }) {
    const today = outputOf(summarizeDay);
    const approvals = today?.approvals ?? 0;
    return {
      summary: today?.lines.length ? `Todo al día: ${listJoin(today.lines)}.` : "Todo al día: nada nuevo.",
      href: approvals > 0 ? "/aprobaciones" : "/inicio",
      linkLabel: approvals > 0 ? "Revisar aprobaciones" : "Ir a Inicio",
      notify: true,
      notifyTitle: "Todo al día",
    };
  },
});
