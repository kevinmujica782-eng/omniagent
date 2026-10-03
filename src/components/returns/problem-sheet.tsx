"use client";

import { CircleAlert, Loader, Mail, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type ChangeEvent, type ReactNode } from "react";
import { Dialog } from "@/components/dialog";
import { demoCaseFor } from "@/components/preview/demo-returns";
import { CaseCard } from "@/components/returns/case-card";
import { INPUT_CLASS, buttonClass, type ButtonSize, type ButtonVariant } from "@/components/ui";
import { apiFetch, errorMessage } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { OUTCOME_LABEL, REASON_HINT, REASON_LABEL, deliveryLine, desiredOptions, reasonsFor } from "@/lib/returns-copy";
import type { ApprovalCard, ReturnCaseView, ReturnOutcomeId, ReturnReasonId, TrackedOrderView } from "@/types/cards";

// "¿Qué pasó con tu pedido?": el motivo, lo que pides y (opcional) tus palabras. Omni redacta el reclamo; si la tienda
// atiende por correo y tienes la bandeja conectada, queda listo para aprobar ahí mismo. Nada sale sin tu aprobación.

type Prepared = { returnCase: ReturnCaseView; approval: ApprovalCard | null; existing: boolean };

function channelNote(order: TrackedOrderView, mailboxConnected: boolean): { icon: typeof Mail; text: string } {
  if (order.supportEmail && mailboxConnected) {
    return { icon: ShieldCheck, text: `Omni prepara el correo para ${order.supportEmail}. Lo revisas y lo apruebas antes de que salga.` };
  }
  if (order.supportEmail) {
    return { icon: Mail, text: "Conecta tu correo en Trámites para que Omni lo envíe por ti. Mientras, te deja el mensaje listo." };
  }
  return { icon: Mail, text: `${order.merchant} atiende en su página o su app: Omni te deja el mensaje listo para copiarlo y enviarlo.` };
}

export function ProblemSheet({
  order,
  timeZone,
  mailboxConnected,
  onClose,
  initialReason,
  demo = false,
}: {
  order: TrackedOrderView;
  timeZone: string;
  mailboxConnected: boolean;
  onClose: () => void;
  initialReason?: ReturnReasonId;
  demo?: boolean;
}) {
  const router = useRouter();
  const reasons = reasonsFor(order);
  const [reason, setReason] = useState<ReturnReasonId>(initialReason && reasons.includes(initialReason) ? initialReason : order.likelyLost ? "NOT_RECEIVED" : reasons[0]);
  const [desired, setDesired] = useState<ReturnOutcomeId>(desiredOptions(reason)[0]);
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const note = channelNote(order, mailboxConnected);
  const NoteIcon = note.icon;

  function pickReason(next: ReturnReasonId) {
    setReason(next);
    setDesired(desiredOptions(next)[0]);
  }

  async function submit() {
    setError(null);
    if (demo) {
      // Vista previa: el mismo mensaje que redactaría Omni, sin guardar nada.
      const draft = demoCaseFor(order, { reason, desired, details: details.trim() || null }, mailboxConnected, timeZone);
      setPrepared({ returnCase: draft, approval: draft.approval, existing: false });
      return;
    }
    setBusy(true);
    try {
      const result = await apiFetch<Prepared>(`/api/v1/returns/orders/${order.id}/problem`, {
        method: "POST",
        body: { reason, desired, details: details.trim() || null },
      });
      setPrepared(result);
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (prepared) {
    return (
      // Otra key: el diálogo se monta de nuevo y el resultado se ve desde arriba (no donde quedó el formulario).
      <Dialog key="prepared" title={prepared.existing ? "Ya había un reclamo abierto" : "Reclamo listo"} onClose={onClose}>
        {/* La tarjeta ya dice qué hacer ahora; aquí va solo lo que pasa después. */}
        <p className="mb-3 text-sm leading-relaxed text-muted">
          {prepared.existing
            ? "Este pedido ya tiene un reclamo en curso: sigue desde aquí."
            : prepared.approval?.status === "PENDING"
              ? "Si la tienda no responde en 2 días hábiles, Omni te prepara un seguimiento, que también apruebas tú."
              : "Cuando lo envíes, marca «Ya lo envié»: Omni te pregunta si la tienda respondió y te ayuda a insistir."}
        </p>
        <CaseCard returnCase={prepared.returnCase} timeZone={timeZone} demo={demo} mailboxConnected={mailboxConnected} />
        <button type="button" onClick={onClose} className={cn(buttonClass("ghost"), "mt-4 w-full")}>
          Listo
        </button>
      </Dialog>
    );
  }

  return (
    <Dialog key="form" title="¿Qué pasó con tu pedido?" onClose={onClose} closable={!busy}>
      <p className="text-[15px] font-semibold leading-snug text-ink">{order.title}</p>
      <p className="mt-0.5 text-sm text-muted">
        {[order.merchant, order.orderNumber].filter(Boolean).join(" · ")} · {deliveryLine(order, timeZone)}
      </p>

      <fieldset className="mt-5">
        <legend className="text-sm font-medium text-ink">Qué pasó</legend>
        <div className="mt-2 flex flex-col gap-2">
          {reasons.map((option) => (
            <label
              key={option}
              className={cn(
                "flex cursor-pointer items-start gap-3 rounded-xl border px-3 py-2.5 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary",
                reason === option ? "border-primary bg-primary-soft" : "border-line-strong hover:bg-surface-2",
              )}
            >
              <input type="radio" name="reason" value={option} checked={reason === option} onChange={() => pickReason(option)} className="sr-only" />
              <span
                aria-hidden
                className={cn(
                  "mt-0.5 grid size-4 shrink-0 place-items-center rounded-full border",
                  reason === option ? "border-primary bg-primary" : "border-line-strong bg-surface",
                )}
              >
                {reason === option ? <span className="size-1.5 rounded-full bg-on-primary" /> : null}
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-ink">{REASON_LABEL[option]}</span>
                <span className="block text-xs leading-relaxed text-muted">{REASON_HINT[option]}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="mt-5">
        <legend className="text-sm font-medium text-ink">Qué pides</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {desiredOptions(reason).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={desired === option}
              onClick={() => setDesired(option)}
              className={cn(
                "rounded-full border px-3 py-1.5 text-sm transition-colors",
                desired === option ? "border-primary bg-primary-soft font-semibold text-primary" : "border-line-strong text-ink hover:bg-surface-2",
              )}
            >
              {OUTCOME_LABEL[option]}
            </button>
          ))}
        </div>
      </fieldset>

      <label className="mt-5 block">
        <span className="text-sm font-medium text-ink">Cuéntalo con tus palabras (opcional)</span>
        <textarea
          value={details}
          onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setDetails(event.target.value)}
          rows={3}
          maxLength={600}
          placeholder={reason === "DAMAGED" ? "La tapa llegó rota y no cierra." : reason === "WRONG_ITEM" ? "Pedí talla 40 y llegó 38." : "Lo necesito para el viernes."}
          className={cn(INPUT_CLASS, "mt-1.5 resize-y")}
        />
      </label>

      <p className="mt-4 flex items-start gap-1.5 rounded-xl bg-surface-2 px-3 py-2 text-xs leading-relaxed text-muted">
        <NoteIcon className="mt-px size-3.5 shrink-0 text-primary" aria-hidden />
        {note.text}
      </p>

      {error ? (
        <p role="alert" className="mt-4 flex items-start gap-2 rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">
          <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          {error}
        </p>
      ) : null}

      <div className="mt-6 flex flex-col gap-2">
        <button type="button" onClick={submit} disabled={busy} className={cn(buttonClass("primary", "lg"), "w-full")}>
          {busy ? <Loader className="size-4 animate-spin" aria-hidden /> : null}
          Preparar reclamo
        </button>
        <button type="button" onClick={onClose} disabled={busy} className={buttonClass("ghost")}>
          Cancelar
        </button>
      </div>
    </Dialog>
  );
}

/** Botón que abre la hoja (en la lista de pedidos). */
export function ProblemButton({
  order,
  timeZone,
  mailboxConnected,
  label,
  initialReason,
  variant = "secondary",
  size = "sm",
  demo = false,
  initialOpen = false,
  icon,
}: {
  order: TrackedOrderView;
  timeZone: string;
  mailboxConnected: boolean;
  label: string;
  initialReason?: ReturnReasonId;
  variant?: ButtonVariant;
  size?: ButtonSize;
  demo?: boolean;
  initialOpen?: boolean;
  icon?: ReactNode;
}) {
  const [open, setOpen] = useState(initialOpen);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={buttonClass(variant, size)}>
        {icon}
        {label}
      </button>
      {open ? (
        <ProblemSheet
          order={order}
          timeZone={timeZone}
          mailboxConnected={mailboxConnected}
          onClose={() => setOpen(false)}
          initialReason={initialReason}
          demo={demo}
        />
      ) : null}
    </>
  );
}
