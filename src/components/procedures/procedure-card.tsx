"use client";

import {
  BellRing,
  CalendarCheck,
  CalendarDays,
  Check,
  ChevronDown,
  FileText,
  Flag,
  HandCoins,
  Loader,
  Sparkles,
  Timer,
  Undo2,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { MAIL_CATEGORY_ICON, MAIL_CATEGORY_LABEL, TASK_ICON } from "@/components/icons";
import { AdjustDialog } from "@/components/procedures/adjust-dialog";
import { Chip, IconTile, buttonClass } from "@/components/ui";
import { apiFetch, errorMessage, sleep } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { money, plural } from "@/lib/format";
import { dayText, dueText, momentText, senderText, stateChip } from "@/lib/procedures-copy";
import type { ProcedureView } from "@/types/cards";

export type ProcedureAction = "confirm" | "dismiss" | "restore" | "complete" | "snooze" | "reschedule";
type SnoozePreset = "1h" | "tonight" | "tomorrow";

const SNOOZE_OPTIONS: { preset: SnoozePreset; label: string }[] = [
  { preset: "1h", label: "En 1 hora" },
  { preset: "tonight", label: "Esta noche" },
  { preset: "tomorrow", label: "Mañana" },
];

const OPEN = new Set(["PENDING", "IN_PROGRESS", "WAITING_USER"]);

/** Enlace a la revisión del formulario (o a su pantalla de ejemplo en la vista previa). */
export function formHref(documentId: string, demo: boolean): string {
  return demo ? "/preview?screen=formulario" : `/tramites/formularios/${documentId}`;
}

/** Simulación de las acciones en la vista previa (no llama a la API). */
function demoResult(view: ProcedureView, action: Exclude<ProcedureAction, "reschedule">, preset?: SnoozePreset): ProcedureView {
  const now = new Date();
  switch (action) {
    case "confirm":
      return { ...view, status: "PENDING", confirmedAt: now.toISOString(), calendarSynced: true };
    case "dismiss":
      return { ...view, status: "CANCELED" };
    case "restore":
      return { ...view, status: "SUGGESTED", confirmedAt: null };
    case "complete":
      return { ...view, status: "DONE", completedAt: now.toISOString(), urgent: false, overdue: false, reason: null };
    case "snooze": {
      const minutes = preset === "1h" ? 60 : preset === "tonight" ? 240 : 900;
      return { ...view, remindAt: new Date(now.getTime() + minutes * 60_000).toISOString() };
    }
  }
}

/** Mensaje tras una acción (lo muestra la tarjeta o el tablero de Trámites). */
export function actionMessage(action: ProcedureAction, view: ProcedureView, timeZone: string): string {
  switch (action) {
    case "confirm":
      return view.calendarSynced
        ? `Listo: «${view.title}» quedó en tu calendario con sus avisos.`
        : `Listo: «${view.title}» quedó agendado en OmniAgent con sus avisos.`;
    case "dismiss":
      return `Descartaste «${view.title}».`;
    case "restore":
      return `«${view.title}» volvió a tus trámites por confirmar.`;
    case "complete":
      return `¡Hecho! Quité sus recordatorios pendientes.`;
    case "snooze":
      return view.remindAt ? `Te lo recuerdo ${momentText(view.remindAt, timeZone)}.` : "Aviso pospuesto.";
    case "reschedule":
      return view.remindAt ? `Guardé las nuevas fechas: te aviso ${momentText(view.remindAt, timeZone)}.` : "Guardé las nuevas fechas.";
  }
}

function Row({ icon: Icon, label, children, tone }: { icon: LucideIcon; label: string; children: ReactNode; tone?: "danger" }) {
  return (
    <div className="flex items-start gap-2.5">
      <Icon className={cn("mt-0.5 size-4 shrink-0", tone === "danger" ? "text-danger" : "text-muted")} aria-hidden />
      <dt className="w-16 shrink-0 text-muted">{label}</dt>
      <dd className={cn("min-w-0 flex-1", tone === "danger" ? "font-medium text-danger" : "text-ink")}>{children}</dd>
    </div>
  );
}

function SnoozeMenu({ disabled, onPick }: { disabled: boolean; onPick: (preset: SnoozePreset) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={buttonClass("secondary", "sm")}
      >
        Más tarde
        <ChevronDown className="size-3.5" aria-hidden />
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute bottom-full left-0 z-20 mb-2 w-44 overflow-hidden rounded-2xl border border-line bg-surface py-1 shadow-float"
        >
          {SNOOZE_OPTIONS.map((option) => (
            <button
              key={option.preset}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onPick(option.preset);
              }}
              className="block w-full px-4 py-2.5 text-left text-sm text-ink transition-colors hover:bg-surface-2"
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Tarjeta de un trámite: qué pide, cuándo vence, cuándo te propone hacerlo (y por qué), sus documentos
 * y las acciones. En un trámite sugerido, "Confirmar" lo agenda con un toque.
 */
export function ProcedureCard({
  procedure,
  timeZone,
  demo = false,
  compact = false,
  onUpdated,
  className,
}: {
  procedure: ProcedureView;
  timeZone: string;
  demo?: boolean;
  /** En el chat: sin resumen ni pasos. */
  compact?: boolean;
  /** Si lo recibe (tablero de Trámites), el aviso de la acción lo muestra el padre. */
  onUpdated?: (view: ProcedureView, action: ProcedureAction) => void;
  className?: string;
}) {
  const [view, setView] = useState(procedure);
  const [busy, setBusy] = useState<ProcedureAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [adjust, setAdjust] = useState<"confirm" | "reschedule" | null>(null);

  useEffect(() => setView(procedure), [procedure]);

  const now = new Date();
  const open = OPEN.has(view.status);
  const suggested = view.status === "SUGGESTED";
  const Icon = view.category ? MAIL_CATEGORY_ICON[view.category] : (TASK_ICON[view.type] ?? FileText);
  const label = view.category ? MAIL_CATEGORY_LABEL[view.category] : "Trámite";
  const sender = senderText(view);
  const chip = stateChip(view, now);
  const due = dueText(view, timeZone, now);
  const isEvent = view.event && (view.category === "APPOINTMENT" || view.category === "EVENT" || view.type === "APPOINTMENT");
  const showRemind = view.remindAt && view.remindAt !== view.plannedAt && (suggested || open);

  function finish(next: ProcedureView, action: ProcedureAction) {
    setView(next);
    if (onUpdated) onUpdated(next, action);
    else setNotice(actionMessage(action, next, timeZone));
  }

  async function act(action: Exclude<ProcedureAction, "reschedule">, preset?: SnoozePreset) {
    setBusy(action);
    setError(null);
    setNotice(null);
    try {
      let next: ProcedureView;
      if (demo) {
        await sleep(500);
        next = demoResult(view, action, preset);
      } else {
        next = await apiFetch<ProcedureView>(`/api/v1/procedures/${view.taskId}/${action}`, {
          method: "POST",
          body: action === "snooze" ? { preset } : {},
        });
      }
      finish(next, action);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <article
      className={cn(
        "w-full min-w-0 rounded-2xl border bg-surface",
        view.overdue ? "border-danger/40" : "border-line",
        view.status === "CANCELED" || view.status === "DONE" ? "opacity-80" : null,
        className,
      )}
    >
      <div className="flex items-start gap-3 px-4 pt-4">
        <IconTile icon={Icon} tone={view.overdue || view.urgent ? "attention" : open || suggested ? "primary" : "neutral"} />
        <div className="min-w-0 flex-1">
          <p className="flex min-w-0 items-center gap-1.5 text-xs text-muted">
            <span className="shrink-0">{label}</span>
            {sender ? (
              <>
                <span aria-hidden>·</span>
                <span className="truncate">{sender}</span>
              </>
            ) : null}
          </p>
          <h3 className="mt-0.5 text-[15px] font-semibold leading-snug text-ink">{view.title}</h3>
        </div>
        {chip ? <Chip tone={chip.tone}>{chip.label}</Chip> : null}
      </div>

      {view.summary && !compact ? <p className="px-4 pt-2 text-sm leading-relaxed text-muted">{view.summary}</p> : null}

      <dl className="mx-4 mt-3 space-y-1.5 rounded-xl bg-surface-2 px-3 py-2.5 text-sm">
        {view.event ? (
          <Row icon={CalendarDays} label={isEvent && view.category !== "EVENT" ? "Cita" : "Evento"}>
            {momentText(view.event.startsAt, timeZone, now, !view.event.allDay)}
            {view.event.location ? <span className="block text-xs text-muted">{view.event.location}</span> : null}
            {!isEvent && view.event.title !== view.title ? <span className="block text-xs text-muted">{view.event.title}</span> : null}
          </Row>
        ) : null}
        {due ? (
          <Row icon={Flag} label="Vence" tone={view.overdue && open ? "danger" : undefined}>
            {due}
          </Row>
        ) : null}
        {view.amount !== null ? (
          <Row icon={HandCoins} label="Monto">
            {money(view.amount, view.currency, { cents: true })}
            {view.reference ? <span className="text-muted"> · {view.reference}</span> : null}
          </Row>
        ) : null}
        {view.plannedAt && (suggested || open) ? (
          <Row icon={Timer} label="Hacerlo">
            {momentText(view.plannedAt, timeZone, now)}
          </Row>
        ) : null}
        {showRemind && view.remindAt ? (
          <Row icon={BellRing} label="Aviso">
            {momentText(view.remindAt, timeZone, now)}
          </Row>
        ) : null}
        {view.status === "DONE" && view.completedAt ? (
          <Row icon={Check} label="Hecho">
            {dayText(view.completedAt, timeZone, now)}
          </Row>
        ) : null}
      </dl>

      {view.reason && (suggested || open) ? (
        <p className="mx-4 mt-2 flex items-start gap-1.5 text-xs leading-relaxed text-muted">
          <Sparkles className="mt-px size-3.5 shrink-0 text-primary" aria-hidden />
          {view.reason}
        </p>
      ) : null}

      {view.documents.length > 0 ? (
        <ul className="mx-4 mt-3 space-y-2">
          {view.documents.map((doc) => (
            <li key={doc.id} className="flex items-center gap-3 rounded-xl border border-line px-3 py-2.5">
              <FileText className="size-4 shrink-0 text-muted" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-ink">{doc.filledFileName ?? doc.fileName}</p>
                <p className="text-xs text-muted">
                  {doc.filledDocumentId
                    ? "Lleno y listo para enviar"
                    : doc.missingCount === null
                      ? "Omni aún no lo lee"
                      : doc.missingCount === 0
                        ? "Todo lleno: solo revisa y firma"
                        : `Omni lo prellenó · ${plural(doc.missingCount, "campo", "campos")} por completar`}
                </p>
              </div>
              <Link href={formHref(doc.id, demo)} className={cn(buttonClass(doc.filledDocumentId ? "ghost" : "secondary", "sm"), "shrink-0")}>
                {doc.filledDocumentId ? "Ver" : "Revisar"}
              </Link>
            </li>
          ))}
        </ul>
      ) : null}

      {!compact && view.steps.length > 0 && (suggested || open) ? (
        <details className="group mx-4 mt-3 text-sm">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs font-semibold text-muted hover:text-ink">
            <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" aria-hidden />
            {plural(view.steps.length, "paso", "pasos")}
          </summary>
          <ol className="mt-2 space-y-1.5 pl-1">
            {view.steps.map((step, index) => (
              <li key={step} className="flex gap-2 text-sm leading-relaxed text-ink">
                <span className="grid size-5 shrink-0 place-items-center rounded-full bg-surface-2 text-[11px] font-semibold text-muted">
                  {index + 1}
                </span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
        </details>
      ) : null}

      {error ? (
        <p role="alert" className="mx-4 mt-3 rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="mx-4 mt-3 rounded-xl bg-primary-soft px-3 py-2 text-sm text-primary">
          {notice}
        </p>
      ) : null}

      <footer className="mt-4 flex flex-wrap items-center gap-2 border-t border-line px-4 py-3">
        {suggested ? (
          <>
            <button type="button" onClick={() => act("confirm")} disabled={busy !== null} className={buttonClass("primary", "sm")}>
              {busy === "confirm" ? <Loader className="size-4 animate-spin" aria-hidden /> : <CalendarCheck className="size-4" aria-hidden />}
              {busy === "confirm" ? "Agendando…" : "Confirmar"}
            </button>
            <button type="button" onClick={() => setAdjust("confirm")} disabled={busy !== null} className={buttonClass("secondary", "sm")}>
              Ajustar
            </button>
            <button type="button" onClick={() => act("dismiss")} disabled={busy !== null} className={buttonClass("ghost", "sm")}>
              {busy === "dismiss" ? "Descartando…" : "Descartar"}
            </button>
          </>
        ) : open ? (
          <>
            <button type="button" onClick={() => act("complete")} disabled={busy !== null} className={buttonClass("primary", "sm")}>
              {busy === "complete" ? <Loader className="size-4 animate-spin" aria-hidden /> : <Check className="size-4" aria-hidden />}
              Hecho
            </button>
            <SnoozeMenu disabled={busy !== null} onPick={(preset) => act("snooze", preset)} />
            <button type="button" onClick={() => setAdjust("reschedule")} disabled={busy !== null} className={buttonClass("ghost", "sm")}>
              Cambiar fechas
            </button>
          </>
        ) : view.status === "CANCELED" ? (
          <button type="button" onClick={() => act("restore")} disabled={busy !== null} className={buttonClass("ghost", "sm")}>
            <Undo2 className="size-4" aria-hidden />
            {busy === "restore" ? "Restaurando…" : "Deshacer"}
          </button>
        ) : (
          <p className="text-xs text-muted">Terminado{view.completedAt ? ` ${dayText(view.completedAt, timeZone, now)}` : ""}.</p>
        )}
        {open && view.calendarSynced ? (
          <span className="ml-auto inline-flex items-center gap-1 text-xs text-muted">
            <CalendarCheck className="size-3.5 text-primary" aria-hidden />
            En tu calendario
          </span>
        ) : null}
      </footer>

      {adjust ? (
        <AdjustDialog
          procedure={view}
          mode={adjust}
          timeZone={timeZone}
          demo={demo}
          onClose={() => setAdjust(null)}
          onSaved={(next) => {
            setAdjust(null);
            finish(next, adjust === "confirm" ? "confirm" : "reschedule");
          }}
        />
      ) : null}
    </article>
  );
}
