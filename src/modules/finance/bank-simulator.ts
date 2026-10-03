// Generador de movimientos del sandbox: verosímil y determinista (misma semilla y fecha, mismos datos).
// Cada perfil de cuenta gasta por su canal: la nómina paga renta y súper; la tarjeta, suscripciones y restaurantes.
import { DAY_MS } from "./analyzers";
import { ANT_CATEGORY, FEES_CATEGORY, INCOME_CATEGORY, SUBSCRIPTIONS_CATEGORY, TRANSFER_CATEGORY } from "./categories";
import { fnvHash, type SandboxProfile } from "./providers/sandbox-catalog";

export interface SimulatedTransaction {
  externalId: string;
  postedAt: Date;
  amount: number;
  direction: "DEBIT" | "CREDIT";
  merchantName: string;
  description: string;
  category: string;
  subcategory: string | null;
  pending: boolean;
}

/** Suscripciones de la tarjeta y días desde su último uso (señal simulada de uso de apps). */
export const SANDBOX_SUBSCRIPTIONS = [
  { merchant: "StreamFlix", amount: 15.99, day: 5, subcategory: "video", lastUsedDaysAgo: 2 },
  { merchant: "MúsicaMax", amount: 10.99, day: 9, subcategory: "musica", lastUsedDaysAgo: 1 },
  { merchant: "CineClub+", amount: 8.99, day: 12, subcategory: "video", lastUsedDaysAgo: 104 },
  { merchant: "NubeFotos 200 GB", amount: 2.99, day: 16, subcategory: "almacenamiento", lastUsedDaysAgo: 97 },
  { merchant: "Noticias Premium", amount: 12.0, day: 21, subcategory: "noticias", lastUsedDaysAgo: 126 },
  { merchant: "GymFit", amount: 39.0, day: 3, subcategory: "gimnasio", lastUsedDaysAgo: 6 },
];

export function sandboxUsageSignals(): Record<string, number> {
  return Object.fromEntries(SANDBOX_SUBSCRIPTIONS.map((s) => [s.merchant, s.lastUsedDaysAgo]));
}

// mulberry32: generador pseudoaleatorio pequeño y determinista.
function random(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Pago mensual de la tarjeta: igual en la cuenta nómina (sale) y en la tarjeta (entra). */
function cardPayment(userSeed: string, yearMonth: string): number {
  const rand = random(fnvHash(`${userSeed}:pago-tarjeta:${yearMonth}`));
  return round2(1050 + rand() * 350);
}

function utcDayStart(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

export function simulateAccount(opts: {
  userSeed: string;
  accountId: string;
  profile: SandboxProfile;
  from: Date;
  to: Date;
  now?: Date;
}): SimulatedTransaction[] {
  const now = opts.now ?? new Date();
  const todayIso = new Date(utcDayStart(now)).toISOString().slice(0, 10);
  const out: SimulatedTransaction[] = [];

  for (let day = utcDayStart(opts.from); day <= utcDayStart(opts.to); day += DAY_MS) {
    const date = new Date(day);
    const iso = date.toISOString().slice(0, 10);
    const yearMonth = iso.slice(0, 7);
    const dayOfMonth = date.getUTCDate();
    const weekday = date.getUTCDay(); // 0 = domingo
    const daysAgo = Math.round((utcDayStart(now) - day) / DAY_MS);
    const rand = random(fnvHash(`${opts.userSeed}:${opts.accountId}:${iso}`));
    const between = (min: number, max: number) => min + rand() * (max - min);
    let seq = 0;

    const add = (
      merchantName: string,
      amount: number,
      category: string,
      extra: { direction?: "DEBIT" | "CREDIT"; subcategory?: string } = {},
    ) => {
      const hour = 7 + Math.floor(rand() * 14);
      const minute = Math.floor(rand() * 60);
      out.push({
        externalId: `${opts.accountId}-${iso}-${seq++}`,
        postedAt: new Date(day + hour * 3_600_000 + minute * 60_000),
        amount: round2(amount),
        direction: extra.direction ?? "DEBIT",
        merchantName,
        description: merchantName.toUpperCase(),
        category,
        subcategory: extra.subcategory ?? null,
        pending: iso === todayIso,
      });
    };

    switch (opts.profile) {
      case "checking": {
        if (dayOfMonth === 1 || dayOfMonth === 15) add("Nómina Empresa Andina", 2425, INCOME_CATEGORY, { direction: "CREDIT" });
        if (dayOfMonth === 1) add("Renta departamento", 1850, "Vivienda");
        if (dayOfMonth === 3) add("Transferencia a Ahorros", 200, TRANSFER_CATEGORY);
        if (dayOfMonth === 10) add("Internet Fibra", 60, "Servicios");
        if (dayOfMonth === 18) add("Plan celular", 45, "Servicios");
        if (dayOfMonth === 20) add("Pago Tarjeta Aurora", cardPayment(opts.userSeed, yearMonth), TRANSFER_CATEGORY);
        if (dayOfMonth === 24) add("Luz y agua", between(82, 112), "Servicios");
        if (dayOfMonth === 28) add("Comisión por manejo de cuenta", 4.99, FEES_CATEGORY);
        if (weekday === 6 || (weekday === 3 && rand() < 0.35)) add("Supermercado La Canasta", between(95, 170), "Supermercado");
        if (weekday >= 1 && weekday <= 5 && rand() < 0.7) add("Café Grano de Oro", between(3.6, 5.6), ANT_CATEGORY);
        if (weekday === 1 || (weekday === 4 && rand() < 0.25)) add("Gasolinera Ruta 9", between(38, 56), "Transporte");
        if (rand() < 0.06) add("Farmacia Salud+", between(12, 42), "Salud");
        break;
      }
      case "savings": {
        if (dayOfMonth === 3) add("Transferencia desde Cuenta nómina", 200, TRANSFER_CATEGORY, { direction: "CREDIT" });
        if (dayOfMonth === 28) add("Intereses ganados", between(1.2, 2.6), INCOME_CATEGORY, { direction: "CREDIT" });
        break;
      }
      case "credit_card": {
        for (const sub of SANDBOX_SUBSCRIPTIONS) {
          if (dayOfMonth === sub.day) add(sub.merchant, sub.amount, SUBSCRIPTIONS_CATEGORY, { subcategory: sub.subcategory });
        }
        // Restaurantes: suben en los últimos 30 días (para que el análisis detecte la tendencia)
        if (rand() < (daysAgo < 30 ? 0.3 : 0.22)) {
          add(rand() < 0.5 ? "La Parrilla del Centro" : "Sushi Nami", between(32, 72), "Restaurantes");
        }
        if (rand() < 0.4) add("EntregaYa", between(18, 36), "Delivery");
        if (rand() < 0.14) add("ViajeYa", between(9, 19), "Transporte");
        if (rand() < 0.07) add("Tienda en línea", between(35, 150), "Compras");
        if (rand() < 0.3) add("Tienda 24 h", between(4, 9.5), ANT_CATEGORY);
        if (dayOfMonth === 20) {
          add("Pago recibido, gracias", cardPayment(opts.userSeed, yearMonth), TRANSFER_CATEGORY, { direction: "CREDIT" });
        }
        if (dayOfMonth === 25) add("Intereses Tarjeta Aurora", between(14, 22), FEES_CATEGORY);
        if (dayOfMonth === 22 && Number(yearMonth.slice(5)) % 3 === 1) add("Cargo por pago tardío", 25, FEES_CATEGORY);
        break;
      }
      case "wallet": {
        if (rand() < 0.35) add("Snack Express", between(2.5, 6), ANT_CATEGORY);
        if (rand() < 0.12) add("ViajeYa", between(7, 14), "Transporte");
        if (weekday === 5) add("Recarga de datos", 5, "Servicios");
        if (rand() < 0.08) add("Transferencia de Carla R.", between(20, 60), TRANSFER_CATEGORY, { direction: "CREDIT" });
        break;
      }
      case "savings_coop": {
        if (dayOfMonth === 5) add("Aporte programado", 150, TRANSFER_CATEGORY, { direction: "CREDIT" });
        if (dayOfMonth === 28) add("Rendimientos", between(3, 5), INCOME_CATEGORY, { direction: "CREDIT" });
        break;
      }
    }
  }
  return out;
}

/** Saldo simulado (en tarjetas, el saldo es lo que se debe). */
export function simulateBalance(userSeed: string, accountId: string, profile: SandboxProfile): number {
  const r = fnvHash(`${userSeed}:${accountId}:saldo`);
  const cents = (r % 100) / 100;
  switch (profile) {
    case "checking":
      return round2(2400 + (r % 2600) + cents);
    case "savings":
      return round2(3000 + (r % 6000) + cents);
    case "credit_card":
      return round2(900 + (r % 700) + cents);
    case "wallet":
      return round2(30 + (r % 150) + cents);
    case "savings_coop":
      return round2(1200 + (r % 2800) + cents);
  }
}
