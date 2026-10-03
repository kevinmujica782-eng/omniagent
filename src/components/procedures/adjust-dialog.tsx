"use client";

import { Loader, Sparkles } from "lucide-react";
import { useState, type ChangeEvent } from "react";
import { Dialog } from "@/components/dialog";
import { INPUT_CLASS, buttonClass } from "@/components/ui";
import { apiFetch, errorMessage, sleep } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { momentText } from "@/lib/procedures-copy";
import { parseLocalDateTime, toLocalInput } from "@/modules/procedures/time/tz";
import type { ProcedureView } from "@/types/cards";

/**
 * Ajustar las fechas que propuso Omni: fecha límite, cuándo hacerlo y cuándo avisar.
 * - mode "confirm": trámite sugerido; guarda y confirma de una vez.
 * - mode "reschedule": trámite activo; cambia el calendario.
 * "Que Omni proponga otra fecha" recalcula con el calendario actual sin cerrar el diálogo.
 */
export function AdjustDialog({
  procedure,
  mode,
  timeZone,
  demo = false,
  onClose,
  onSaved,
}: {
  procedure: ProcedureView;
  mode: "confirm" | "reschedule";
  timeZone: string;
  demo?: boolean;
  onClose: () => void;
  onSaved: (view: ProcedureView) => void;
}) {
  const local = (iso: string | null) => (iso ? toLocalInput(new Date(iso), timeZone) : "");
  const [base, setBase] = useState(procedure);
  const baseDue = base.dueAt ? (base.dueHasTime ? local(base.dueAt) : local(base.dueAt).slice(0, 10)) : "";

  const [dueDate, setDueDate] = useState(baseDue.slice(0, 10));
  const [dueTime, setDueTime] = useState(baseDue.length > 10 ? baseDue.slice(11) : "");
  const [planned, setPlanned] = useState(local(base.plannedAt));
  const [remind, setRemind] = useState(local(base.remindAt));
  const [busy, setBusy] = useState<"save" | "suggest" | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Citas y eventos: la fecha la pone el evento; solo se ajusta el aviso.
  const eventOnly = Boolean(base.event) && !base.dueAt && !base.plannedAt && (base.category === "APPOINTMENT" || base.category === "EVENT" || base.type === "APPOINTMENT");
  const dueValue = dueDate ? (dueTime ? `${dueDate}T${dueTime}` : dueDate) : null;

  function changes(): Record<string, string | null> {
    const body: Record<string, string | null> = {};
    if (dueValue !== (baseDue || null)) body.due = dueValue;
    if (planned !== local(base.plannedAt)) body.plannedAt = planned || null;
    if (remind !== local(base.remindAt)) body.remindAt = remind || null;
    return body;
  }

  /** En la vista previa: aplica los cambios localmente. */
  function demoApply(body: Record<string, string | null>, status: ProcedureView["status"]): ProcedureView {
    const toIso = (value: string | null | undefined) => {
      if (!value) return null;
      const parsed = parseLocalDateTime(value, timeZone);
      return parsed ? parsed.date.toISOString() : null;
    };
    return {
      ...base,
      status,
      calendarSynced: status !== "SUGGESTED" || base.calendarSynced,
      confirmedAt: status === "SUGGESTED" ? null : (base.confirmedAt ?? new Date().toISOString()),
      dueAt: "due" in body ? toIso(body.due) : base.dueAt,
      dueHasTime: "due" in body ? Boolean(body.due && body.due.length > 10) : base.dueHasTime,
      plannedAt: "plannedAt" in body ? toIso(body.plannedAt) : base.plannedAt,
      remindAt: "remindAt" in body ? toIso(body.remindAt) : base.remindAt,
      reason: "plannedAt" in body && body.plannedAt ? `Elegiste hacerlo ${momentText(toIso(body.plannedAt)!, timeZone)}.` : base.reason,
    };
  }

  async function save() {
    setBusy("save");
    setError(null);
    try {
      const body = changes();
      let next: ProcedureView;
      if (demo) {
        await sleep(500);
        next = demoApply(body, mode === "confirm" ? "PENDING" : base.status);
      } else if (mode === "confirm") {
        next = await apiFetch<ProcedureView>(`/api/v1/procedures/${base.taskId}/confirm`, { method: "POST", body });
      } else {
        next = await apiFetch<ProcedureView>(`/api/v1/procedures/${base.taskId}`, { method: "PATCH", body });
      }
      onSaved(next);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function suggestAgain() {
    setBusy("suggest");
    setError(null);
    try {
      const body: Record<string, unknown> = { recompute: true };
      if (dueValue !== (baseDue || null)) body.due = dueValue;
      let next: ProcedureView;
      if (demo) {
        await sleep(500);
        next = base;
      } else {
        next = await apiFetch<ProcedureView>(`/api/v1/procedures/${base.taskId}`, { method: "PATCH", body });
      }
      setBase(next);
      setPlanned(local(next.plannedAt));
      setRemind(local(next.remindAt));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  const title = mode === "confirm" ? "Ajustar y confirmar" : "Cambiar fechas";
  return (
    <Dialog title={title} onClose={onClose} closable={busy === null}>
      <p className="text-[15px] font-semibold leading-snug text-ink">{base.title}</p>
      {base.event ? (
        <p className="mt-1 text-sm text-muted">
          {base.event.title}: {momentText(base.event.startsAt, timeZone, new Date(), !base.event.allDay)}
        </p>
      ) : null}

      <div className="mt-5 space-y-4">
        {!eventOnly ? (
          <fieldset>
            <legend className="text-sm font-medium text-ink">Fecha límite</legend>
            <div className="mt-1.5 grid grid-cols-[1fr_8rem] gap-2">
              <input
                type="date"
                value={dueDate}
                onChange={(event: ChangeEvent<HTMLInputElement>) => setDueDate(event.target.value)}
                aria-label="Día límite"
                className={INPUT_CLASS}
              />
              <input
                type="time"
                value={dueTime}
                onChange={(event: ChangeEvent<HTMLInputElement>) => setDueTime(event.target.value)}
                aria-label="Hora límite (opcional)"
                disabled={!dueDate}
                className={INPUT_CLASS}
              />
            </div>
            <p className="mt-1 text-xs text-muted">Sin hora, vence al final del día.</p>
          </fieldset>
        ) : null}

        {!eventOnly ? (
          <label className="block">
            <span className="text-sm font-medium text-ink">Hacerlo el</span>
            <input
              type="datetime-local"
              value={planned}
              onChange={(event: ChangeEvent<HTMLInputElement>) => setPlanned(event.target.value)}
              className={cn(INPUT_CLASS, "mt-1.5")}
            />
            <span className="mt-1 block text-xs text-muted">Reservo ese rato en tu calendario.</span>
          </label>
        ) : null}

        <label className="block">
          <span className="text-sm font-medium text-ink">Recordarme</span>
          <input
            type="datetime-local"
            value={remind}
            onChange={(event: ChangeEvent<HTMLInputElement>) => setRemind(event.target.value)}
            className={cn(INPUT_CLASS, "mt-1.5")}
          />
        </label>
      </div>

      {base.reason ? (
        <p className="mt-4 flex items-start gap-1.5 rounded-xl bg-surface-2 px-3 py-2 text-xs leading-relaxed text-muted">
          <Sparkles className="mt-px size-3.5 shrink-0 text-primary" aria-hidden />
          {base.reason}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-4 rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      ) : null}

      <div className="mt-6 flex flex-col gap-2">
        <button type="button" onClick={save} disabled={busy !== null} className={cn(buttonClass("primary", "lg"), "w-full")}>
          {busy === "save" ? <Loader className="size-4 animate-spin" aria-hidden /> : null}
          {mode === "confirm" ? "Confirmar con estas fechas" : "Guardar cambios"}
        </button>
        {!eventOnly ? (
          <button type="button" onClick={suggestAgain} disabled={busy !== null} className={cn(buttonClass("ghost", "sm"), "mx-auto")}>
            {busy === "suggest" ? <Loader className="size-4 animate-spin" aria-hidden /> : <Sparkles className="size-4" aria-hidden />}
            Que Omni proponga otra fecha
          </button>
        ) : null}
      </div>
    </Dialog>
  );
}
