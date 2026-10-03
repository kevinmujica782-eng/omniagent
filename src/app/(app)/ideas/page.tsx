import type { Metadata } from "next";
import { IdeasView } from "@/components/views/ideas-view";
import { requireUser } from "@/lib/auth";
import { listSuggestions, refreshSuggestions, starterIdeas } from "@/modules/ideas/ideas.service";

export const metadata: Metadata = { title: "Ideas" };

export default async function IdeasPage() {
  const user = await requireUser();
  try {
    await refreshSuggestions(user.userId);
  } catch (error) {
    console.error("[ideas] no se pudieron recalcular", error);
  }
  const ideas = await listSuggestions(user.userId);
  return <IdeasView ideas={ideas.length > 0 ? ideas : starterIdeas()} hasData={ideas.length > 0} />;
}
