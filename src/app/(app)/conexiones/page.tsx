import type { Metadata } from "next";
import { ConnectionsView } from "@/components/views/connections-view";
import { requireUser } from "@/lib/auth";
import { listConnectorViews } from "@/modules/connections/connections.service";

export const metadata: Metadata = { title: "Conexiones" };

export default async function ConnectionsPage() {
  const user = await requireUser();
  const { connected, available } = await listConnectorViews(user.userId);
  return <ConnectionsView connected={connected} available={available} />;
}
