import {
  AtSign,
  Check,
  ChevronDown,
  Clock,
  Gift,
  Globe,
  Heart,
  Leaf,
  Mail,
  MapPin,
  MessageCircle,
  Phone,
  ShieldCheck,
  Sparkles,
  Star,
  Tag,
  Truck,
  Zap,
  type LucideIcon,
} from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { contactLinks, type ContactKind, type ContactLink } from "@/modules/sites/sites.rules";
import type { FeatureIcon, PaletteId, SiteContent, SiteSection } from "@/modules/sites/sites.types";

// La página web que arma Omni, tal como la ve cualquiera que abre el enlace. Sin JavaScript propio: texto, enlaces y
// preguntas que se abren con <details>. Los colores salen de la paleta de la página (variables --s-*), así el mismo
// diseño sirve a una panadería, un estudio de uñas o una tienda de cuentas, y los enlaces son solo los del contacto
// que dio la persona.

type Palette = { bg: string; surface: string; ink: string; muted: string; accent: string; onAccent: string; soft: string; line: string };

export const SITE_PALETTES: Record<PaletteId, Palette> = {
  bosque: { bg: "#F3F5F0", surface: "#FFFFFF", ink: "#16231C", muted: "#56655C", accent: "#1F6B4A", onAccent: "#FFFFFF", soft: "#DDEBE2", line: "#D6DFD8" },
  oceano: { bg: "#F1F5F9", surface: "#FFFFFF", ink: "#0F1E2E", muted: "#4F5F6F", accent: "#1D5FA8", onAccent: "#FFFFFF", soft: "#DCE8F6", line: "#D3DDE8" },
  atardecer: { bg: "#FBF4EE", surface: "#FFFFFF", ink: "#2A1A12", muted: "#6E584C", accent: "#B04A17", onAccent: "#FFFFFF", soft: "#F6E1D2", line: "#EAD9CC" },
  grafito: { bg: "#141619", surface: "#1C1F23", ink: "#F1F2F3", muted: "#A1A7AE", accent: "#E3C04B", onAccent: "#17181A", soft: "#23262B", line: "#2E3238" },
  ciruela: { bg: "#F7F2F7", surface: "#FFFFFF", ink: "#24142A", muted: "#67566D", accent: "#7A3B8F", onAccent: "#FFFFFF", soft: "#EBDDF0", line: "#E2D5E6" },
  arena: { bg: "#F6F1E7", surface: "#FFFDF8", ink: "#2B2620", muted: "#6B6256", accent: "#7C5A1E", onAccent: "#FFFFFF", soft: "#ECE2CC", line: "#E2D8C4" },
};

const FEATURE_ICON: Record<FeatureIcon, LucideIcon> = {
  check: Check,
  estrella: Star,
  corazon: Heart,
  rayo: Zap,
  escudo: ShieldCheck,
  reloj: Clock,
  envio: Truck,
  chat: MessageCircle,
  regalo: Gift,
  hoja: Leaf,
  chispa: Sparkles,
  etiqueta: Tag,
};

const CONTACT_ICON: Record<ContactKind, LucideIcon> = {
  whatsapp: MessageCircle,
  phone: Phone,
  email: Mail,
  instagram: AtSign,
  website: Globe,
};

/** Texto corto del botón del encabezado. */
const HEADER_LABEL: Record<ContactKind, string> = {
  whatsapp: "WhatsApp",
  phone: "Llamar",
  email: "Escribir",
  instagram: "Instagram",
  website: "Web",
};

function linkProps(href: string): { href: string; target?: string; rel?: string } {
  return href.startsWith("https://") ? { href, target: "_blank", rel: "noopener noreferrer" } : { href };
}

const PRIMARY_BUTTON =
  "inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-[var(--s-accent)] px-6 text-base font-semibold text-[var(--s-on-accent)] transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--s-accent)]";

function Paragraphs({ text, className }: { text: string; className?: string }) {
  return (
    <>
      {text
        .split(/\n{2,}/)
        .filter(Boolean)
        .map((paragraph, i) => (
          <p key={i} className={className}>
            {paragraph}
          </p>
        ))}
    </>
  );
}

function SectionShell({ id, title, children }: { id?: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="border-t border-[var(--s-line)] py-14 first:border-t-0 sm:py-20">
      <h2 className="max-w-2xl text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h2>
      {children}
    </section>
  );
}

function SectionBlock({ section }: { section: SiteSection }) {
  switch (section.kind) {
    case "features":
      return (
        <SectionShell title={section.title}>
          <ul className="mt-8 grid gap-3 sm:grid-cols-2">
            {section.items.map((item) => {
              const Icon = FEATURE_ICON[item.icon];
              return (
                <li key={item.title} className="flex gap-4 rounded-2xl border border-[var(--s-line)] bg-[var(--s-surface)] p-5">
                  <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-[var(--s-soft)] text-[var(--s-accent)]">
                    <Icon className="size-5" aria-hidden />
                  </span>
                  <div className="min-w-0">
                    <h3 className="font-semibold leading-snug">{item.title}</h3>
                    {item.text ? <p className="mt-1 leading-relaxed text-[var(--s-muted)]">{item.text}</p> : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </SectionShell>
      );
    case "about":
      return (
        <SectionShell title={section.title}>
          <div className="mt-5 flex max-w-2xl flex-col gap-4 text-lg leading-relaxed text-[var(--s-muted)]">
            <Paragraphs text={section.text} />
          </div>
        </SectionShell>
      );
    case "steps":
      return (
        <SectionShell title={section.title}>
          <ol className="mt-8 flex max-w-2xl flex-col gap-6">
            {section.items.map((item, i) => (
              <li key={item.title} className="flex gap-4">
                <span className="grid size-9 shrink-0 place-items-center rounded-full bg-[var(--s-accent)] text-sm font-semibold text-[var(--s-on-accent)]">
                  {i + 1}
                </span>
                <div className="pt-1">
                  <h3 className="font-semibold leading-snug">{item.title}</h3>
                  {item.text ? <p className="mt-1 leading-relaxed text-[var(--s-muted)]">{item.text}</p> : null}
                </div>
              </li>
            ))}
          </ol>
        </SectionShell>
      );
    case "pricing":
      return (
        <SectionShell title={section.title}>
          <dl className="mt-8 max-w-2xl divide-y divide-[var(--s-line)] overflow-hidden rounded-2xl border border-[var(--s-line)] bg-[var(--s-surface)]">
            {section.items.map((item) => (
              <div key={item.name} className="flex items-baseline justify-between gap-6 px-5 py-4">
                <dt className="min-w-0">
                  <span className="font-medium">{item.name}</span>
                  {item.detail ? <span className="mt-0.5 block text-sm text-[var(--s-muted)]">{item.detail}</span> : null}
                </dt>
                <dd className="shrink-0 text-lg font-semibold tabular-nums">{item.price}</dd>
              </div>
            ))}
          </dl>
          {section.note ? <p className="mt-4 max-w-2xl text-sm text-[var(--s-muted)]">{section.note}</p> : null}
        </SectionShell>
      );
    case "faq":
      return (
        <SectionShell title={section.title}>
          <div className="mt-8 flex max-w-2xl flex-col gap-3">
            {section.items.map((item) => (
              <details key={item.question} className="group rounded-2xl border border-[var(--s-line)] bg-[var(--s-surface)] px-5 py-4">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium [&::-webkit-details-marker]:hidden">
                  {item.question}
                  <ChevronDown className="size-5 shrink-0 text-[var(--s-muted)] transition-transform group-open:rotate-180" aria-hidden />
                </summary>
                <p className="mt-3 leading-relaxed text-[var(--s-muted)]">{item.answer}</p>
              </details>
            ))}
          </div>
        </SectionShell>
      );
  }
}

function ContactList({ links, address, hours }: { links: ContactLink[]; address: string | null; hours: string | null }) {
  return (
    <ul className="mt-8 grid gap-3 sm:grid-cols-2">
      {links.map((link) => {
        const Icon = CONTACT_ICON[link.kind];
        return (
          <li key={link.kind}>
            <a
              {...linkProps(link.href)}
              className="flex items-center gap-4 rounded-2xl border border-[var(--s-line)] bg-[var(--s-surface)] p-4 transition-colors hover:border-[var(--s-accent)]"
            >
              <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-[var(--s-soft)] text-[var(--s-accent)]">
                <Icon className="size-5" aria-hidden />
              </span>
              <span className="min-w-0">
                <span className="block text-sm text-[var(--s-muted)]">{link.label}</span>
                <span className="block truncate font-medium">{link.detail}</span>
              </span>
            </a>
          </li>
        );
      })}
      {address ? (
        <li className="flex items-center gap-4 rounded-2xl border border-[var(--s-line)] bg-[var(--s-surface)] p-4">
          <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-[var(--s-soft)] text-[var(--s-accent)]">
            <MapPin className="size-5" aria-hidden />
          </span>
          <span className="min-w-0">
            <span className="block text-sm text-[var(--s-muted)]">Dirección</span>
            <span className="block font-medium">{address}</span>
          </span>
        </li>
      ) : null}
      {hours ? (
        <li className="flex items-center gap-4 rounded-2xl border border-[var(--s-line)] bg-[var(--s-surface)] p-4">
          <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-[var(--s-soft)] text-[var(--s-accent)]">
            <Clock className="size-5" aria-hidden />
          </span>
          <span className="min-w-0">
            <span className="block text-sm text-[var(--s-muted)]">Horario</span>
            <span className="block font-medium">{hours}</span>
          </span>
        </li>
      ) : null}
    </ul>
  );
}

export function SitePage({
  content,
  preview,
  reportHref,
  year,
}: {
  content: SiteContent;
  /** Vista previa para su dueño (todavía sin publicar, o con cambios que esperan aprobación). */
  preview: boolean;
  /** Para reportar la página (abuso, suplantación). */
  reportHref: string;
  year: number;
}) {
  const palette = SITE_PALETTES[content.palette];
  const style = {
    "--s-bg": palette.bg,
    "--s-surface": palette.surface,
    "--s-ink": palette.ink,
    "--s-muted": palette.muted,
    "--s-accent": palette.accent,
    "--s-on-accent": palette.onAccent,
    "--s-soft": palette.soft,
    "--s-line": palette.line,
    colorScheme: content.palette === "grafito" ? "dark" : "light",
  } as CSSProperties;
  const links = contactLinks(content.contact);
  const primary = links[0] ?? null;
  const ctaHref = primary?.href ?? "#contenido";
  const hasContact = links.length > 0 || content.contact.address || content.contact.hours;

  return (
    <div style={style} className="min-h-dvh bg-[var(--s-bg)] text-[var(--s-ink)] antialiased">
      {preview ? (
        <div role="status" className="bg-[#1F2328] px-5 py-2.5 text-center text-sm text-white">
          Vista previa: todavía no está publicada y solo tú la ves.{" "}
          <a href="/aprobaciones" className="font-semibold underline underline-offset-4">
            Publícala en Aprobaciones
          </a>
        </div>
      ) : null}

      <header className="sticky top-0 z-10 border-b border-[var(--s-line)] bg-[color-mix(in_oklab,var(--s-bg)_88%,transparent)] backdrop-blur">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between gap-4 px-5">
          <a href="#inicio" className="truncate text-lg font-semibold tracking-tight">
            {content.name}
          </a>
          {primary ? (
            <a
              {...linkProps(primary.href)}
              className="inline-flex h-10 shrink-0 items-center gap-2 rounded-full border border-[var(--s-accent)] px-4 text-sm font-semibold text-[var(--s-accent)] transition-colors hover:bg-[var(--s-accent)] hover:text-[var(--s-on-accent)]"
            >
              {(() => {
                const Icon = CONTACT_ICON[primary.kind];
                return <Icon className="size-4" aria-hidden />;
              })()}
              {HEADER_LABEL[primary.kind]}
            </a>
          ) : null}
        </div>
      </header>

      <main id="inicio">
        <section className="px-3 pt-3 sm:px-5 sm:pt-5">
          <div className="mx-auto max-w-5xl rounded-[2rem] bg-[var(--s-soft)] px-6 py-14 sm:px-12 sm:py-20">
            {content.tagline ? <p className="max-w-2xl text-sm font-semibold text-[var(--s-accent)]">{content.tagline}</p> : null}
            <h1 className="mt-3 max-w-3xl text-4xl font-semibold leading-[1.06] tracking-tight text-balance sm:text-6xl">
              {content.hero.headline}
            </h1>
            {content.hero.subheadline ? (
              <p className="mt-5 max-w-2xl text-lg leading-relaxed text-[var(--s-muted)] sm:text-xl">{content.hero.subheadline}</p>
            ) : null}
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <a {...linkProps(ctaHref)} className={PRIMARY_BUTTON}>
                {content.hero.ctaLabel}
              </a>
              {content.sections.length > 0 && primary ? (
                <a href="#contenido" className="inline-flex min-h-12 items-center px-3 text-base font-semibold text-[var(--s-ink)] underline-offset-4 hover:underline">
                  Ver más
                </a>
              ) : null}
            </div>
          </div>
        </section>

        <div id="contenido" className="mx-auto max-w-5xl px-5 sm:px-8">
          {content.sections.map((section, i) => (
            <SectionBlock key={`${section.kind}-${i}`} section={section} />
          ))}
        </div>

        {content.closing ? (
          <section className="px-3 sm:px-5">
            <div className="mx-auto max-w-5xl rounded-[2rem] bg-[var(--s-accent)] px-6 py-14 text-[var(--s-on-accent)] sm:px-12">
              <h2 className="max-w-2xl text-3xl font-semibold tracking-tight text-balance">{content.closing.title}</h2>
              {content.closing.text ? <p className="mt-3 max-w-xl text-lg opacity-90">{content.closing.text}</p> : null}
              {primary ? (
                <a
                  {...linkProps(primary.href)}
                  className="mt-8 inline-flex min-h-12 items-center justify-center rounded-full bg-[var(--s-on-accent)] px-6 text-base font-semibold text-[var(--s-accent)] transition-opacity hover:opacity-90"
                >
                  {content.hero.ctaLabel}
                </a>
              ) : null}
            </div>
          </section>
        ) : null}

        {hasContact ? (
          <div className="mx-auto max-w-5xl px-5 sm:px-8">
            <SectionShell id="contacto" title="Contacto">
              <ContactList links={links} address={content.contact.address} hours={content.contact.hours} />
            </SectionShell>
          </div>
        ) : null}
      </main>

      <footer className="border-t border-[var(--s-line)]">
        <div className="mx-auto flex max-w-5xl flex-col gap-2 px-5 py-8 text-sm text-[var(--s-muted)] sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <p>
            © {year} {content.name}
          </p>
          <p className="flex flex-wrap gap-x-4 gap-y-1">
            <a href="/" className="underline-offset-4 hover:underline">
              Página hecha con OmniAgent
            </a>
            <a href={reportHref} className="underline-offset-4 hover:underline">
              Reportar esta página
            </a>
          </p>
        </div>
      </footer>
    </div>
  );
}
