"use client";

import { CircleAlert, Trash2 } from "lucide-react";
import { useId, useState, type ChangeEvent, type FormEvent } from "react";
import { Dialog } from "@/components/dialog";
import { buttonClass, INPUT_CLASS } from "@/components/ui";
import { apiFetch, errorMessage } from "@/lib/api-client";
import { cn } from "@/lib/cn";

const WORD = "ELIMINAR";

const WHAT_GOES = [
  "Tus conversaciones con Omni y todo lo que aprobaste.",
  "Cuentas conectadas, movimientos, metas y presupuestos. Omni revoca su acceso a tus bancos.",
  "Trámites, correos leídos, documentos y Mis datos.",
  "Precios vigilados, alertas y pedidos.",
];

const DANGER_BUTTON =
  "inline-flex items-center justify-center gap-2 rounded-full bg-danger px-6 py-3 text-base font-semibold text-on-danger transition-opacity hover:opacity-90 disabled:pointer-events-none disabled:opacity-40";

/**
 * Eliminar la cuenta (Google Play exige ofrecerlo en la app y en la web). Nada se borra sin que la persona
 * escriba ELIMINAR; la hoja dice antes qué se va y qué pasa con la suscripción.
 */
export function DeleteAccountSheet({
  billingSource,
  pro,
  onClose,
  preview = false,
  initialText = "",
}: {
  billingSource: "STRIPE" | "REVENUECAT" | "BINANCE" | null;
  pro: boolean;
  onClose: () => void;
  preview?: boolean;
  initialText?: string;
}) {
  const inputId = useId();
  const [text, setText] = useState(initialText);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirmed = text.trim().toUpperCase() === WORD;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!confirmed || busy || preview) return;
    setBusy(true);
    setError(null);
    try {
      await apiFetch("/api/v1/account/delete", { method: "POST", body: { confirm: WORD } });
      window.location.href = "/login?cuenta=eliminada";
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <Dialog title="Eliminar cuenta" onClose={onClose} closable={!busy}>
      <form onSubmit={submit} className="flex flex-col">
        <p className="flex items-start gap-2 rounded-2xl bg-danger-soft px-3.5 py-3 text-sm font-medium text-danger">
          <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>Se borra todo y no se puede deshacer.</span>
        </p>

        <ul className="mt-4 flex flex-col gap-2.5 text-sm leading-snug text-muted">
          {WHAT_GOES.map((line) => (
            <li key={line} className="flex items-start gap-2.5">
              <span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-line-strong" aria-hidden />
              <span>{line}</span>
            </li>
          ))}
        </ul>

        {pro && billingSource === "STRIPE" ? (
          <p className="mt-4 text-sm text-ink">Tu plan Pro se cancela en este momento y no se vuelve a cobrar.</p>
        ) : null}
        {billingSource === "REVENUECAT" ? (
          <p className="mt-4 rounded-2xl bg-attention-soft px-3.5 py-3 text-sm text-attention">
            Pagas Pro con Google Play. Cancélalo en Google Play → Pagos y suscripciones: desde aquí no podemos hacerlo por ti.
          </p>
        ) : null}

        <label htmlFor={inputId} className="mt-5 text-sm font-semibold text-ink">
          Escribe {WORD} para confirmar
        </label>
        <input
          id={inputId}
          value={text}
          onChange={(event: ChangeEvent<HTMLInputElement>) => setText(event.target.value)}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          className={cn(INPUT_CLASS, "mt-2 uppercase tracking-wide")}
          disabled={busy}
        />

        {error ? <p className="mt-3 rounded-xl bg-surface-2 px-3 py-2.5 text-sm text-ink">{error}</p> : null}

        <div className="mt-5 flex flex-col gap-2">
          <button type="submit" disabled={!confirmed || busy} className={DANGER_BUTTON}>
            <Trash2 className="size-4" aria-hidden />
            {busy ? "Eliminando…" : "Eliminar mi cuenta"}
          </button>
          <button type="button" onClick={onClose} disabled={busy} className={buttonClass("ghost")}>
            Cancelar
          </button>
        </div>
      </form>
    </Dialog>
  );
}

/** Zona al final de Cuenta: explica en una línea y abre la hoja de confirmación. */
export function DeleteAccountSection({
  billingSource,
  pro,
  preview = false,
  initialOpen = false,
}: {
  billingSource: "STRIPE" | "REVENUECAT" | "BINANCE" | null;
  pro: boolean;
  preview?: boolean;
  initialOpen?: boolean;
}) {
  const [open, setOpen] = useState(initialOpen);
  return (
    <div className="mt-10 border-t border-line pt-6">
      <p className="text-sm font-semibold text-ink">Eliminar tu cuenta</p>
      <p className="mt-1 text-sm text-muted">Borra tu cuenta y todos tus datos de OmniAgent. No se puede deshacer.</p>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-3 inline-flex items-center justify-center gap-2 rounded-full border border-line-strong bg-surface px-4 py-2.5 text-sm font-semibold text-danger transition-colors hover:bg-danger-soft"
      >
        <Trash2 className="size-4" aria-hidden />
        Eliminar cuenta…
      </button>
      {open ? (
        <DeleteAccountSheet
          billingSource={billingSource}
          pro={pro}
          onClose={() => setOpen(false)}
          preview={preview}
          initialText={initialOpen && preview ? "ELIMI" : ""}
        />
      ) : null}
    </div>
  );
}
