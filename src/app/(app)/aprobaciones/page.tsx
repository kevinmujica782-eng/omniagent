import type { Metadata } from "next";
import { ApprovalsView } from "@/components/views/approvals-view";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { listActions } from "@/modules/actions/actions.service";

export const metadata: Metadata = { title: "Aprobaciones" };

export default async function ApprovalsPage() {
  const user = await requireUser();
  const pending = await listActions(user.userId, "pending");
  const [history, profile] = await Promise.all([
    listActions(user.userId, "history", 15),
    prisma.profile.findUnique({ where: { id: user.userId }, select: { timezone: true } }),
  ]);
  return <ApprovalsView pending={pending} history={history} timeZone={profile?.timezone} />;
}
