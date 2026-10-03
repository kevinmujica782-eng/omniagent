import { CalendarCheck, CalendarPlus } from "lucide-react";
import { AGENDA_ICON } from "@/components/icons";
import { cn } from "@/lib/cn";
import { dayHeading, timeText } from "@/lib/procedures-copy";
import { localDateKey } from "@/modules/procedures/time/tz";
import type { AgendaItemView } from "@/types/cards";

const KIND_NOTE: Record<AgendaItemView["kind"], string | null> = {
  EVENT: null,
  FOCUS: "Para hacerlo",
  DEADLINE: "Fecha límite",
  DUE: "Fecha límite",
  BUSY: "Tu calendario",
};

/** Agenda agrupada por día (hora local): citas, bloques para hacer trámites, fechas límite y lo ocupado. */
export function AgendaList({
  items,
  timeZone,
  demo = false,
  compact = false,
  emptyText = "Nada agendado en estos días.",
}: {
  items: AgendaItemView[];
  timeZone: string;
  demo?: boolean;
  /** En el chat: sin enlaces para añadir al calendario. */
  compact?: boolean;
  emptyText?: string;
}) {
  if (items.length === 0) {
    return <p className="rounded-2xl border border-dashed border-line-strong px-4 py-5 text-sm text-muted">{emptyText}</p>;
  }
  const now = new Date();
  const groups: { key: string; date: string; items: AgendaItemView[] }[] = [];
  for (const item of items) {
    const key = localDateKey(new Date(item.startsAt), timeZone);
    const group = groups.at(-1);
    if (group?.key === key) group.items.push(item);
    else groups.push({ key, date: item.startsAt, items: [item] });
  }

  return (
    <div className="space-y-3">
      {groups.map((group) => (
        <div key={group.key}>
          <p className="px-1 pb-1.5 text-xs font-semibold text-muted">{dayHeading(group.date, timeZone, now)}</p>
          <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
            {group.items.map((item) => {
              const Icon = AGENDA_ICON[item.kind];
              const busy = item.kind === "BUSY";
              const own = item.kind === "EVENT" || item.kind === "FOCUS" || item.kind === "DEADLINE";
              const note = KIND_NOTE[item.kind];
              return (
                <li key={item.id} className={cn("flex items-start gap-3 px-4 py-3", busy ? "bg-surface-2" : null)}>
                  <span className="w-[4.5rem] shrink-0 pt-0.5 text-xs tabular-nums text-muted">
                    {item.allDay ? "Todo el día" : timeText(item.startsAt, timeZone)}
                  </span>
                  <Icon
                    className={cn(
                      "mt-0.5 size-4 shrink-0",
                      busy ? "text-muted" : item.kind === "DEADLINE" || item.kind === "DUE" ? "text-attention" : "text-primary",
                    )}
                    aria-hidden
                  />
                  <div className="min-w-0 flex-1">
                    <p className={cn("text-sm leading-snug", busy ? "text-muted" : "font-medium text-ink")}>{item.title}</p>
                    {note || item.location ? (
                      <p className="text-xs text-muted">{[note, item.location].filter(Boolean).join(" · ")}</p>
                    ) : null}
                  </div>
                  {own && !compact ? (
                    <span className="flex shrink-0 items-center gap-1">
                      {item.synced ? <CalendarCheck className="size-4 text-primary" role="img" aria-label="En tu calendario" /> : null}
                      {demo ? null : (
                        <a
                          href={`/api/v1/procedures/calendar/events/${item.id}/ics`}
                          className="grid size-8 place-items-center rounded-full text-muted transition-colors hover:bg-surface-2 hover:text-ink"
                          aria-label={`Añadir «${item.title}» a mi calendario`}
                          title="Añadir a mi calendario (.ics)"
                        >
                          <CalendarPlus className="size-4" aria-hidden />
                        </a>
                      )}
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}
