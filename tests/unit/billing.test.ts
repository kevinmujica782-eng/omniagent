import { describe, expect, it } from "vitest";
import { AGENT_FEATURE_ORDER, AGENT_FEATURES, cadenceText, PLANS, planFeatures } from "@/modules/billing/plans";
import { billingNotice, isEntitled, mapStripeStatus, planFrom } from "@/modules/billing/status";
import { upgradeCard, upgradeHighlights } from "@/modules/billing/upgrade";
import { autopilotPerDay, autopilotPerMonth, paywallRows, rowForLimit } from "@/modules/billing/paywall";

const NOW = new Date("2026-09-28T12:00:00Z");
const DAY = 86_400_000;

describe("planes", () => {
  it("Pro tiene todas las funciones de los agentes y Gratis ninguna", () => {
    for (const id of AGENT_FEATURE_ORDER) {
      expect(PLANS.PRO.features[id]).toBe(true);
      expect(PLANS.FREE.features[id]).toBe(false);
      expect(AGENT_FEATURES[id].title.length).toBeGreaterThan(3);
    }
  });

  it("los números cuadran con las funciones (cada hora, correo cada 3 h)", () => {
    expect(PLANS.PRO.priceCheckMinutes).toBeLessThanOrEqual(60);
    expect(PLANS.FREE.priceCheckMinutes).toBeGreaterThanOrEqual(1440);
    expect(PLANS.PRO.mailCheckHours).toBeLessThan(PLANS.FREE.mailCheckHours);
    expect(PLANS.PRO.analysisCooldownMinutes).toBeLessThan(PLANS.FREE.analysisCooldownMinutes);
    for (const key of ["monthlyMessages", "watchlistItems", "activeGoals", "monthlyFormReads", "monthlyPageReads"] as const) {
      expect(PLANS.PRO[key]).toBeGreaterThan(PLANS.FREE[key]);
    }
    expect(PLANS.PRO.priceLabel).toBe("$19.99 al mes");
  });

  it("describe las frecuencias en palabras", () => {
    expect(cadenceText(60)).toBe("cada hora");
    expect(cadenceText(180)).toBe("cada 3 horas");
    expect(cadenceText(20 * 60)).toBe("una vez al día");
    expect(cadenceText(1440)).toBe("una vez al día");
  });

  it("lista los beneficios de cada plan", () => {
    const free = planFeatures(PLANS.FREE);
    const pro = planFeatures(PLANS.PRO);
    expect(free).toContain("3 precios vigilados, revisados una vez al día");
    expect(free).toContain("Correo revisado una vez al día");
    expect(pro).toContain("1,500 mensajes con Omni al mes");
    expect(pro).toContain("Correo revisado cada 3 horas");
    expect(pro).toContain("Informe mensual automático de tus gastos");
    expect(free).not.toContain("Modelo de IA más capaz");
  });
});

describe("estados de suscripción", () => {
  it("traduce los estados de Stripe", () => {
    expect(mapStripeStatus("active")).toBe("ACTIVE");
    expect(mapStripeStatus("trialing")).toBe("TRIALING");
    expect(mapStripeStatus("past_due")).toBe("PAST_DUE");
    expect(mapStripeStatus("canceled")).toBe("CANCELED");
    expect(mapStripeStatus("incomplete")).toBe("INCOMPLETE");
    expect(mapStripeStatus("unpaid")).toBe("EXPIRED");
    expect(mapStripeStatus("paused")).toBe("EXPIRED");
  });

  it("da Pro solo con un estado vigente y el periodo sin vencer", () => {
    const future = new Date(NOW.getTime() + 10 * DAY);
    const past = new Date(NOW.getTime() - DAY);
    expect(isEntitled({ plan: "PRO", status: "ACTIVE", currentPeriodEnd: future }, NOW)).toBe(true);
    expect(isEntitled({ plan: "PRO", status: "PAST_DUE", currentPeriodEnd: future }, NOW)).toBe(true);
    expect(isEntitled({ plan: "PRO", status: "ACTIVE", currentPeriodEnd: null }, NOW)).toBe(true);
    expect(isEntitled({ plan: "PRO", status: "ACTIVE", currentPeriodEnd: past }, NOW)).toBe(false);
    expect(isEntitled({ plan: "PRO", status: "CANCELED", currentPeriodEnd: future }, NOW)).toBe(false);
    expect(isEntitled({ plan: "PRO", status: "INCOMPLETE", currentPeriodEnd: future }, NOW)).toBe(false);
  });

  it("Pro si cualquiera de las suscripciones (web o Google Play) está vigente", () => {
    const expiredWeb = { plan: "PRO", status: "CANCELED", currentPeriodEnd: new Date(NOW.getTime() + DAY) };
    const play = { plan: "PRO", status: "ACTIVE", currentPeriodEnd: new Date(NOW.getTime() + 5 * DAY) };
    expect(planFrom([expiredWeb], NOW)).toBe("FREE");
    expect(planFrom([expiredWeb, play], NOW)).toBe("PRO");
    expect(planFrom([], NOW)).toBe("FREE");
  });

  it("avisa si el cobro falló o si la suscripción termina", () => {
    expect(billingNotice({ status: "PAST_DUE", cancelAtPeriodEnd: false })).toBe("past_due");
    expect(billingNotice({ status: "ACTIVE", cancelAtPeriodEnd: true })).toBe("canceling");
    expect(billingNotice({ status: "ACTIVE", cancelAtPeriodEnd: false })).toBeNull();
    expect(billingNotice(null)).toBeNull();
  });
});

describe("hoja para pasarse a Pro", () => {
  it("empieza por lo que se acabó y no repite temas", () => {
    const watchlist = upgradeHighlights({ reason: "watchlist" });
    expect(watchlist[0]).toBe("50 precios vigilados, revisados cada hora");
    expect(watchlist).not.toContain("Precios revisados cada hora");
    expect(watchlist).toHaveLength(3);
    const mail = upgradeHighlights({ reason: "feature", feature: "mail_autopilot" });
    expect(mail[0]).toBe(AGENT_FEATURES.mail_autopilot.pro);
    expect(mail).not.toContain("Correo revisado cada 3 horas");
  });

  it("arma la tarjeta del chat con el motivo y el precio", () => {
    const card = upgradeCard("Usaste tus 40 mensajes gratis de este mes.", { reason: "messages" });
    expect(card).toMatchObject({ kind: "upgrade", feature: null, priceLabel: "$19.99 al mes" });
    expect(card.highlights[0]).toBe("1,500 mensajes con Omni al mes");
  });
});

describe("pantalla de Omni Pro", () => {
  it("la comparación sale de los planes: nada que el servidor no cumpla", () => {
    const rows = paywallRows();
    const row = (id: string) => rows.find((r) => r.id === id)!;
    expect(row("messages")).toMatchObject({ free: "40 al mes", pro: "1,500 al mes" });
    expect(row("mail")).toMatchObject({ free: "Una vez al día", pro: "Cada 3 horas" });
    expect(row("prices")).toMatchObject({ free: "3, una vez al día", pro: "50, cada hora" });
    expect(row("analysis")).toMatchObject({ free: "Cuando lo pides", pro: "Informe mensual automático" });
    expect(row("model")).toMatchObject({ free: "Rápido", pro: "El más capaz" });
    // Permitir o Denegar está en los dos planes.
    expect(row("approvals")).toMatchObject({ free: true, pro: true });
    // Ninguna fila promete "ilimitado".
    expect(JSON.stringify(rows)).not.toMatch(/ilimitad/i);
  });

  it("el trabajo de los agentes en un día y en un mes", () => {
    expect(autopilotPerDay(PLANS.PRO)).toEqual({ prices: 24, mail: 8 });
    expect(autopilotPerDay(PLANS.FREE)).toEqual({ prices: 1, mail: 1 });
    expect(autopilotPerMonth(PLANS.PRO)).toEqual({ prices: 720, mail: 240 });
    expect(autopilotPerMonth(PLANS.FREE)).toEqual({ prices: 30, mail: 30 });
  });

  it("marca la fila del límite con el que chocó la persona", () => {
    expect(rowForLimit("watchlist", null)).toBe("prices");
    expect(rowForLimit("page_reads", null)).toBe("prices");
    expect(rowForLimit("messages", null)).toBe("messages");
    expect(rowForLimit("form_reads", null)).toBe("forms");
    expect(rowForLimit("feature", "mail_autopilot")).toBe("mail");
    expect(rowForLimit(null, "monthly_report")).toBe("analysis");
    expect(rowForLimit(null, "algo_raro")).toBeNull();
  });
});
