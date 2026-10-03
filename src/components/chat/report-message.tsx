"use client";

import { Check, Flag } from "lucide-react";
import { useId, useState, type FormEvent } from "react";
import { Dialog } from "@/components/dialog";
import { buttonClass } from "@/components/ui";
import { apiFetch, errorMessage } from "@/lib/api-client";
import { cn } from "@/lib/cn";

const REASONS = [
  { id: "offensive", label: "Ofensiva o de odio" },
  { id: "dangerous", label: "Peligrosa o ilegal" },
  { id: "sexual", label: "Contenido sexual" },
  { id: "wrong", label: "Incorrecta o engañosa" },
  { id: "privacy", label: "Expone datos personales" },
  { id: "other", label: "Otro motivo" },
] as const;

type ReasonId = (typeof REASONS)[number]["id"];

/**
 * "Reportar" bajo cada respuesta de Omni. Google Play exige que el contenido generado con IA se pueda reportar sin
 * salir de la app; el reporte llega al desarrollador (tabla content_reports).
 */
export function ReportMessage({ messageId, demo = false }: { messageId: string; demo?: boolean }) {
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState(false);

  if (sent) {
    return (
      <p className="flex items-center gap-1.5 px-1 text-xs text-muted" role="status">
        <Check className="size-3.5 text-primary" aria-hidden />
        Gracias. Revisaremos esta respuesta.
      </p>
    );
  }
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 rounded-full px-1 py-0.5 text-xs text-muted transition-colors hover:text-ink"
      >
        <Flag className="size-3.5" aria-hidden />
        Reportar
      </button>
      {open ? (
        <ReportDialog
          messageId={messageId}
          demo={demo}
          onClose={() => setOpen(false)}
          onSent={() => {
            setOpen(false);
            setSent(true);
          }}
        />
      ) : null}
    </>
  );
}

function ReportDialog({
  messageId,
  demo,
  onClose,
  onSent,
}: {
  messageId: string;
  demo: boolean;
  onClose: () => void;
  onSent: () => void;
}) {
  const baseId = useId();
  const [reason, setReason] = useState<ReasonId | null>(null);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!reason || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (!demo) {
        await apiFetch(`/api/v1/agent/messages/${messageId}/report`, {
          method: "POST",
          body: { reason, comment: comment.trim() || undefined },
        });
      }
      onSent();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog title="Reportar respuesta" onClose={onClose} closable={!busy}>
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <p className="text-sm leading-relaxed text-muted">
          Cuéntanos qué está mal en esta respuesta de Omni. Revisamos cada reporte para mejorar sus filtros.
        </p>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-sm font-semibold text-ink">Motivo</legend>
          {REASONS.map((option) => {
            const id = `${baseId}-${option.id}`;
            const checked = reason === option.id;
            return (
              <label
                key={option.id}
                htmlFor={id}
                className={cn(
                  "flex cursor-pointer items-center gap-3 rounded-2xl border px-3.5 py-3 text-sm transition-colors",
                  checked ? "border-primary bg-primary-soft text-ink" : "border-line bg-surface text-ink hover:bg-surface-2",
                )}
              >
                <input
                  id={id}
                  type="radio"
                  name="reason"
                  value={option.id}
                  checked={checked}
                  onChange={() => setReason(option.id)}
                  className="size-4 shrink-0 accent-primary"
                />
                {option.label}
              </label>
            );
          })}
        </fieldset>
        <div>
          <label htmlFor={`${baseId}-comment`} className="mb-1.5 block text-sm font-semibold text-ink">
            Comentario <span className="font-normal text-muted">(opcional)</span>
          </label>
          <textarea
            id={`${baseId}-comment`}
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            maxLength={1000}
            rows={3}
            className="w-full resize-none rounded-xl border border-line-strong bg-surface px-3 py-2.5 text-sm text-ink placeholder:text-muted focus:border-primary focus:outline-none"
            placeholder="Qué pasó, en pocas palabras"
          />
        </div>
        {error ? (
          <p role="alert" className="rounded-xl bg-danger-soft px-3 py-2.5 text-sm text-danger">
            {error}
          </p>
        ) : null}
        <button type="submit" disabled={!reason || busy} className={cn(buttonClass("primary"), "w-full")}>
          {busy ? "Enviando…" : "Enviar reporte"}
        </button>
      </form>
    </Dialog>
  );
}
