import type { Metadata } from "next";
import { DashboardView } from "@/components/views/dashboard-view";
import { requireUser } from "@/lib/auth";
import { getDashboard } from "@/modules/dashboard/dashboard.service";

export const metadata: Metadata = { title: "Inicio" };

export default async function HomeDashboardPage() {
  const user = await requireUser();
  const data = await getDashboard(user.userId);
  return <DashboardView data={data} />;
}
