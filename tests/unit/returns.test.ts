import { describe, expect, it } from "vitest";
import { deliveryLine, desiredOptions, reasonsFor } from "@/lib/returns-copy";
import { sandboxInbox } from "@/modules/procedures/mail/providers/sandbox-inbox";
import { localDateKey, localParts, startOfLocalDay, zonedToUtc } from "@/modules/procedures/time/tz";
import { domainOf, findMerchantByDomain, findMerchantByName } from "@/modules/returns/merchants";
import { cleanDetails, draftClaim, draftFollowUp, escalationSteps, MAX_DETAILS } from "@/modules/returns/rules/claim";
import { addBusinessDays, deliveryState, endOfLocalDay, nextFollowUpAt } from "@/modules/returns/rules/delivery";
import { findOrderNumber, readOrderMail } from "@/modules/returns/rules/mail-orders";
import { matchRefund, merchantTokens } from "@/modules/returns/rules/refund-match";
import { readStoreReply } from "@/modules/returns/rules/reply";
import { pickReturnUsers } from "@/modules/returns/rules/turns";
import { exampleOrders, sandboxStoreReply } from "@/modules/returns/sandbox";
import { recoveredAmount, returnsStats } from "@/modules/returns/views";
import type { TrackedOrderView } from "@/types/cards";

// Caracas: UTC−4 todo el año (sin horario de verano), así los días locales son deterministas.
const TZ = "America/Caracas";
// Viernes 2 de octubre de 2026, 11:00 a. m. en Caracas.
const NOW = new Date("2026-10-02T15:00:00Z");
const local = (y: number, m: number, d: number, h = 0, min = 0) => zonedToUtc({ year: y, month: m, day: d, hour: h, minute: min }, TZ);
const endOf = (y: number, m: number, d: number) => endOfLocalDay(local(y, m, d, 12), TZ);
const timing = (over: Partial<Parameters<typeof deliveryState>[0]>) => ({
  status: "SHIPPED" as const,
  expectedBy: null,
  deliveredAt: null,
  returnWindowDays: null,
  ...over,
});

describe("entregas y plazos", () => {
  it("el fin del día es local", () => {
    expect(endOfLocalDay(NOW, TZ).toISOString()).toBe("2026-10-03T03:59:59.999Z");
  });

  it("cuenta días hábiles saltando el fin de semana", () => {
    expect(localDateKey(addBusinessDays(NOW, 1, TZ), TZ)).toBe("2026-10-05");
    expect(localDateKey(addBusinessDays(NOW, 2, TZ), TZ)).toBe("2026-10-06");
    expect(localParts(addBusinessDays(NOW, 1, TZ), TZ).hour).toBe(11);
  });

  it("en camino, llega hoy, tarde, para reclamar y probablemente perdido", () => {
    expect(deliveryState(timing({ expectedBy: endOf(2026, 10, 5) }), NOW, TZ)).toMatchObject({ kind: "on_the_way", daysLeft: 3 });
    expect(deliveryState(timing({ expectedBy: endOf(2026, 10, 2) }), NOW, TZ)).toMatchObject({ kind: "due_today", daysLeft: 0 });
    expect(deliveryState(timing({ expectedBy: endOf(2026, 10, 1) }), NOW, TZ)).toMatchObject({ kind: "late", daysLate: 1, claimable: false });
    expect(deliveryState(timing({ expectedBy: endOf(2026, 9, 30) }), NOW, TZ)).toMatchObject({ kind: "late", daysLate: 2, claimable: true, likelyLost: false });
    expect(deliveryState(timing({ expectedBy: endOf(2026, 9, 20) }), NOW, TZ)).toMatchObject({ kind: "late", daysLate: 12, likelyLost: true });
    expect(deliveryState(timing({}), NOW, TZ)).toMatchObject({ kind: "on_the_way", daysLeft: null });
    expect(deliveryState(timing({ status: "CANCELED", expectedBy: endOf(2026, 9, 1) }), NOW, TZ).kind).toBe("canceled");
  });

  it("calcula hasta cuándo se puede devolver", () => {
    const state = deliveryState(
      timing({ status: "DELIVERED", deliveredAt: local(2026, 9, 28, 15), returnWindowDays: 30 }),
      NOW,
      TZ,
    );
    expect(state.kind).toBe("delivered");
    expect(localDateKey(state.returnBy!, TZ)).toBe("2026-10-28");
    expect(state.returnDaysLeft).toBe(26);
    const expired = deliveryState(timing({ status: "DELIVERED", deliveredAt: local(2026, 8, 1, 15), returnWindowDays: 30 }), NOW, TZ);
    expect(expired.returnDaysLeft).toBeLessThan(0);
  });

  it("agenda los seguimientos a las 9:00 del día hábil que toca", () => {
    const first = nextFollowUpAt(NOW, 0, TZ);
    expect(localDateKey(first, TZ)).toBe("2026-10-06");
    expect(localParts(first, TZ).hour).toBe(9);
    expect(localDateKey(nextFollowUpAt(NOW, 1, TZ), TZ)).toBe("2026-10-07");
    expect(localDateKey(nextFollowUpAt(NOW, 2, TZ), TZ)).toBe("2026-10-07");
  });
});

describe("correos de pedidos", () => {
  it("lee el aviso de la paquetería de la bandeja de prueba y nada más", () => {
    const anchor = startOfLocalDay(NOW, TZ);
    const inbox = sandboxInbox({ anchor, timeZone: TZ, address: "laura.demo@correo-demo.test", userFirstName: "Laura" });
    const signals = inbox
      .map((m) => ({ id: m.id, signal: readOrderMail({ ...m, fromName: m.from.name, fromEmail: m.from.email }, TZ) }))
      .filter((r) => r.signal !== null);
    expect(signals.map((r) => r.id)).toEqual(["sbx_msg_envio"]);
    const signal = signals[0].signal!;
    expect(signal).toMatchObject({ kind: "shipped", merchant: "EnvíosYa", fromCarrier: true, carrier: "EnvíosYa", orderNumber: "88213", supportEmail: null });
    // Llegó ayer a las 21:10 y "llegará en 2 a 3 días hábiles": martes 6 de octubre.
    expect(localDateKey(signal.expectedBy!, TZ)).toBe("2026-10-06");
  });

  it("lee la confirmación de una tienda: número, producto, total, fecha, plazo y atención", () => {
    const signal = readOrderMail(
      {
        subject: "Confirmación de tu pedido SMX-30958",
        fromName: "SonidoMax",
        fromEmail: "pedidos@sonidomax.test",
        bodyText: [
          "Hola, Laura:",
          "Gracias por tu compra. Tu pedido n.º SMX-30958 ya está confirmado.",
          "Producto: Audífonos inalámbricos Aura X2",
          "Subtotal: $59.00",
          "Envío: gratis",
          "Total: $59.00",
          "Llega entre el 5 y el 7 de octubre.",
          "Tienes 30 días para devolverlo. ¿Dudas? Escríbenos a ayuda@sonidomax.test.",
        ].join("\n"),
        receivedAt: local(2026, 10, 1, 9),
        labels: ["INBOX"],
      },
      TZ,
    );
    expect(signal).toMatchObject({
      kind: "confirmed",
      merchant: "SonidoMax",
      merchantDomain: "sonidomax.test",
      orderNumber: "SMX-30958",
      title: "Audífonos inalámbricos Aura X2",
      total: 59,
      returnWindowDays: 30,
      supportEmail: "ayuda@sonidomax.test",
      fromCarrier: false,
    });
    expect(localDateKey(signal!.expectedBy!, TZ)).toBe("2026-10-07");
  });

  it("reconoce entregas y cancelaciones de marketplaces", () => {
    const delivered = readOrderMail(
      {
        subject: "¡Entregamos tu paquete!",
        fromName: "Mercado Libre",
        fromEmail: "info@mercadolibre.com.mx",
        bodyText: "Tu compra #2000004567891234 fue entregada el 30 de septiembre. Si algo no está bien, tienes 30 días para devolverlo.",
        receivedAt: local(2026, 10, 1, 8),
        labels: ["INBOX"],
      },
      TZ,
    );
    expect(delivered).toMatchObject({
      kind: "delivered",
      merchant: "Mercado Libre",
      merchantDomain: "mercadolibre.com.mx",
      orderNumber: "2000004567891234",
      supportEmail: null,
      returnWindowDays: 30,
    });
    expect(localDateKey(delivered!.deliveredAt!, TZ)).toBe("2026-09-30");

    const canceled = readOrderMail(
      { subject: "Actualización de tu pedido", fromName: "CasaNova Hogar", fromEmail: "pedidos@casanova.test", bodyText: "Tu pedido CNH-77104 fue cancelado por falta de stock.", receivedAt: NOW, labels: [] },
      TZ,
    );
    expect(canceled?.kind).toBe("canceled");
  });

  it("ignora publicidad, recibos digitales y correos sin pedido", () => {
    const base = { fromName: "Tienda", fromEmail: "hola@tienda.test", receivedAt: NOW, labels: ["INBOX"] };
    expect(readOrderMail({ ...base, subject: "¡30% en electrodomésticos!", bodyText: "Tu pedido con envío gratis. Hasta agotar existencias.", labels: ["CATEGORY_PROMOTIONS"] }, TZ)).toBeNull();
    expect(readOrderMail({ ...base, subject: "Gracias por tu compra", bodyText: "Tu suscripción Premium ya está activa. Pedido 55812." }, TZ)).toBeNull();
    expect(readOrderMail({ ...base, subject: "Tu factura", bodyText: "Tu factura de septiembre está disponible." }, TZ)).toBeNull();
  });

  it("encuentra números de pedido sin confundirlos con palabras", () => {
    expect(findOrderNumber("Tu pedido de SonidoMax va en camino (pedido #88213)")).toBe("88213");
    expect(findOrderNumber("Order 112-3456789-1234567 has shipped")).toBe("112-3456789-1234567");
    expect(findOrderNumber("Tu pedido confirmado")).toBeNull();
    expect(findOrderNumber("¡Somos la tienda #1!")).toBeNull();
  });
});

describe("tiendas conocidas", () => {
  it("saca el dominio registrable del remitente", () => {
    expect(domainOf("pedidos@amazon.com.mx")).toBe("amazon.com.mx");
    expect(domainOf("avisos@envios.sonidomax.test")).toBe("sonidomax.test");
    expect(domainOf("hola@mail.shop.co.uk")).toBe("shop.co.uk");
    expect(domainOf("no es un correo")).toBeNull();
  });

  it("sabe cómo reclamar a cada una sin inventar correos de tiendas reales", () => {
    expect(findMerchantByName("casanova hogar")).toMatchObject({ supportEmail: "soporte@casanova.test", returnWindowDays: 30, sandbox: true });
    expect(findMerchantByDomain("ventas.mercadolibre.com.ar")?.name).toBe("Mercado Libre");
    expect(findMerchantByDomain("amazon.es")?.supportEmail).toBeNull();
    expect(findMerchantByDomain("dhl.com")?.kind).toBe("carrier");
  });
});

describe("mensajes para la tienda", () => {
  const ctx = {
    merchant: "Cumbre Sports",
    orderNumber: "CUM-48213",
    title: "Zapatillas de trail Andes 2",
    orderedAt: local(2026, 9, 23, 10),
    expectedBy: endOf(2026, 9, 29),
    deliveredAt: null,
    total: 89.9,
    currency: "USD",
    reason: "LATE" as const,
    desired: "ARRIVED" as const,
    details: null,
    userName: "Laura Méndez",
    now: NOW,
    timeZone: TZ,
  };

  it("un retraso cita la fecha prometida (sin contar días, que se desactualizan)", () => {
    const draft = draftClaim(ctx);
    expect(draft.subject).toBe("Pedido CUM-48213: no ha llegado");
    expect(draft.body).toContain("Hola, equipo de Cumbre Sports:");
    expect(draft.body).toContain("hecho el 23 de septiembre por $89.90");
    expect(draft.body).toContain("prometida para el martes 29 de septiembre y todavía no lo recibo.");
    expect(draft.body).not.toContain("días de retraso");
    expect(draft.body).toContain("confirmen dónde está el pedido");
    expect(draft.body.trimEnd().endsWith("Laura Méndez")).toBe(true);
  });

  it("un producto dañado pide el reembolso, la etiqueta y ofrece fotos, con las palabras del usuario", () => {
    const draft = draftClaim({ ...ctx, reason: "DAMAGED", desired: "REFUND", deliveredAt: local(2026, 9, 30, 15), details: "La suela llegó despegada." });
    expect(draft.subject).toBe("Pedido CUM-48213: llegó dañado");
    expect(draft.body).toContain("La suela llegó despegada.");
    expect(draft.body).toContain("reembolso completo de $89.90");
    expect(draft.body).toContain("etiqueta");
    expect(draft.body).toContain("fotos");
  });

  it("no inventa datos que no tiene", () => {
    const draft = draftClaim({ ...ctx, orderNumber: null, total: null, expectedBy: null, userName: null });
    expect(draft.subject).toBe("Mi pedido de Zapatillas de trail Andes 2: no ha llegado");
    expect(draft.body).not.toContain("$");
    expect(draft.body).toContain("no tengo noticias del envío");
  });

  it("los seguimientos no repiten el prefijo y el segundo avisa que escalará", () => {
    const first = draftFollowUp({ ...ctx, number: 1, firstSentAt: local(2026, 9, 30, 10), subject: "Pedido CUM-48213: no ha llegado" });
    expect(first.subject).toBe("Seguimiento: Pedido CUM-48213: no ha llegado");
    expect(first.body).toContain("El miércoles 30 de septiembre les escribí");
    const second = draftFollowUp({ ...ctx, number: 2, firstSentAt: local(2026, 9, 30, 10), subject: first.subject });
    expect(second.subject).toBe(first.subject);
    expect(second.body).toContain("segundo mensaje");
  });

  it("limpia lo que escribió el usuario y lo corta con un tope", () => {
    expect(cleanDetails("  llegó   roto \n\n\n\n la caja  ")).toBe("llegó roto\n\nla caja");
    expect(cleanDetails("   ")).toBeNull();
    expect(cleanDetails("x".repeat(900))!.length).toBe(MAX_DETAILS);
  });

  it("sugiere cómo escalar sin prometer resultados", () => {
    const steps = escalationSteps(findMerchantByDomain("amazon.com"));
    expect(steps[0]).toContain("Garantía de la A a la z");
    expect(steps.some((s) => s.includes("contracargo"))).toBe(true);
    expect(escalationSteps(null)).toHaveLength(2);
  });
});

describe("respuestas de las tiendas", () => {
  const read = (bodyText: string, expectedAmount: number | null = 89.9) =>
    readStoreReply({ subject: "Re: Pedido CUM-48213", bodyText, receivedAt: NOW, merchant: "Cumbre Sports", currency: "USD", expectedAmount }, TZ);

  it("reembolso aprobado con su monto", () => {
    expect(read("Emitimos el reembolso de $89.90 a tu medio de pago.")).toMatchObject({ kind: "refund", amount: 89.9 });
  });

  it("instrucciones para devolver: el reembolso llega al recibir el paquete", () => {
    const reply = read("Aprobamos la devolución. Te enviamos la etiqueta: deja el paquete en EnvíosYa antes del viernes 9 de octubre. Al recibirlo, te reembolsamos $89.90.");
    expect(reply.kind).toBe("return_label");
    expect(reply.nextStep).toContain("antes del viernes 9 de octubre");
    expect(localDateKey(reply.nextStepBy!, TZ)).toBe("2026-10-09");
  });

  it("rechazo, pedido de fotos, cambio, saldo a favor y acuse", () => {
    expect(read("Lamentamos informarte que tu solicitud no procede porque está fuera del plazo.").kind).toBe("rejected");
    expect(read("Para continuar, envíanos fotos del producto y de la caja.")).toMatchObject({ kind: "needs_info", nextStep: "Cumbre Sports pide fotos: respóndele desde tu correo." });
    expect(read("Lamentamos lo ocurrido. Te enviamos uno nuevo sin costo.").kind).toBe("replacement");
    expect(read("Te dimos saldo a favor por $64.50 en tu cuenta.", 64.5)).toMatchObject({ kind: "store_credit", amount: 64.5 });
    expect(read("Recibimos tu mensaje. Te responderemos en 48 horas.").kind).toBe("ack");
  });

  it("una nueva fecha de entrega no es un reembolso, aunque lo prometa si no llega", () => {
    const reply = read("Tu pedido llegará el martes 6 de octubre. Si no llega ese día, te reembolsamos el total.");
    expect(reply.kind).toBe("shipping_update");
    expect(localDateKey(reply.newExpectedBy!, TZ)).toBe("2026-10-06");
  });
});

describe("reembolso en las cuentas", () => {
  const since = local(2026, 9, 25);
  const tx = (over: Partial<Parameters<typeof matchRefund>[1][number]>) => ({
    id: Math.random().toString(36).slice(2),
    amount: 59,
    direction: "CREDIT" as const,
    currency: "USD",
    merchantName: "SONIDO MAX",
    description: "Devolución compra",
    postedAt: local(2026, 10, 1, 10),
    ...over,
  });

  it("encuentra el abono de la tienda por el monto", () => {
    const good = tx({ id: "ok" });
    const found = matchRefund({ merchant: "SonidoMax", amount: 59, currency: "USD", since }, [
      tx({ direction: "DEBIT" }),
      tx({ currency: "EUR" }),
      tx({ postedAt: local(2026, 9, 20) }),
      tx({ merchantName: "Otra Tienda" }),
      tx({ amount: 45 }),
      good,
    ]);
    expect(found?.id).toBe("ok");
  });

  it("identifica la tienda por sus palabras propias", () => {
    expect(merchantTokens("CasaNova Hogar")).toEqual(["casanova"]);
    expect(matchRefund({ merchant: "SonidoMax", amount: null, currency: "USD", since }, [tx({})])).toBeNull();
  });
});

describe("pedidos de ejemplo y tiendas de prueba", () => {
  it("cuentan la historia: uno tarde, uno entregado y uno en camino", () => {
    const [late, delivered, onTheWay] = exampleOrders(NOW, TZ);
    expect(deliveryState(late, NOW, TZ)).toMatchObject({ kind: "late", daysLate: 3, claimable: true });
    expect(deliveryState(delivered, NOW, TZ)).toMatchObject({ kind: "delivered", returnDaysLeft: 26 });
    expect(deliveryState(onTheWay, NOW, TZ)).toMatchObject({ kind: "on_the_way", daysLeft: 2 });
    expect(late.supportEmail).toBe("soporte@cumbresports.test");
  });

  it("la respuesta simulada de la tienda se lee igual que una real", () => {
    const reply = (reason: "LATE" | "DAMAGED" | "WRONG_ITEM" | "CHANGED_MIND", desired: "ARRIVED" | "REFUND" | "REPLACEMENT" | "STORE_CREDIT", stage: 0 | 1) => {
      const message = sandboxStoreReply({
        merchant: "Cumbre Sports",
        merchantDomain: "cumbresports.test",
        orderNumber: "CUM-48213",
        subject: "Pedido CUM-48213",
        reason,
        desired,
        amount: 89.9,
        currency: "USD",
        stage,
        now: NOW,
        timeZone: TZ,
      });
      expect(message.fromEmail).toBe("soporte@cumbresports.test");
      return readStoreReply({ subject: message.subject, bodyText: message.body, receivedAt: NOW, merchant: "Cumbre Sports", currency: "USD", expectedAmount: 89.9 }, TZ);
    };
    expect(reply("LATE", "ARRIVED", 0).kind).toBe("shipping_update");
    expect(reply("LATE", "REFUND", 0)).toMatchObject({ kind: "refund", amount: 89.9 });
    expect(reply("DAMAGED", "REFUND", 0).kind).toBe("return_label");
    expect(reply("DAMAGED", "REFUND", 1)).toMatchObject({ kind: "refund", amount: 89.9 });
    expect(reply("WRONG_ITEM", "REPLACEMENT", 0).kind).toBe("replacement");
    expect(reply("CHANGED_MIND", "STORE_CREDIT", 0).kind).toBe("return_label");
    expect(reply("CHANGED_MIND", "STORE_CREDIT", 1)).toMatchObject({ kind: "store_credit", amount: 89.9 });
  });
});

describe("totales y textos", () => {
  it("lo recuperado cuenta reembolsos y saldos confirmados, en tu moneda, este mes", () => {
    const row = (over: Record<string, unknown>) => ({
      status: "RESOLVED" as const,
      outcome: "REFUND" as const,
      refundAmount: 59,
      amount: 59,
      currency: "USD",
      resolvedAt: local(2026, 10, 1),
      ...over,
    }) as unknown as Parameters<typeof returnsStats>[1][number];
    const stats = returnsStats(
      [],
      [row({}), row({ outcome: "STORE_CREDIT", refundAmount: 20 }), row({ outcome: "ARRIVED" }), row({ currency: "EUR" }), row({ resolvedAt: local(2026, 9, 10) }), row({ status: "SENT" })],
      "USD",
      NOW,
      TZ,
    );
    expect(stats.recoveredThisMonth).toBe(79);
    expect(stats.recoveredTotal).toBe(138);
    expect(recoveredAmount(row({ outcome: "REPLACEMENT" }), "USD")).toBe(0);
  });

  it("describe la entrega en una línea", () => {
    const base = { delivery: "late", daysLate: 3, likelyLost: false, expectedBy: endOf(2026, 9, 29).toISOString() } as TrackedOrderView;
    expect(deliveryLine(base, TZ)).toBe("Va 3 días tarde (llegaba el 29 sept)");
    expect(deliveryLine({ ...base, likelyLost: true, daysLate: 12 }, TZ)).toContain("probablemente se perdió");
    expect(deliveryLine({ ...base, delivery: "due_today" }, TZ)).toBe("Llega hoy");
    // Nunca llegó y el reclamo terminó en reembolso: el pedido queda cancelado, con el porqué.
    expect(deliveryLine({ ...base, delivery: "canceled", lastOutcome: "REFUND" }, TZ)).toBe("No llegó: la tienda aprobó el reembolso");
    expect(deliveryLine({ ...base, delivery: "canceled", lastOutcome: null }, TZ)).toBe("Cancelado");
    expect(deliveryLine({ ...base, delivery: "on_the_way", status: "SHIPPED", expectedBy: null, lastOutcome: "REPLACEMENT" }, TZ)).toBe(
      "La tienda te envía uno nuevo, todavía sin fecha",
    );
  });

  it("el trabajo programado atiende primero lo urgente y reparte turnos entre los demás", () => {
    const others = Array.from({ length: 7 }, (_, i) => `u${i}`);
    const hour = (n: number) => new Date(Date.UTC(2026, 9, 1, n));
    // Los urgentes siempre entran, sin repetirse aunque también estén entre los demás.
    expect(pickReturnUsers(["u5", "u5"], others, 3, hour(0))).toEqual(["u5", "u0", "u1"]);
    // Con 3 lugares y 7 personas, en 3 horas seguidas todos tuvieron su turno.
    const seen = new Set([0, 1, 2].flatMap((n) => pickReturnUsers([], others, 3, hour(n))));
    expect(seen.size).toBe(7);
    // Si los urgentes llenan la corrida, no entra nadie más.
    expect(pickReturnUsers(["a", "b"], others, 2, hour(5))).toEqual(["a", "b"]);
  });

  it("ofrece motivos y pedidos según el estado del pedido", () => {
    expect(reasonsFor({ delivery: "late" })).toEqual(["LATE", "NOT_RECEIVED"]);
    expect(reasonsFor({ delivery: "delivered" })).toContain("DAMAGED");
    expect(desiredOptions("LATE")[0]).toBe("ARRIVED");
    expect(desiredOptions("WRONG_ITEM")[0]).toBe("REPLACEMENT");
  });
});
