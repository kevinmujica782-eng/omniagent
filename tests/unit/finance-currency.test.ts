import { describe, expect, it } from "vitest";
import {
  ANT_MAX_TICKET_USD,
  antMaxTicketFor,
  detectAntExpenses,
  inCurrency,
  primaryCurrency,
  usdScale,
  type TxLike,
} from "@/modules/finance/analyzers";
import { buildSnapshot } from "@/modules/finance/insights/metrics";
import { amountsInText } from "@/modules/finance/insights/report";
import { isMoneyToken, parseAmount } from "@/modules/finance/statement-import/amounts";

// Finanzas con más de una moneda: los montos en bolívares («Bs. 1.234,56») se leen, los resúmenes no mezclan monedas
// y el tope de un «gasto hormiga» depende de la moneda (antes eran siempre 15, que en bolívares o pesos no es nada).

const NOW = new Date("2026-11-08T12:00:00Z");
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000);

function tx(currency: string, amount: number, days = 3, extra: Partial<TxLike> = {}): TxLike {
  return {
    postedAt: daysAgo(days),
    amount,
    direction: "DEBIT",
    currency,
    merchantName: "Café Esquina",
    description: "Café Esquina",
    category: null,
    ...extra,
  };
}

describe("montos en bolívares", () => {
  it("lee «Bs.», «Bs.S», «Bs» y los códigos VES, VED y VEF delante o detrás del monto", () => {
    expect(parseAmount("Bs. 1.234,56")).toEqual({ cents: 123_456, negative: false, marker: null });
    expect(parseAmount("Bs.S 45,50")?.cents).toBe(4550);
    expect(parseAmount("BsS 10,00")?.cents).toBe(1000);
    expect(parseAmount("Bs 2.000,00")?.cents).toBe(200_000);
    expect(parseAmount("Bs.1.234,56")?.cents).toBe(123_456);
    expect(parseAmount("1.234,56 Bs.")?.cents).toBe(123_456);
    expect(parseAmount("VES 1.234,56")?.cents).toBe(123_456);
    expect(parseAmount("VED 99,99")?.cents).toBe(9999);
    expect(parseAmount("VEF 5,00")?.cents).toBe(500);
  });

  it("respeta el signo: delante, entre paréntesis o al final", () => {
    expect(parseAmount("-Bs. 25,00")).toEqual({ cents: 2500, negative: true, marker: null });
    expect(parseAmount("(Bs. 25,00)")).toEqual({ cents: 2500, negative: true, marker: null });
    expect(parseAmount("Bs. 1.000,00-")).toEqual({ cents: 100_000, negative: true, marker: null });
  });

  it("no toma por moneda el principio de otra palabra", () => {
    expect(parseAmount("Bsx 10,00")).toBeNull();
    expect(parseAmount("Bs. Sucursal")).toBeNull();
  });

  it("los demás formatos siguen igual", () => {
    expect(parseAmount("$1,234.56")?.cents).toBe(123_456);
    expect(parseAmount("1.234,56")?.cents).toBe(123_456);
    expect(parseAmount("MXN 1,000")?.cents).toBe(100_000);
    expect(parseAmount("(45.00)")).toEqual({ cents: 4500, negative: true, marker: null });
  });

  it("reconoce el monto en un PDF aunque traiga la moneda pegada", () => {
    expect(isMoneyToken("Bs. 1.234,56")).toBe(true);
    expect(isMoneyToken("Bs.S 45,50")).toBe(true);
    expect(isMoneyToken("Bs.1.234,56")).toBe(true);
    expect(isMoneyToken("1.234,56 Bs.")).toBe(true);
    expect(isMoneyToken("VES 1.234,56")).toBe(true);
    expect(isMoneyToken("Bs. Sucursal")).toBe(false);
    expect(isMoneyToken("123456")).toBe(false);
  });
});

describe("una sola moneda por resumen", () => {
  it("usa la moneda con más movimientos", () => {
    const txs = [tx("VES", 100), tx("VES", 200), tx("VES", 300), tx("USD", 12)];
    expect(primaryCurrency(["USD", "VES"], txs)).toBe("VES");
  });

  it("si empatan, o no hay movimientos, usa la de la primera cuenta", () => {
    expect(primaryCurrency(["USD", "VES"], [tx("VES", 100), tx("USD", 12)])).toBe("USD");
    expect(primaryCurrency(["VES", "USD"], [])).toBe("VES");
  });

  it("sin cuentas ni movimientos usa la moneda de respaldo", () => {
    expect(primaryCurrency([], [])).toBe("USD");
    expect(primaryCurrency([], [], "VES")).toBe("VES");
  });

  it("deja solo lo que está en esa moneda", () => {
    const txs = [tx("VES", 100), tx("USD", 12), tx("VES", 300)];
    expect(inCurrency(txs, "VES").map((t) => t.amount)).toEqual([100, 300]);
    expect(inCurrency(txs, "EUR")).toEqual([]);
  });
});

describe("tope de un gasto hormiga según la moneda", () => {
  it("en dólares sigue siendo 15", () => {
    expect(ANT_MAX_TICKET_USD).toBe(15);
    expect(antMaxTicketFor("USD", 0)).toBe(15);
    expect(antMaxTicketFor("usd", 4000)).toBe(15);
  });

  it("en pesos y otras monedas estables es el equivalente aproximado", () => {
    expect(antMaxTicketFor("MXN", 0)).toBe(300);
    expect(antMaxTicketFor("COP", 0)).toBe(60_000);
    expect(antMaxTicketFor("EUR", 0)).toBe(15);
  });

  it("en bolívares (y monedas sin cifra fija) es el 2 % del gasto mensual, a 2 cifras", () => {
    expect(antMaxTicketFor("VES", 20_000)).toBe(400);
    expect(antMaxTicketFor("VES", 18_333)).toBe(370);
    expect(antMaxTicketFor("ARS", 3000)).toBe(60);
    expect(antMaxTicketFor("XYZ", 3000)).toBe(60);
  });

  it("sin gastos no hay tope, así que no se detecta nada", () => {
    expect(antMaxTicketFor("VES", 0)).toBe(0);
    expect(antMaxTicketFor("VES", -5)).toBe(0);
  });

  it("lleva los umbrales en dólares a la moneda de la persona", () => {
    expect(usdScale("USD", 5000)).toBe(1);
    expect(usdScale("MXN", 5000)).toBe(20);
    expect(usdScale("VES", 15_000)).toBe(20);
    expect(usdScale("VES", 0)).toBe(0);
  });

  it("con el tope de dólares, 5 cafés de 200 bolívares no eran hormiga; con el de su moneda, sí", () => {
    const cafes = Array.from({ length: 5 }, (_, i) => tx("VES", 200, i + 1));
    expect(detectAntExpenses(cafes, { periodDays: 30, maxAmount: ANT_MAX_TICKET_USD }).items).toHaveLength(0);
    const ants = detectAntExpenses(cafes, { periodDays: 30, maxAmount: antMaxTicketFor("VES", 20_000) });
    expect(ants.items).toHaveLength(1);
    expect(ants.items[0]).toMatchObject({ merchant: "Café Esquina", count: 5, total: 1000 });
  });
});

describe("resumen para la IA en bolívares", () => {
  const base = { accounts: [], recurring: [], budgets: [], now: NOW };
  const cafes = Array.from({ length: 5 }, (_, i) => tx("VES", 200, i + 1));
  const mercado = [tx("VES", 54_000, 10, { merchantName: "Mercado Central", description: "Mercado Central" })];

  it("el tope de compra pequeña sale de la moneda y del gasto de la persona", () => {
    const snapshot = buildSnapshot({ ...base, txs: [...cafes, ...mercado], currency: "VES" });
    expect(snapshot.currency).toBe("VES");
    expect(snapshot.antExpenses.maxTicket).toBe(antMaxTicketFor("VES", snapshot.averages.spending));
    expect(snapshot.antExpenses.maxTicket).toBeGreaterThan(200);
    expect(snapshot.antExpenses.merchants.map((m) => m.merchant)).toEqual(["Café Esquina"]);
  });

  it("en dólares el tope sigue siendo 15", () => {
    const snapshot = buildSnapshot({ ...base, txs: [tx("USD", 4), tx("USD", 5), tx("USD", 6), tx("USD", 4.5)], currency: "USD" });
    expect(snapshot.antExpenses.maxTicket).toBe(15);
    expect(snapshot.antExpenses.merchants).toHaveLength(1);
  });
});

describe("cifras que cita la IA en otras monedas", () => {
  it("encuentra los montos en bolívares, en pesos y en dólares", () => {
    const text = "Gastas VES 1,235 al mes, Bs. 1.234,56 en comida y 45,50 Bs. en café; en México serían MXN 300 y $12.";
    expect(amountsInText(text).map((a) => a.value)).toEqual([1235, 1234.56, 45.5, 300, 12]);
  });

  it("sigue encontrando los de siempre", () => {
    expect(amountsInText("Ingresas $4,852, pagas US$1.850, 120 USD y $15.61; subió 48% en 3 meses.").map((a) => a.value)).toEqual([
      4852, 1850, 120, 15.61,
    ]);
  });

  it("ignora porcentajes, días y palabras que no son montos", () => {
    expect(amountsInText("Subió 48% en 3 meses y quedan 12 días; hay Bsx 10 y Bs. Sucursal.")).toEqual([]);
  });
});
