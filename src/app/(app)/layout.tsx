import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { ServiceWorkerRegistration } from "@/components/push/service-worker";
import { ensureProfile, requireUser } from "@/lib/auth";
import { agentStatusLine } from "@/lib/format";
import { countPendingActions } from "@/modules/actions/actions.service";
import { listRecentConversations } from "@/modules/agent/conversations";
import { conciergeBadge, countTracking } from "@/modules/concierge/concierge.service";
import { procedureCounts } from "@/modules/procedures/plan";
import { countOpenTasks } from "@/modules/procedures/procedures.service";
import { deliverDueReminders } from "@/modules/procedures/reminders";
import { returnsBadge } from "@/modules/returns/returns.service";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();
  const profile = await ensureProfile(user);
  // Recordatorios vencidos: se entregan al abrir la app (el cron los entrega aunque no la abras).
  await deliverDueReminders({ userId: user.userId, limit: 10 }).catch((error) => {
    console.error("[layout] no se pudieron entregar los recordatorios", error);
  });
  const [pending, watching, openTasks, recent, procedures, shopping, returns] = await Promise.all([
    countPendingActions(user.userId),
    countTracking(user.userId),
    countOpenTasks(user.userId),
    listRecentConversations(user.userId, 6),
    procedureCounts(user.userId),
    conciergeBadge(user.userId),
    returnsBadge(user.userId).catch(() => 0),
  ]);

  return (
    <AppShell
      user={{ id: user.userId, name: profile.fullName, email: profile.email }}
      timeZone={profile.timezone}
      pendingApprovals={pending}
      proceduresBadge={procedures.suggested + procedures.due}
      conciergeBadge={shopping}
      returnsBadge={returns}
      status={agentStatusLine(watching, openTasks)}
      recent={recent}
    >
      <ServiceWorkerRegistration />
      {children}
    </AppShell>
  );
}
