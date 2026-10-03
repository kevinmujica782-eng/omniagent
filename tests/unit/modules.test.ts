import { describe, expect, it } from "vitest";
import { detectAntExpenses, monthlyEquivalent, summarize, type TxLike } from "@/modules/finance/analyzers";
import { clockTime, longDate, relativeDay } from "@/modules/procedures/time/es-dates";
import { addLocalDays, localDateKey, zonedToUtc } from "@/modules/procedures/time/tz";

const NOW = new Date("2026-09-28T15:00:00Z");
const tx = (daysAgo: number, amount: number, extra: Partial<TxLike> = {}): TxLike => ({
  postedAt: new Date(NOW.getTime() - daysAgo * 86_400_000),
  amount,
  direction: "DEBIT",
  currency: "USD",
  merchantName: "Café Grano",
  description: "CAFE GRANO*1234",
  category: "Café y antojos",
  ...extra,
});

describe("finanzas", () => {
  it("las transferencias entre cuentas no cuentan como gasto", () => {
    const result = summarize(
      [tx(3, 100, { category: "Supermercado" }), tx(4, 900, { category: "Transferencias" }), tx(5, 2000, { direction: "CREDIT", category: "Ingresos" })],
      30,
      NOW,
    );
    expect(result.monthlySpending).toBe(100);
    expect(result.monthlyIncome).toBe(2000);
    expect(result.topCategories[0].name).toBe("Supermercado");
  });

  it("detecta gastos hormiga repetidos en el mismo comercio", () => {
    const coffee = [1, 3, 6, 9, 12].map((d) => tx(d, 4.5));
    const result = detectAntExpenses([...coffee, tx(2, 80, { merchantName: "Tienda", category: "Compras" })], { periodDays: 30, maxAmount: 15 });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ merchant: "Café Grano", count: 5, total: 22.5, averageTicket: 4.5 });
  });

  it("lleva cargos recurrentes a su equivalente mensual", () => {
    expect(monthlyEquivalent(12, "WEEKLY")).toBe(52);
    expect(monthlyEquivalent(8.99, "MONTHLY")).toBe(8.99);
    expect(monthlyEquivalent(30, "QUARTERLY")).toBe(10);
    expect(monthlyEquivalent(120, "YEARLY")).toBe(10);
  });
});

describe("fechas en la zona del usuario", () => {
  const TZ = "America/New_York";

  it("respeta el cambio de horario", () => {
    // 8 de marzo de 2026: en Nueva York se adelanta el reloj a las 2:00.
    expect(zonedToUtc({ year: 2026, month: 3, day: 7, hour: 9 }, TZ).toISOString()).toBe("2026-03-07T14:00:00.000Z");
    expect(zonedToUtc({ year: 2026, month: 3, day: 9, hour: 9 }, TZ).toISOString()).toBe("2026-03-09T13:00:00.000Z");
    const saturday = zonedToUtc({ year: 2026, month: 3, day: 7, hour: 9 }, TZ);
    expect(addLocalDays(saturday, 2, TZ).toISOString()).toBe("2026-03-09T13:00:00.000Z");
  });

  it("escribe fechas y horas en español", () => {
    const at = new Date("2026-10-02T23:30:00Z"); // viernes 2 de octubre, 7:30 p. m. en Nueva York
    expect(longDate(at, TZ)).toBe("viernes 2 de octubre");
    expect(clockTime(at, TZ)).toBe("7:30 p. m.");
    expect(localDateKey(at, TZ)).toBe("2026-10-02");
    expect(relativeDay(at, new Date("2026-10-01T15:00:00Z"), TZ)).toBe("mañana");
    expect(relativeDay(at, new Date("2026-09-28T15:00:00Z"), TZ)).toBe("el viernes 2 de octubre");
  });
});
