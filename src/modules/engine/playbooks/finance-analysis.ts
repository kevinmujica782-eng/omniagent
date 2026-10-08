import "server-only";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { AppError, Errors } from "@/lib/errors";
import { money } from "@/lib/format";
import { definePlaybook } from "../engine.types";
import { buildReport, findAntExpenses, reviewSubscriptions, syncAccounts } from "../steps/finance.steps";

function waitText(minutes: number): string {
  if (minutes < 60) return `${Math.max(1, Math.ceil(minutes))} min`;
  const hours = Math.ceil(minutes / 60);
  return `${hours} ${hours === 1 ? "hora" : "horas"}`;
}

/**
 * "Analiza mis finanzas": actualiza los bancos, revisa suscripciones y gastos hormiga y prepara el informe con IA.
 * El informe queda en Finanzas y el módulo avisa cuando está listo (el motor no repite el aviso).
 */
export const financeAnalysis = definePlaybook({
  id: "finance.analyze",
  module: "FINANCE",
  input: z.object({}),
  title: () => "Analizar tus finanzas",
  activeKey: () => "mis-finanzas",
  async preflight(_input, { userId, limits, now }) {
    const [accounts, last] = await Promise.all([
      prisma.financialAccount.count({ where: { userId } }),
      prisma.financialAnalysis.findFirst({ where: { userId }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
    ]);
    if (accounts === 0) throw Errors.badRequest("Conecta una cuenta o tarjeta, o sube un estado de cuenta, para analizar tus finanzas.");
    if (last) {
      const elapsed = (now.getTime() - last.createdAt.getTime()) / 60_000;
      if (elapsed < limits.analysisCooldownMinutes) {
        throw new AppError(
          429,
          "rate_limited",
          `Ya tienes un análisis reciente: está en Finanzas. Podrás pedir otro en ${waitText(limits.analysisCooldownMinutes - elapsed)}.`,
        );
      }
    }
  },
  steps: [syncAccounts, reviewSubscriptions, findAntExpenses, buildReport],
  finish({ outputOf }) {
    const report = outputOf(buildReport);
    if (!report) return { summary: "Tu informe está listo.", href: "/finanzas", linkLabel: "Ver tu informe", notify: false };
    const savings = report.totalMonthlySavings > 0 ? ` Puedes liberar ${money(report.totalMonthlySavings, report.currency)} al mes.` : "";
    // Finanzas ya avisa con "Tu análisis financiero está listo".
    return { summary: `${report.headline}${savings}`, href: "/finanzas", linkLabel: "Ver tu informe", notify: false };
  },
});
