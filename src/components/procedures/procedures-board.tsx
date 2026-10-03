"use client";

import { CalendarCheck, CircleCheck, Inbox, Undo2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { actionMessage, ProcedureCard, type ProcedureAction } from "@/components/procedures/procedure-card";
import { Chip, Section } from "@/components/ui";
import { apiFetch, errorMessage, sleep } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { plural } from "@/lib/format";
import { reminderDue } from "@/lib/procedures-copy";
import type { ProcedureView } from "@/types/cards";

type Lists = { suggested: ProcedureView[]; active: ProcedureView[]; done: ProcedureView[] };
type Toast = { text: string; undo: ProcedureView | null };

const OPEN = new Set(["PENDING", "IN_PROGRESS", "WAITING_USER"]);

/** Mueve el trámite a la lista que corresponde a su nuevo estado. */
function place(lists: Lists, view: ProcedureView): Lists {
  const without = (list: ProcedureView[]) => list.filter((item) => item.taskId !== view.taskId);
  const next: Lists = { suggested: without(lists.suggested), active: without(lists.active), done: without(lists.done) };
  if (view.status === "SUGGESTED") next.suggested = [view, ...next.suggested];
  else if (OPEN.has(view.status)) next.active = [view, ...next.active];
  else if (view.status === "DONE") next.done = [view, ...next.done].slice(0, 5);
  return next;
}

/**
 * Tablero de Trámites: por confirmar (con el toque de "Confirmar"), en curso y terminados.
 * Las acciones mueven la tarjeta de lista al instante y refrescan la página (agenda y contadores).
 */
export function ProceduresBoard({
  suggested,
  active,
  done,
  timeZone,
  demo = false,
}: Lists & { timeZone: string; demo?: boolean }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [lists, setLists] = useState<Lists>({ suggested, active, done });
  const [toast, setToast] = useState<Toast | null>(null);
  const [confirmingAll, setConfirmingAll] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);

  // Datos nuevos del servidor (después de router.refresh()) mandan.
  useEffect(() => setLists({ suggested, active, done }), [suggested, active, done]);

  function refresh() {
    if (!demo) startTransition(() => router.refresh());
  }

  function onUpdated(view: ProcedureView, action: ProcedureAction) {
    setLists((prev) => place(prev, view));
    setToast({ text: actionMessage(action, view, timeZone), undo: action === "dismiss" ? view : null });
    refresh();
  }

  async function undo(view: ProcedureView) {
    setToast(null);
    try {
      const restored = demo
        ? { ...view, status: "SUGGESTED" as const }
        : await apiFetch<ProcedureView>(`/api/v1/procedures/${view.taskId}/restore`, { method: "POST" });
      setLists((prev) => place(prev, restored));
      refresh();
    } catch (err) {
      setToast({ text: errorMessage(err), undo: null });
    }
  }

  /** Confirma todas las sugerencias con sus fechas propuestas. */
  async function confirmAll() {
    setConfirmingAll(true);
    setBulkError(null);
    const pending = [...lists.suggested];
    let confirmed = 0;
    for (const item of pending) {
      try {
        const next = demo
          ? (await sleep(250), { ...item, status: "PENDING" as const, calendarSynced: true, confirmedAt: new Date().toISOString() })
          : await apiFetch<ProcedureView>(`/api/v1/procedures/${item.taskId}/confirm`, { method: "POST" });
        confirmed += 1;
        setLists((prev) => place(prev, next));
      } catch (err) {
        setBulkError(errorMessage(err));
        break;
      }
    }
    setConfirmingAll(false);
    if (confirmed > 0) setToast({ text: `Listo: agendé ${plural(confirmed, "trámite", "trámites")} con sus avisos.`, undo: null });
    refresh();
  }

  const { suggested: pending, done: finished } = lists;
  // Lo que ya toca (su aviso llegó) va primero.
  const now = new Date();
  const current = [...lists.active].sort((a, b) => Number(reminderDue(b, now)) - Number(reminderDue(a, now)));
  const empty = pending.length === 0 && current.length === 0;

  return (
    <div>
      {toast ? (
        <div
          role="status"
          className="sticky top-2 z-30 mb-4 flex items-center gap-3 rounded-2xl bg-ink px-4 py-3 text-sm text-canvas shadow-float"
        >
          <CircleCheck className="size-4 shrink-0" aria-hidden />
          <p className="min-w-0 flex-1 leading-snug">{toast.text}</p>
          {toast.undo ? (
            <button
              type="button"
              onClick={() => toast.undo && undo(toast.undo)}
              className="inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-1 font-semibold underline-offset-2 hover:underline"
            >
              <Undo2 className="size-4" aria-hidden />
              Deshacer
            </button>
          ) : null}
          <button type="button" onClick={() => setToast(null)} aria-label="Cerrar aviso" className="shrink-0 rounded-full p-1 opacity-80 hover:opacity-100">
            <X className="size-4" aria-hidden />
          </button>
        </div>
      ) : null}

      {pending.length > 0 ? (
        <Section
          title={
            <>
              Por confirmar <Chip tone="attention">{pending.length}</Chip>
            </>
          }
          action={
            pending.length > 1 ? (
              <button
                type="button"
                onClick={confirmAll}
                disabled={confirmingAll}
                className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary underline-offset-2 hover:underline disabled:opacity-50"
              >
                <CalendarCheck className="size-4" aria-hidden />
                {confirmingAll ? "Agendando…" : "Confirmar todos"}
              </button>
            ) : null
          }
        >
          <p className="-mt-1 mb-3 px-1 text-sm text-muted">
            Te propongo fechas que no chocan con tu calendario. Un toque en <span className="font-semibold text-ink">Confirmar</span> y
            queda agendado con sus avisos.
          </p>
          {bulkError ? (
            <p role="alert" className="mb-3 rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">
              {bulkError}
            </p>
          ) : null}
          <div className="grid grid-cols-1 items-start gap-3 md:grid-cols-2">
            {pending.map((item) => (
              <ProcedureCard key={`${item.taskId}-${item.status}`} procedure={item} timeZone={timeZone} demo={demo} onUpdated={onUpdated} />
            ))}
          </div>
        </Section>
      ) : null}

      <Section title="En curso" className={cn(pending.length > 0 ? "mt-10" : null)}>
        {current.length > 0 ? (
          <div className="grid grid-cols-1 items-start gap-3 md:grid-cols-2">
            {current.map((item) => (
              <ProcedureCard key={`${item.taskId}-${item.status}`} procedure={item} timeZone={timeZone} demo={demo} onUpdated={onUpdated} />
            ))}
          </div>
        ) : (
          <p className="flex items-center gap-2 rounded-2xl border border-dashed border-line-strong px-4 py-5 text-sm text-muted">
            <Inbox className="size-4 shrink-0" aria-hidden />
            {empty ? "No tienes trámites pendientes. Omni revisa tu correo y te avisa cuando llegue uno." : "Nada en curso: confirma un trámite para verlo aquí."}
          </p>
        )}
      </Section>

      {finished.length > 0 ? (
        <details className="group mt-8">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-1 text-sm font-semibold text-ink">
            Terminados recientemente <Chip>{finished.length}</Chip>
            <span className="ml-auto text-xs font-normal text-muted group-open:hidden">Ver</span>
          </summary>
          <div className="mt-3 grid grid-cols-1 items-start gap-3 md:grid-cols-2">
            {finished.map((item) => (
              <ProcedureCard key={`${item.taskId}-${item.status}`} procedure={item} timeZone={timeZone} demo={demo} compact onUpdated={onUpdated} />
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}
