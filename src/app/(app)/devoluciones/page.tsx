import type { Metadata } from "next";
import { ReturnsView } from "@/components/views/returns-view";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { isUuid } from "@/lib/validation";
import { getReturnsOverview } from "@/modules/returns/returns.service";

export const metadata: Metadata = { title: "Devoluciones" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** /devoluciones (y desde los avisos: ?pedido=… o ?caso=…). Antes de mostrar, pone al día correos, retrasos y reembolsos. */
export default async function DevolucionesPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireUser();
  const params = await searchParams;
  const [data, profile] = await Promise.all([
    getReturnsOverview(user.userId),
    prisma.profile.findUnique({ where: { id: user.userId }, select: { timezone: true, currency: true } }),
  ]);
  const pick = (value: string | string[] | undefined) => (typeof value === "string" && isUuid(value) ? value : null);
  return (
    <ReturnsView
      data={data}
      timeZone={profile?.timezone ?? "UTC"}
      currency={profile?.currency ?? "USD"}
      focus={{ orderId: pick(params.pedido), caseId: pick(params.caso) }}
    />
  );
}
