import type { Metadata } from "next";
import { ConciergeView } from "@/components/views/concierge-view";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { isUuid } from "@/lib/validation";
import { markAlertsSeen } from "@/modules/concierge/alerts.service";
import { getConciergePage } from "@/modules/concierge/concierge.service";

export const metadata: Metadata = { title: "Compras" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** /compras (y desde los avisos: ?alerta=…, ?producto=… o ?pedido=…). */
export default async function ComprasPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireUser();
  const params = await searchParams;
  const [data, profile] = await Promise.all([
    getConciergePage(user.userId),
    prisma.profile.findUnique({ where: { id: user.userId }, select: { timezone: true } }),
  ]);
  // Las ofertas nuevas quedan vistas al abrir Compras (esta vista todavía las marca como "Nueva").
  await markAlertsSeen(user.userId);
  const pick = (value: string | string[] | undefined) => (typeof value === "string" && isUuid(value) ? value : null);
  const alertId = pick(params.alerta);
  const alerts = alertId ? [...data.alerts].sort((a, b) => (a.id === alertId ? -1 : b.id === alertId ? 1 : 0)) : data.alerts;
  return (
    <ConciergeView
      {...data}
      alerts={alerts}
      timeZone={profile?.timezone ?? "UTC"}
      focus={{ itemId: pick(params.producto), orderId: pick(params.pedido) }}
    />
  );
}
