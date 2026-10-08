import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SitePage } from "@/components/sites/site-page";
import { getOptionalUser } from "@/lib/auth";
import { SUPPORT_EMAIL } from "@/lib/legal";
import { getPublishedSite, getSitePreview } from "@/modules/sites/sites.service";
import type { SiteContent } from "@/modules/sites/sites.types";

// Página web pública que armó Omni (/s/{slug}). Solo abre si está publicada; con ?vista=previa, su dueño ve la
// versión que espera aprobación. No aparece en buscadores: se comparte con el enlace.

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ vista?: string }> };

async function loadSite(slug: string, wantsPreview: boolean): Promise<{ content: SiteContent; preview: boolean } | null> {
  if (wantsPreview) {
    const user = await getOptionalUser();
    const preview = user ? await getSitePreview(slug, user.userId) : null;
    if (preview) return { content: preview, preview: true };
  }
  const content = await getPublishedSite(slug);
  return content ? { content, preview: false } : null;
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const [{ slug }, { vista }] = await Promise.all([params, searchParams]);
  const site = await loadSite(slug, vista === "previa");
  if (!site) return { title: "Página no encontrada", robots: { index: false, follow: false } };
  const description = site.content.tagline || site.content.hero.subheadline || site.content.hero.headline;
  return {
    title: { absolute: site.content.name },
    description,
    robots: { index: false, follow: false },
    openGraph: { title: site.content.name, description },
  };
}

export default async function PublicSitePage({ params, searchParams }: Props) {
  const [{ slug }, { vista }] = await Promise.all([params, searchParams]);
  const site = await loadSite(slug, vista === "previa");
  if (!site) notFound();
  const report = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(`Reportar la página ${slug}`)}`;
  return <SitePage content={site.content} preview={site.preview} reportHref={report} year={new Date().getFullYear()} />;
}
