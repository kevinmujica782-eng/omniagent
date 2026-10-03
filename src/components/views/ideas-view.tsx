import Link from "next/link";
import { ActionButton } from "@/components/action-button";
import { MODULE_ICON } from "@/components/icons";
import { Chip, IconTile, PageBody, PageHeader, Panel, buttonClass } from "@/components/ui";
import { money } from "@/lib/format";
import type { IdeaView } from "@/types/cards";

export function ideaHref(idea: IdeaView): string {
  const params = new URLSearchParams({ prompt: idea.prompt });
  if (!idea.starter) params.set("idea", idea.id);
  return `/chat?${params.toString()}`;
}

export function IdeaRow({ idea, dismissible = true }: { idea: IdeaView; dismissible?: boolean }) {
  const Icon = MODULE_ICON[idea.module];
  return (
    <article className="flex gap-3.5 px-4 py-4">
      <IconTile icon={Icon} />
      <div className="min-w-0 flex-1">
        <h2 className="text-[15px] font-semibold leading-snug text-ink">{idea.title}</h2>
        <p className="mt-1 text-sm leading-relaxed text-muted">{idea.body}</p>
        {idea.estimatedMonthlySavings ? (
          <div className="mt-2">
            <Chip tone="good">
              Ahorras {money(idea.estimatedMonthlySavings, idea.currency ?? "USD", { cents: true })} al mes
            </Chip>
          </div>
        ) : null}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Link href={ideaHref(idea)} className={buttonClass("primary", "sm")}>
            Encárgaselo a Omni
          </Link>
          {dismissible && !idea.starter ? (
            <ActionButton
              endpoint={`/api/v1/ideas/${idea.id}`}
              method="PATCH"
              body={{ status: "DISMISSED" }}
              label="Ahora no"
              pendingLabel="Descartando…"
              variant="ghost"
              size="sm"
            />
          ) : null}
        </div>
      </div>
    </article>
  );
}

export function IdeasView({ ideas, hasData, preview = false }: { ideas: IdeaView[]; hasData: boolean; preview?: boolean }) {
  return (
    <PageBody>
      <PageHeader
        title="Ideas"
        description={
          hasData
            ? "Cosas que Omni puede resolver por ti, según tus datos."
            : "Elige una para empezar. Cuando conectes tus cuentas, las ideas serán sobre ti."
        }
      />
      <Panel>
        {ideas.map((idea) => (
          <IdeaRow key={idea.id} idea={idea} dismissible={!preview} />
        ))}
      </Panel>
    </PageBody>
  );
}
