import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PreviewScreen, isPreviewScreen } from "@/components/preview/preview-screen";

export const metadata: Metadata = { title: "Vista previa", robots: { index: false, follow: false } };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** Todas las pantallas con datos de ejemplo: /preview?screen=finanzas (y ?screen=chat&vacio=1). */
export default async function PreviewPage({ searchParams }: { searchParams: SearchParams }) {
  if (process.env.NODE_ENV === "production" && process.env.ENABLE_PREVIEW !== "true") notFound();
  const params = await searchParams;
  const screen = isPreviewScreen(params.screen) ? params.screen : "chat";
  return <PreviewScreen screen={screen} emptyChat={params.vacio === "1"} />;
}
