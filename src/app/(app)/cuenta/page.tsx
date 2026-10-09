import type { Metadata } from "next";
import { AccountView } from "@/components/views/account-view";
import { ensureProfile, requireUser } from "@/lib/auth";
import { modelsForApp } from "@/modules/ai/ai.service";
import { billingOverview } from "@/modules/billing/overview";

export const metadata: Metadata = { title: "Cuenta" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function AccountPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireUser();
  const params = await searchParams;
  // Binance Pay vuelve con ?binance=<orden> o ?binance=cancelado (admite un solo parámetro en cada URL de vuelta).
  const binance = typeof params.binance === "string" ? params.binance : null;
  const binanceOrder = binance && binance !== "cancelado" && /^[A-Za-z0-9]{1,32}$/.test(binance) ? binance : null;
  const notice =
    params.checkout === "success" ? "success" : params.checkout === "cancel" || binance === "cancelado" ? "cancel" : null;
  const sessionId = typeof params.session_id === "string" ? params.session_id : null;

  const profile = await ensureProfile(user);
  const [billing, models] = await Promise.all([billingOverview(user.userId), modelsForApp(user.userId)]);

  return (
    <AccountView
      profile={{ name: profile.fullName, email: profile.email, timezone: profile.timezone, currency: profile.currency }}
      billing={billing}
      models={models}
      notice={notice}
      checkoutSessionId={sessionId}
      binanceOrder={binanceOrder}
    />
  );
}
