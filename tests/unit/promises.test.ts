import { describe, expect, it } from "vitest";
import { CANCEL_GRACE_DAYS, checkCancellation } from "@/modules/finance/cancellation-rules";
import { findMerchantByName, tracksOmniOrder } from "@/modules/returns/merchants";

// Lo que la app promete y ahora cumple: avisar si una suscripción dada de baja se vuelve a cobrar (y confirmar la
// baja cuando ya no aparece), y no seguir en Devoluciones compras simuladas en tiendas reales.

const DAY = 86_400_000;
const at = (iso: string) => new Date(`${iso}T12:00:00Z`);
const plus = (date: Date, days: number) => new Date(date.getTime() + days * DAY);

describe("seguimiento de una baja pedida con Omni", () => {
  const requestedAt = at("2026-11-08");

  it("si el comercio cobra después de pedir la baja, avisa", () => {
    const chargedAt = at("2026-12-01");
    expect(checkCancellation({ requestedAt, cadence: "MONTHLY", lastChargedAt: chargedAt, dataThrough: at("2026-12-05") })).toEqual({
      status: "charged_again",
      chargedAt,
    });
  });

  it("un cobro que aparece justo después de pedirla (ya venía en camino) no cuenta como otro cobro", () => {
    const outcome = checkCancellation({
      requestedAt,
      cadence: "MONTHLY",
      lastChargedAt: plus(requestedAt, CANCEL_GRACE_DAYS - 1),
      dataThrough: at("2026-11-20"),
    });
    expect(outcome.status).toBe("waiting");
  });

  it("si los movimientos ya pasan la fecha del siguiente cobro y no apareció, la baja está hecha", () => {
    // Último cobro el 25 oct: el siguiente caería por el 24 nov; con 7 días de margen, desde el 2 dic se confirma.
    const lastChargedAt = at("2026-10-25");
    expect(checkCancellation({ requestedAt, cadence: "MONTHLY", lastChargedAt, dataThrough: at("2026-12-01") }).status).toBe("waiting");
    expect(checkCancellation({ requestedAt, cadence: "MONTHLY", lastChargedAt, dataThrough: at("2026-12-03") })).toEqual({ status: "confirmed" });
  });

  it("sin movimientos nuevos, espera", () => {
    const outcome = checkCancellation({ requestedAt, cadence: "MONTHLY", lastChargedAt: at("2026-10-25"), dataThrough: at("2026-11-08") });
    expect(outcome).toEqual({ status: "waiting", checkAfter: new Date(at("2026-10-25").getTime() + 37.4 * DAY) });
    expect(checkCancellation({ requestedAt, cadence: "MONTHLY", lastChargedAt: null, dataThrough: null }).status).toBe("waiting");
  });

  it("respeta la frecuencia: una anual no se confirma al mes", () => {
    const lastChargedAt = at("2026-02-01");
    expect(checkCancellation({ requestedAt, cadence: "YEARLY", lastChargedAt, dataThrough: at("2026-12-31") }).status).toBe("waiting");
    expect(checkCancellation({ requestedAt, cadence: "YEARLY", lastChargedAt, dataThrough: at("2027-03-05") }).status).toBe("confirmed");
    expect(checkCancellation({ requestedAt, cadence: "WEEKLY", lastChargedAt: at("2026-11-06"), dataThrough: at("2026-11-17") }).status).toBe(
      "confirmed",
    );
  });
});

describe("compras de OmniAgent en Devoluciones", () => {
  it("una compra pagada de verdad se sigue en cualquier tienda", () => {
    expect(tracksOmniOrder("stripe", null)).toBe(true);
    expect(tracksOmniOrder("stripe", { sandbox: false })).toBe(true);
  });

  it("una compra simulada solo se sigue en las tiendas de prueba", () => {
    const sonidoMax = findMerchantByName("SonidoMax");
    expect(sonidoMax?.sandbox).toBe(true);
    expect(tracksOmniOrder("sandbox", sonidoMax)).toBe(true);
    expect(tracksOmniOrder("sandbox", { sandbox: false })).toBe(false);
    expect(tracksOmniOrder("sandbox", null)).toBe(false);
  });
});
