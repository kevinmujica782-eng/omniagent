import { describe, expect, it } from "vitest";
import { meterTone, previousMonthLabel, timeAgo, versusText, whenAhead } from "@/lib/dashboard-copy";
import { buildAgents, buildAttention, countAttention, dateLabelFor, greetingFor, monthStart, monthToDate } from "@/modules/dashboard/rules";
import type { TxLike } from "@/modules/finance/analyzers";
import type { ApprovalCard, ProcedureView } from "@/types/cards";

const TZ = "America/Caracas"; // UTC-4, sin horario de verano

function tx(iso: string, amount: number, extra: Partial<TxLike> = {}): TxLike {
  return {
    postedAt: new Date(iso),
    amount,
    direction: "DEBIT",
    currency: "USD",
    merchantName: "Comercio",
    description: "Compra",
    category: "Restaurantes",
    ...extra,
  };
}

describe("saludo y fecha", () => {
  it("saluda según la hora local", () => {
    expect(greetingFor(new Date("2026-09-28T12:00:00Z"), TZ, "Laura Gómez")).toBe("Buenos días, Laura");
    expect(greetingFor(new Date("2026-09-28T20:00:00Z"), TZ, "Laura Gómez")).toBe("Buenas tardes, Laura");
    expect(greetingFor(new Date("2026-09-29T02:00:00Z"), TZ, null)).toBe("Buenas noches");
  });

  it("escribe la fecha con el día de la semana", () => {
    expect(dateLabelFor(new Date("2026-09-28T15:00:00Z"), TZ)).toBe("Lunes 28 de septiembre");
  });

  it("calcula el inicio del mes en la zona del usuario", () => {
    const now = new Date("2026-09-28T15:00:00Z");
    expect(monthStart(now, TZ).toISOString()).toBe("2026-09-01T04:00:00.000Z");
    expect(monthStart(now, TZ, -1).toISOString()).toBe("2026-08-01T04:00:00.000Z");
    expect(monthStart(new Date("2026-01-10T15:00:00Z"), TZ, -1).toISOString()).toBe("2025-12-01T04:00:00.000Z");
  });
});

describe("gasto del mes", () => {
  const now = new Date("2026-09-10T16:00:00Z"); // 10 de septiembre, 12:00 en Caracas
  const txs = [
    tx("2026-07-20T15:00:00Z", 10), // historial previo: la comparación es justa
    tx("2026-08-03T15:00:00Z", 100),
    tx("2026-08-09T15:00:00Z", 50),
    tx("2026-08-25T15:00:00Z", 999), // después del mismo día del mes pasado: no cuenta para comparar
    tx("2026-09-02T15:00:00Z", 60),
    tx("2026-09-10T13:00:00Z", 30, { category: "Supermercado" }),
    tx("2026-09-05T15:00:00Z", 500, { category: "Transferencias" }), // neutral
    tx("2026-09-06T15:00:00Z", 1000, { direction: "CREDIT", category: "Ingresos" }),
  ];
  const result = monthToDate(txs, now, TZ);

  it("suma solo gastos del mes (sin transferencias ni ingresos)", () => {
    expect(result.monthLabel).toBe("septiembre");
    expect(result.spentThisMonth).toBe(90);
    expect(result.topCategory).toEqual({ name: "Restaurantes", amount: 60 });
  });

  it("compara con el mes pasado hasta el mismo día", () => {
    expect(result.spentSamePointLastMonth).toBe(150);
    expect(result.changePct).toBe(-40);
  });

  it("arma las series diarias de este mes y del pasado", () => {
    expect(result.daily).toHaveLength(10);
    expect(result.daily[1]).toEqual({ day: 2, amount: 60 });
    expect(result.daily[9]).toEqual({ day: 10, amount: 30 });
    expect(result.daysInMonth).toBe(30);
    expect(result.previousDaily).toHaveLength(31);
    expect(result.previousDaily[24]).toEqual({ day: 25, amount: 999 });
  });

  it("sin historial previo no compara (la cuenta se conectó hace poco)", () => {
    const fresh = monthToDate([tx("2026-09-02T15:00:00Z", 60)], now, TZ);
    expect(fresh.spentSamePointLastMonth).toBeNull();
    expect(fresh.changePct).toBeNull();
    expect(fresh.previousDaily).toEqual([]);
  });
});

const card = (over: Partial<ApprovalCard>): ApprovalCard =>
  ({
    kind: "approval",
    actionId: "a1",
    type: "CANCEL_SUBSCRIPTION",
    status: "PENDING",
    title: "CineClub+",
    summary: "Sin uso en 104 días.",
    merchant: null,
    amount: 8.99,
    amountPeriod: "al mes",
    currency: "USD",
    lines: [],
    resultMessage: null,
    createdAt: "2026-09-28T12:00:00Z",
    ...over,
  }) as ApprovalCard;

const task = (over: Partial<ProcedureView>): ProcedureView =>
  ({
    taskId: "t1",
    status: "PENDING",
    title: "Permiso de la excursión",
    dueAt: "2026-09-29T23:59:00Z",
    dueHasTime: false,
    urgent: true,
    overdue: false,
    event: null,
    amount: null,
    currency: "USD",
    ...over,
  }) as ProcedureView;

describe("lo que espera tu permiso", () => {
  const now = new Date("2026-09-28T15:00:00Z");
  const items = buildAttention({
    approvals: [card({}), card({ actionId: "a2", type: "PURCHASE", title: "Audífonos Aura X2", amount: 247, amountPeriod: null })],
    suggested: [task({ taskId: "t2", status: "SUGGESTED", urgent: false, title: "Cita dental" })],
    dueSoon: [task({}), task({ taskId: "t3", urgent: false, overdue: false, title: "Libros" })],
    alerts: [{ id: "al1", title: "Aura X2", headline: "Bajó 24%: Aura X2", price: 247, currency: "USD", status: "NEW" }],
    billingNotice: "past_due",
    now,
    timeZone: TZ,
  });

  it("ordena: cobro fallido, compras, aprobaciones, trámites y ofertas", () => {
    expect(items.map((i) => i.kind)).toEqual(["billing", "purchase", "approval", "procedure", "procedure", "alert"]);
    expect(items[1].amount).toEqual({ value: 247, currency: "USD", period: null });
    expect(items[2].amount?.period).toBe("al mes");
  });

  it("solo trae trámites urgentes o por confirmar", () => {
    expect(items.some((i) => i.title === "Libros")).toBe(false);
    expect(items.find((i) => i.title === "Cita dental")?.detail).toMatch(/^Confirma las fechas/);
    expect(items.find((i) => i.title === "Permiso de la excursión")?.detail).toBe("vence mañana");
  });

  it("cuenta por tipo", () => {
    expect(countAttention(items)).toEqual({ billing: 1, purchase: 1, approval: 1, return: 0, procedure: 2, alert: 1 });
  });

  it("las devoluciones van después de las aprobaciones y antes de los trámites", () => {
    const withReturns = buildAttention({
      approvals: [card({})],
      suggested: [],
      dueSoon: [task({})],
      alerts: [],
      returns: [
        { id: "c1", title: "Envía el producto con la etiqueta de SonidoMax", detail: "SonidoMax · Aura X2", href: "/devoluciones?caso=c1", amount: 59, currency: "USD" },
      ],
      billingNotice: null,
      now,
      timeZone: TZ,
    });
    expect(withReturns.map((i) => i.kind)).toEqual(["approval", "return", "procedure"]);
    expect(withReturns[1]).toMatchObject({ id: "return-c1", href: "/devoluciones?caso=c1", amount: { value: 59, currency: "USD", period: null } });
    expect(countAttention(withReturns).return).toBe(1);
  });
});

describe("agentes", () => {
  it("en Gratis dice qué cambia con Pro", () => {
    const agents = buildAgents({
      plan: "FREE",
      finance: { accounts: 2, lastSyncAt: null },
      mail: { connected: true, lastSyncAt: null },
      prices: { watching: 3, paused: 0, lastCheckAt: null, nextCheckAt: null },
    });
    expect(agents.map((a) => a.state)).toEqual(["active", "active", "active"]);
    expect(agents[1].cadence).toBe("Revisa tu correo una vez al día");
    expect(agents[1].proHint).toBe("Con Pro: cada 3 horas");
    expect(agents[2].proHint).toBe("Con Pro: cada hora y hasta 50");
  });

  it("en Pro trabaja en piloto automático y sin avisos de mejora", () => {
    const agents = buildAgents({
      plan: "PRO",
      finance: { accounts: 1, lastSyncAt: new Date("2026-09-28T10:00:00Z") },
      mail: { connected: false, lastSyncAt: null },
      prices: { watching: 0, paused: 2, lastCheckAt: null, nextCheckAt: null },
    });
    expect(agents[0]).toMatchObject({ state: "active", cadence: "Sincroniza cada día e informe mensual", detail: "1 cuenta conectada", proHint: null });
    expect(agents[1].state).toBe("setup");
    expect(agents[2].state).toBe("paused");
    expect(agents.every((a) => a.proHint === null)).toBe(true);
  });
});

describe("textos del panel", () => {
  const now = new Date("2026-09-28T15:00:00Z");
  it("dice hace cuánto pasó algo", () => {
    expect(timeAgo("2026-09-28T14:59:40Z", now, TZ)).toBe("hace un momento");
    expect(timeAgo("2026-09-28T14:48:00Z", now, TZ)).toBe("hace 12 min");
    expect(timeAgo("2026-09-28T12:00:00Z", now, TZ)).toBe("hace 3 h");
    expect(timeAgo("2026-09-27T15:00:00Z", now, TZ)).toBe("ayer");
    expect(timeAgo("2026-09-24T15:00:00Z", now, TZ)).toBe("hace 4 días");
    expect(timeAgo("2026-09-01T15:00:00Z", now, TZ)).toBe("el 1 de septiembre");
  });

  it("dice cuándo toca algo", () => {
    expect(whenAhead("2026-09-28T20:30:00Z", now, TZ)).toBe("hoy 4:30 p. m.");
    expect(whenAhead("2026-09-29T12:15:00Z", now, TZ)).toBe("mañana 8:15 a. m.");
    expect(whenAhead("2026-10-04T12:00:00Z", now, TZ)).toBe("el 4 de octubre");
  });

  it("pinta el consumo según qué tan cerca está del tope", () => {
    expect(meterTone(10, 40)).toBe("primary");
    expect(meterTone(32, 40)).toBe("attention");
    expect(meterTone(3, 3)).toBe("danger");
  });

  it("compara con el mes anterior", () => {
    expect(versusText(-8, "agosto")).toBe("−8% vs. agosto");
    expect(versusText(12, "agosto")).toBe("+12% vs. agosto");
    expect(versusText(0, "agosto")).toBe("Igual que agosto");
    expect(versusText(null, "agosto")).toBeNull();
    expect(previousMonthLabel("enero")).toBe("diciembre");
  });
});
