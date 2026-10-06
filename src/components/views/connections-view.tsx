import { Check } from "lucide-react";
import Link from "next/link";
import { ConnectBankButton } from "@/components/finance/connect-bank-button";
import { CONNECTOR_ICON } from "@/components/icons";
import { ConnectMailButton } from "@/components/procedures/connect-mail";
import { Chip, IconTile, PageBody, PageHeader, Panel, Section } from "@/components/ui";
import type { ConnectorView } from "@/modules/connections/catalog";

/** En la vista previa, "/finanzas" o "/tramites#calendario" se convierten en pantallas de ejemplo. */
function hrefFor(path: string, preview: boolean): string {
  if (!preview) return path;
  const screen = path.replace(/^\//, "").split(/[#?]/)[0] || "chat";
  return `/preview?screen=${screen}`;
}

const LINK_CLASS = "text-sm font-semibold text-primary underline-offset-2 hover:underline";

function ConnectorRow({ connector, preview }: { connector: ConnectorView; preview: boolean }) {
  const Icon = CONNECTOR_ICON[connector.icon];
  const connected = connector.status === "connected";
  return (
    <div className="flex items-center gap-3 px-4 py-3.5">
      <IconTile icon={Icon} tone={connected ? "primary" : "neutral"} />
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-semibold text-ink">
          <span className="min-w-0 break-words">{connector.name}</span>
          {connector.sandbox ? <Chip>Demo</Chip> : null}
        </p>
        <p className="text-xs leading-relaxed text-muted">
          {connected && connector.detail ? connector.detail : connector.description}
        </p>
      </div>
      <div className="shrink-0">
        {connected && connector.manageHref ? (
          <Link href={hrefFor(connector.manageHref, preview)} className={LINK_CLASS}>
            Administrar
          </Link>
        ) : connected ? (
          <Chip tone="good">
            <Check className="size-3.5" aria-hidden />
            Conectado
          </Chip>
        ) : connector.action === "link_bank" ? (
          <ConnectBankButton label="Conectar" size="sm" icon={false} demo={preview} />
        ) : connector.action === "link_mail" ? (
          <ConnectMailButton label="Conectar" size="sm" demo={preview} startAt={connector.id === "mail_demo" ? "demo" : "real"} />
        ) : connector.action === "calendar_feed" ? (
          <Link href={hrefFor("/tramites#calendario", preview)} className={LINK_CLASS}>
            Configurar
          </Link>
        ) : connector.action === "concierge" ? (
          <Link href={hrefFor("/compras", preview)} className={LINK_CLASS}>
            Abrir
          </Link>
        ) : (
          <Chip>Pronto</Chip>
        )}
      </div>
    </div>
  );
}

export function ConnectionsView({
  connected,
  available,
  preview = false,
}: {
  connected: ConnectorView[];
  available: ConnectorView[];
  preview?: boolean;
}) {
  return (
    <PageBody>
      <PageHeader
        title="Conexiones"
        description="Conecta las apps que ya usas. Omni solo lee lo necesario y te pide permiso antes de actuar."
      />
      <Section title="Conectadas">
        {connected.length > 0 ? (
          <Panel>
            {connected.map((connector) => (
              <ConnectorRow key={connector.id} connector={connector} preview={preview} />
            ))}
          </Panel>
        ) : (
          <p className="rounded-2xl border border-dashed border-line-strong px-4 py-5 text-sm text-muted">
            Aún no conectas nada. Empieza por tus bancos y tarjetas, o por tu correo.
          </p>
        )}
      </Section>
      <Section title="Disponibles">
        <Panel>
          {available.map((connector) => (
            <ConnectorRow key={connector.id} connector={connector} preview={preview} />
          ))}
        </Panel>
      </Section>
      <p className="mt-6 px-1 text-xs leading-relaxed text-muted">
        Los accesos a tus cuentas se guardan cifrados y puedes desconectarlos cuando quieras. Lo marcado como Demo usa
        datos inventados: no mueve dinero real ni envía nada fuera de OmniAgent.
      </p>
    </PageBody>
  );
}
