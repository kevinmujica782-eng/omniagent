import { Download, FileText, Inbox, Sparkles } from "lucide-react";
import Link from "next/link";
import { AgendaList } from "@/components/procedures/agenda-list";
import { formHref, ProcedureCard } from "@/components/procedures/procedure-card";
import { Chip, IconTile, Progress, buttonClass } from "@/components/ui";
import { cn } from "@/lib/cn";
import { plural } from "@/lib/format";
import { dayText } from "@/lib/procedures-copy";
import type { AgendaCard, FormCard, InboxDigestCard, ProceduresCard } from "@/types/cards";

// Tarjetas del módulo de trámites en el chat. Los trámites se confirman ahí mismo con un toque.

const MAX_IN_CHAT = 4;

function MoreLink({ count, demo }: { count: number; demo: boolean }) {
  if (count <= 0) return null;
  return (
    <Link
      href={demo ? "/preview?screen=tramites" : "/tramites"}
      className="px-1 text-sm font-semibold text-primary underline-offset-2 hover:underline"
    >
      Ver {plural(count, "trámite más", "trámites más")} en Trámites
    </Link>
  );
}

export function InboxDigestView({ card, timeZone, demo = false }: { card: InboxDigestCard; timeZone: string; demo?: boolean }) {
  const shown = card.items.slice(0, MAX_IN_CHAT);
  return (
    <div className="flex w-full max-w-md flex-col gap-2.5">
      <div className="flex items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-3">
        <IconTile icon={Inbox} size="sm" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-ink">
            {card.scanned > 0 ? `Revisé ${plural(card.scanned, "correo nuevo", "correos nuevos")}` : "Sin correos nuevos"}
          </p>
          <p className="text-xs text-muted">
            {card.items.length > 0 ? `${plural(card.items.length, "trámite", "trámites")} por confirmar` : "Nada pendiente por confirmar"}
          </p>
        </div>
        {card.source === "AI" ? (
          <Chip tone="good">
            <Sparkles className="size-3" aria-hidden />
            IA
          </Chip>
        ) : null}
      </div>
      {shown.map((item) => (
        <ProcedureCard key={`${item.taskId}-${item.status}`} procedure={item} timeZone={timeZone} demo={demo} compact />
      ))}
      <MoreLink count={card.items.length - shown.length} demo={demo} />
    </div>
  );
}

export function ProceduresListView({ card, timeZone, demo = false }: { card: ProceduresCard; timeZone: string; demo?: boolean }) {
  const shown = card.items.slice(0, MAX_IN_CHAT);
  return (
    <div className="flex w-full max-w-md flex-col gap-2.5">
      {card.items.length > 1 ? <p className="px-1 text-xs font-semibold text-muted">{card.title}</p> : null}
      {shown.map((item) => (
        <ProcedureCard key={`${item.taskId}-${item.status}`} procedure={item} timeZone={timeZone} demo={demo} compact />
      ))}
      <MoreLink count={card.items.length - shown.length} demo={demo} />
    </div>
  );
}

export function FormCardView({ card, timeZone, demo = false }: { card: FormCard; timeZone: string; demo?: boolean }) {
  return (
    <section className="w-full max-w-md rounded-2xl border border-line bg-surface p-4">
      <div className="flex items-start gap-3">
        <IconTile icon={FileText} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs text-muted">{card.fileName}</p>
          <p className="mt-0.5 text-[15px] font-semibold leading-snug text-ink">{card.title}</p>
          {card.dueAt ? (
            <p className="mt-1.5">
              <Chip tone="attention">Vence {dayText(card.dueAt, timeZone)}</Chip>
            </p>
          ) : null}
        </div>
      </div>
      {card.summary ? <p className="mt-2 text-sm leading-relaxed text-muted">{card.summary}</p> : null}
      <div className="mt-3">
        <div className="mb-1.5 flex items-baseline justify-between text-sm">
          <span className="text-ink">
            <span className="font-semibold tabular-nums">{card.filledFields}</span> de {plural(card.totalFields, "campo listo", "campos listos")}
          </span>
          {card.requiresSignature ? <span className="text-xs text-muted">Falta tu firma</span> : null}
        </div>
        <Progress value={card.filledFields} max={Math.max(1, card.totalFields)} label="Campos listos" />
      </div>
      {card.missingFields.length > 0 ? (
        <div className="mt-3">
          <p className="text-xs text-muted">Por completar:</p>
          <ul className="mt-1.5 flex flex-wrap gap-1.5">
            {card.missingFields.map((field) => (
              <li
                key={field}
                title={field}
                className="max-w-full truncate rounded-full border border-line bg-surface-2 px-2 py-0.5 text-xs font-medium text-muted"
              >
                {field}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="mt-4 flex flex-wrap gap-2">
        <Link href={formHref(card.documentId, demo)} className={buttonClass(card.filledDocumentId ? "secondary" : "primary", "sm")}>
          {card.filledDocumentId ? "Revisar" : "Revisar y llenar"}
        </Link>
        {card.filledDocumentId && !demo ? (
          <a href={`/api/v1/procedures/documents/${card.filledDocumentId}/file`} className={cn(buttonClass("primary", "sm"))}>
            <Download className="size-4" aria-hidden />
            PDF lleno
          </a>
        ) : null}
      </div>
    </section>
  );
}

export function AgendaCardView({ card, timeZone, demo = false }: { card: AgendaCard; timeZone: string; demo?: boolean }) {
  return (
    <section className="w-full max-w-md">
      <p className="px-1 pb-2 text-sm font-semibold text-ink">{card.title}</p>
      <AgendaList items={card.items} timeZone={timeZone} demo={demo} compact emptyText="Nada agendado en estos días." />
    </section>
  );
}
