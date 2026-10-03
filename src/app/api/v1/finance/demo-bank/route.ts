import { audit } from "@/lib/audit";
import { ensureProfile } from "@/lib/auth";
import { handle } from "@/lib/http";
import { connectDemoAccounts } from "@/modules/finance/sync.service";

export const maxDuration = 60;

/** "Probar con datos de ejemplo": conecta cuenta nómina, ahorros y tarjeta de crédito del sandbox. */
export async function POST(request: Request) {
  return handle(request, async (auth) => {
    await ensureProfile(auth);
    const result = await connectDemoAccounts(auth.userId);
    await audit({ userId: auth.userId, actor: "user", action: "finance.demo_accounts.connected", metadata: result });
    return result;
  });
}
