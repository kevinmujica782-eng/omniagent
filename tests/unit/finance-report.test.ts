import { describe, expect, it } from "vitest";
import type { FinancialSnapshot } from "@/modules/finance/insights/metrics";
import { amountsInText, findUnsupportedAmounts, quotableFigures, type ReportOutput } from "@/modules/finance/insights/report";
import type { Candidate } from "@/modules/finance/insights/rules";

// Datos parecidos a los del banco de prueba: el caso real fue un informe que dijo «ingresaste $14.555 en promedio»
// (la suma de los 3 meses) y un chat que llamó a Delivery el mayor gasto cuando Vivienda es mayor.
const snapshot: FinancialSnapshot = {
  currency: "USD",
  period: { from: "2026-07-05", to: "2026-10-03", days: 90 },
  accounts: [],
  months: [
    { label: "5 jul al 4 ago", income: 4852, spending: 4120, net: 732 },
    { label: "4 ago al 3 sept", income: 4852, spending: 4380, net: 472 },
    { label: "3 sept al 3 oct", income: 4852, spending: 4415, net: 437 },
  ],
  averages: { income: 4852, spending: 4305, net: 547, savingsRatePct: 11 },
  categories: [
    { name: "Delivery", monthlyAverage: 338, lastMonth: 500, changePct: 48 },
    { name: "Vivienda", monthlyAverage: 1850, lastMonth: 1850, changePct: 0 },
    { name: "Supermercado", monthlyAverage: 798, lastMonth: 1050, changePct: 32 },
  ],
  antExpenses: {
    maxTicket: 15,
    monthlyTotal: 125,
    merchants: [{ merchant: "Café Aroma", purchasesPerMonth: 18, averageTicket: 4.5, monthly: 81 }],
  },
  subscriptions: [
    { id: "s1", merchant: "Noticias Premium", amount: 12, cadence: "MONTHLY", monthly: 12, kind: "news", usage: "sin_uso", lastUsedDaysAgo: 126, usageConfirmedByUser: false },
    { id: "s2", merchant: "CineClub+", amount: 8.99, cadence: "MONTHLY", monthly: 8.99, kind: "video", usage: "sin_uso", lastUsedDaysAgo: 104, usageConfirmedByUser: false },
    { id: "s3", merchant: "NubeFotos 200 GB", amount: 2.99, cadence: "MONTHLY", monthly: 2.99, kind: "cloud", usage: "sin_uso", lastUsedDaysAgo: 97, usageConfirmedByUser: false },
    { id: "s4", merchant: "StreamFlix", amount: 15.99, cadence: "MONTHLY", monthly: 15.99, kind: "video", usage: "en_uso", lastUsedDaysAgo: 2, usageConfirmedByUser: false },
  ],
  fixedCharges: [],
  overlaps: [],
  avoidableFees: [{ concept: "Intereses de tarjeta", count: 3, totalPeriod: 46.83, monthly: 15.61 }],
  topMerchants: [],
  budgets: [],
  dataQuality: { transactions: 250, daysCovered: 90, hasCreditCard: true },
};

const candidates: Candidate[] = [
  {
    key: "c1",
    kind: "CANCEL_SUBSCRIPTION",
    title: "Cancela Noticias Premium",
    detail: "No la usas hace 126 días.",
    monthlySavings: 12,
    difficulty: "EASY",
    target: null,
    suggestedAmount: null,
  },
];

function report(resumen: string, mensaje = "Puedes ahorrar $12 al mes cancelando Noticias Premium. ¿La cancelo?"): ReportOutput {
  return {
    salud: "estable",
    titular: "Tienes suscripciones que no usas",
    resumen,
    puntos_clave: ["Tu mayor gasto es Vivienda: $1,850 al mes.", "Delivery subió 48% el último mes, a $500."],
    recomendaciones: [
      { candidata: "c1", tipo: "cancelar_suscripcion", titulo: "Cancela Noticias Premium", detalle: "Te ahorra $12 al mes.", ahorro_mensual: 12, dificultad: "facil" },
    ],
    mensaje_chat: mensaje,
    preguntas_sugeridas: ["¿Cómo bajo el delivery?", "¿Qué más puedo cancelar?"],
  };
}

describe("montos del informe de finanzas", () => {
  it("lee montos con símbolo o código de moneda y no los porcentajes", () => {
    expect(amountsInText("Ingresas $4,852, pagas US$1.850, 120 USD y $15.61; subió 48% en 3 meses.").map((a) => a.value)).toEqual([
      4852, 1850, 120, 15.61,
    ]);
  });

  it("rechaza la suma de los 3 meses presentada como promedio", () => {
    const bad = report("En estos 3 meses ingresaste $14.555 en promedio y gastaste $4,305, dejando un margen positivo.");
    expect(findUnsupportedAmounts(bad, snapshot, candidates)).toEqual(["$14.555"]);
  });

  it("acepta cifras de los datos, sumas obvias y ahorros al año, también redondeados", () => {
    const good = report(
      "Ingresas $4,852 al mes y gastas $4,305; te quedan $547. Tres suscripciones sin uso te cuestan $23.98 al mes, unos $290 al año. Pagas $15.61 al mes en intereses.",
      "Si cancelas Noticias Premium ahorras $12 al mes, $144 al año. ¿La cancelo?",
    );
    expect(findUnsupportedAmounts(good, snapshot, candidates)).toEqual([]);
  });

  it("ordena las categorías por gasto mensual para que «donde más gastas» sea la mayor", () => {
    const figures = quotableFigures(snapshot);
    expect(figures.categorias_de_mayor_a_menor_gasto_mensual[0]).toMatch(/^Vivienda: \$1,850 al mes/);
    expect(figures.ingreso_mensual_promedio).toBe("$4,852");
    expect(figures.suscripciones_sin_uso_al_mes).toMatch(/^\$23\.98 \(Noticias Premium, CineClub\+, NubeFotos 200 GB\)$/);
  });
});
