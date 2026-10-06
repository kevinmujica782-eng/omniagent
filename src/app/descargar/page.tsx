import { Bell, Download, Globe, Smartphone } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { InstallPwaButton } from "@/components/install-pwa-button";
import { LegalLinks } from "@/components/legal-page";
import { OmniMark } from "@/components/omni-mark";
import { ButtonLink, buttonClass } from "@/components/ui";
import { appHost } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Descargar OmniAgent",
  description: "Instala OmniAgent en tu Android o iPhone: tu agente para gastos, trámites y compras. Gratis para empezar.",
};

const APK_PATH = "/descargas/OmniAgent.apk";

function Step({ n, children }: { n: number; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="grid size-6 shrink-0 place-items-center rounded-full bg-primary-soft text-xs font-semibold tabular-nums text-primary">{n}</span>
      <span className="text-sm leading-relaxed text-muted">{children}</span>
    </li>
  );
}

function Card({ icon: Icon, title, children }: { icon: typeof Smartphone; title: string; children: ReactNode }) {
  return (
    <section className="rounded-3xl border border-line bg-surface p-5 sm:p-6">
      <h2 className="flex items-center gap-2.5 text-lg font-semibold tracking-tight text-ink">
        <Icon className="size-5 text-primary" aria-hidden />
        {title}
      </h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

// Página pública para compartir en anuncios y redes: un solo enlace para instalar la app en cualquier teléfono.
export default function DownloadPage() {
  const host = appHost();
  return (
    <main className="mx-auto min-h-dvh w-full max-w-xl bg-canvas px-4 pb-16 pt-8 text-ink sm:px-6">
      <Link href="/" className="inline-flex items-center gap-2.5">
        <OmniMark size={32} />
        <span className="text-base font-semibold tracking-tight">OmniAgent</span>
      </Link>

      <h1 className="mt-8 text-3xl font-semibold tracking-tight text-balance sm:text-4xl">Lleva a Omni en tu teléfono</h1>
      <p className="mt-3 text-base leading-relaxed text-muted">
        Tu agente personal revisa tus gastos, adelanta tus trámites y vigila precios. Nada se paga ni se envía sin tu visto bueno.
        Gratis para empezar.
      </p>

      <div className="mt-8 space-y-4">
        <Card icon={Smartphone} title="Android">
          <a href={APK_PATH} download="OmniAgent.apk" className={`${buttonClass("primary", "lg")} w-full`}>
            <Download className="size-4" aria-hidden />
            Descargar OmniAgent para Android
          </a>
          <ol className="mt-5 space-y-3">
            <Step n={1}>Toca el botón y abre el archivo que se descargó.</Step>
            <Step n={2}>
              Si Android lo pide, permite <b className="text-ink">instalar apps de este navegador</b> (solo esta vez) y toca{" "}
              <b className="text-ink">Instalar</b>.
            </Step>
            <Step n={3}>Abre OmniAgent, crea tu cuenta y activa las notificaciones en Cuenta.</Step>
          </ol>
          <InstallPwaButton className="mt-5 w-full" />
          <p className="mt-4 text-xs leading-relaxed text-muted">
            También puedes abrir {host} en Chrome y tocar ⋮ → <b>Instalar app</b>.
          </p>
        </Card>

        <Card icon={Smartphone} title="iPhone">
          <ol className="space-y-3">
            <Step n={1}>
              Abre <b className="text-ink">{host}</b> en Safari.
            </Step>
            <Step n={2}>
              Toca <b className="text-ink">Compartir</b> y luego <b className="text-ink">Agregar a inicio</b>.
            </Step>
            <Step n={3}>Abre OmniAgent desde ese ícono y activa las notificaciones en Cuenta (iOS 16.4 o más).</Step>
          </ol>
        </Card>

        <Card icon={Globe} title="En la computadora">
          <p className="text-sm leading-relaxed text-muted">Entra desde cualquier navegador con tu cuenta.</p>
          <ButtonLink href="/login" variant="secondary" className="mt-4 w-full">
            Entrar a OmniAgent
          </ButtonLink>
        </Card>
      </div>

      <p className="mt-8 flex items-start gap-2.5 text-sm leading-relaxed text-muted">
        <Bell className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
        Omni te avisa cuando un precio baja, vence un trámite o algo espera tu aprobación.
      </p>

      <footer className="mt-12 border-t border-line pt-6 text-sm text-muted">
        <LegalLinks />
      </footer>
    </main>
  );
}
