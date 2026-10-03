import { prisma } from "@/lib/db";
import { handle } from "@/lib/http";
import { proposeSubscriptionCancellation } from "@/modules/finance/cancellation";

type Context = { params: Promise<{ id: string }> };

/** Prepara la baja: queda en Aprobaciones hasta que el usuario la apruebe. */
export async function POST(request: Request, { params }: Context) {
  return handle(request, async (auth) => {
    const { id } = await params;
    const profile = await prisma.profile.findUnique({ where: { id: auth.userId }, select: { timezone: true } });
    return proposeSubscriptionCancellation(auth.userId, id, {
      reason: "Pedida desde Finanzas.",
      timeZone: profile?.timezone,
    });
  });
}
