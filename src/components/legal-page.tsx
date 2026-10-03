import Link from "next/link";
import type { ReactNode } from "react";
import { OmniMark } from "@/components/omni-mark";
import { LEGAL_LINKS, LEGAL_UPDATED, SUPPORT_EMAIL } from "@/lib/legal";

/** Página pública de texto legal (privacidad, términos, borrar la cuenta): legible en el teléfono y sin sesión. */
export function LegalPage({
  title,
  intro,
  updated = true,
  children,
}: {
  title: string;
  intro?: ReactNode;
  /** Muestra la fecha de la última actualización. */
  updated?: boolean;
  children: ReactNode;
}) {
  return (
    <main className="mx-auto min-h-dvh w-full max-w-2xl bg-canvas px-5 pb-16 pt-10 text-ink">
      <Link href="/" className="inline-flex items-center gap-2.5">
        <OmniMark size={32} />
        <span className="text-base font-semibold tracking-tight">OmniAgent</span>
      </Link>
      <h1 className="mt-8 text-3xl font-semibold tracking-tight text-balance">{title}</h1>
      {updated ? <p className="mt-2 text-sm text-muted">Última actualización: {LEGAL_UPDATED}</p> : null}
      {intro ? <div className="mt-5 text-base leading-relaxed text-ink">{intro}</div> : null}
      <div className="mt-8 flex flex-col gap-9">{children}</div>
      <footer className="mt-14 border-t border-line pt-6 text-sm text-muted">
        <p>
          ¿Dudas? Escríbenos a{" "}
          <a href={`mailto:${SUPPORT_EMAIL}`} className="font-semibold text-primary underline-offset-2 hover:underline">
            {SUPPORT_EMAIL}
          </a>
          .
        </p>
        <nav aria-label="Textos legales" className="mt-3 flex flex-wrap gap-x-5 gap-y-2">
          {LEGAL_LINKS.map((link) => (
            <Link key={link.href} href={link.href} className="font-medium text-ink underline-offset-2 hover:underline">
              {link.label}
            </Link>
          ))}
        </nav>
      </footer>
    </main>
  );
}

export function LegalSection({ title, id, children }: { title: string; id?: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-6">
      <h2 className="text-lg font-semibold tracking-tight text-ink">{title}</h2>
      <div className="mt-3 flex flex-col gap-3 text-[15px] leading-relaxed text-ink [&_li]:pl-0.5 [&_ol]:flex [&_ol]:list-decimal [&_ol]:flex-col [&_ol]:gap-2 [&_ol]:pl-5 [&_strong]:font-semibold [&_ul]:flex [&_ul]:list-disc [&_ul]:flex-col [&_ul]:gap-2 [&_ul]:pl-5">
        {children}
      </div>
    </section>
  );
}

/** Enlaces legales en una línea, para pies de página y la pantalla de entrar. */
export function LegalLinks({ className }: { className?: string }) {
  return (
    <nav aria-label="Textos legales" className={className}>
      <ul className="flex flex-wrap gap-x-4 gap-y-1.5">
        {LEGAL_LINKS.map((link) => (
          <li key={link.href}>
            <Link href={link.href} className="underline-offset-2 hover:text-ink hover:underline">
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
