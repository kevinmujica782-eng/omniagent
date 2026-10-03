import { z } from "zod";
import { ensureProfile } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { handle, readJson } from "@/lib/http";
import { isValidTimeZone } from "@/lib/validation";
import { countPendingActions } from "@/modules/actions/actions.service";
import { getEntitlements, monthlyUsage } from "@/modules/billing/entitlements";

export async function GET(request: Request) {
  return handle(request, async (auth) => {
    const profile = await ensureProfile(auth);
    const [entitlements, usage, pendingApprovals] = await Promise.all([
      getEntitlements(auth.userId),
      monthlyUsage(auth.userId),
      countPendingActions(auth.userId),
    ]);
    return {
      profile,
      plan: entitlements.plan,
      limits: entitlements.limits,
      usage: { messagesThisMonth: usage },
      subscription: {
        source: entitlements.source,
        renewsAt: entitlements.renewsAt,
        cancelAtPeriodEnd: entitlements.cancelAtPeriodEnd,
      },
      pendingApprovals,
    };
  });
}

const patchSchema = z.object({
  fullName: z.string().trim().min(1).max(80).optional(),
  timezone: z.string().max(64).refine(isValidTimeZone, "Zona horaria no válida").optional(),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/, "Usa un código ISO de 3 letras, como USD")
    .optional(),
});

export async function PATCH(request: Request) {
  return handle(request, async (auth) => {
    const body = await readJson(request, patchSchema);
    await ensureProfile(auth);
    return prisma.profile.update({
      where: { id: auth.userId },
      data: {
        ...(body.fullName ? { fullName: body.fullName } : {}),
        ...(body.timezone ? { timezone: body.timezone } : {}),
        ...(body.currency ? { currency: body.currency } : {}),
      },
      select: { id: true, email: true, fullName: true, timezone: true, currency: true },
    });
  });
}
