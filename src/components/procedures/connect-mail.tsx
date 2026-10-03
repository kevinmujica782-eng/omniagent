"use client";

import { Check, Circle, CircleAlert, CircleCheck, Inbox, Loader, Lock, Mail, RefreshCw, Send, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition, type ChangeEvent } from "react";
import { Dialog } from "@/components/dialog";
import { OmniMark } from "@/components/omni-mark";
import { Chip, buttonClass } from "@/components/ui";
import { apiFetch, errorMessage, sleep } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { plural } from "@/lib/format";
import { dayText } from "@/lib/procedures-copy";
import type { MailboxView, ProcedureView } from "@/types/cards";

type Flavor = "gmail" | "outlook";
type Step = "intro" | "connecting" | "done" | "error";
type SyncResult = { fetched: number; created: number; triaged: number; suggested: number; source: "AI" | "RULES" | null };
type Outcome = { mailbox: MailboxView; sync: SyncResult };

const FLAVORS: { id: Flavor; name: string; body: string; icon: typeof Mail }[] = [
  { id: "gmail", name: "Estilo Gmail", body: "Etiquetas, promociones y adjuntos como en Gmail.", icon: Mail },
  { id: "outlook", name: "Estilo Outlook", body: "Bandeja y calendario como en Outlook.", icon: Inbox },
];

const PHASES = ["Conectando la bandeja de prueba", "Leyendo tus correos", "Buscando trámites y fechas"];

/** Resultado de ejemplo para la vista previa. */
const DEMO_OUTCOME: Outcome = {
  mailbox: {
    id: "demo-mailbox",
    address: "laura.demo@correo-demo.test",
    displayName: "Correo de prueba (estilo Gmail)",
    flavor: "gmail",
    provider: "sandbox",
    status: "ACTIVE",
    lastSyncedAt: new Date().toISOString(),
    messageCount: 9,
  },
  sync: { fetched: 9, created: 9, triaged: 9, suggested: 7, source: "RULES" },
};

/**
 * Conectar el correo. Hoy es una bandeja de prueba con el contrato de Gmail/Outlook (dominios .test, ningún
 * correo real sale ni entra); Gmail y Outlook reales llegan con OAuth usando la misma interfaz.
 */
export function ConnectMailDialog({
  onClose,
  demo = false,
  initialStep = "intro",
}: {
  onClose: (connected: boolean) => void;
  demo?: boolean;
  initialStep?: Step;
}) {
  const router = useRouter();
  const [step, setStep] = useState<Step>(initialStep);
  const [flavor, setFlavor] = useState<Flavor>("gmail");
  const [withDemoData, setWithDemoData] = useState(true);
  const [phase, setPhase] = useState(initialStep === "connecting" ? 1 : 0);
  const [outcome, setOutcome] = useState<Outcome | null>(initialStep === "done" ? DEMO_OUTCOME : null);
  const [error, setError] = useState<string | null>(null);

  async function connect() {
    setStep("connecting");
    setPhase(0);
    setError(null);
    const t1 = window.setTimeout(() => setPhase((p) => Math.max(p, 1)), 900);
    const t2 = window.setTimeout(() => setPhase((p) => Math.max(p, 2)), 2000);
    try {
      const result = demo
        ? (await sleep(2400), { ...DEMO_OUTCOME, mailbox: { ...DEMO_OUTCOME.mailbox, flavor } })
        : await apiFetch<Outcome>("/api/v1/procedures/mailboxes", { method: "POST", body: { flavor, withDemoData } });
      setPhase(3);
      setOutcome(result);
      setStep("done");
    } catch (err) {
      setError(errorMessage(err));
      setStep("error");
    } finally {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    }
  }

  function finish() {
    if (demo) {
      router.push("/preview?screen=tramites");
      return;
    }
    onClose(true);
  }

  const titles: Record<Step, string> = {
    intro: "Conectar correo",
    connecting: "Conectando",
    done: "Correo conectado",
    error: "Conectar correo",
  };

  return (
    <Dialog title={titles[step]} onClose={() => onClose(step === "done")} closable={step !== "connecting"}>
      {step === "intro" ? (
        <div>
          <div className="flex flex-col items-center pt-2 text-center">
            <span className="grid size-14 place-items-center rounded-2xl bg-primary-soft">
              <OmniMark size={34} />
            </span>
            <h2 className="mt-4 text-xl font-semibold tracking-tight text-balance text-ink">Omni encuentra tus trámites</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              Permisos escolares, citas, reembolsos y facturas: los detecta en tu correo, llena los formularios y te propone
              cuándo hacerlos.
            </p>
          </div>

          <fieldset className="mt-5">
            <legend className="text-sm font-semibold text-ink">Elige la bandeja de prueba</legend>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {FLAVORS.map((option) => {
                const Icon = option.icon;
                const checked = flavor === option.id;
                return (
                  <label
                    key={option.id}
                    className={cn(
                      "relative flex cursor-pointer flex-col gap-1.5 rounded-2xl border px-3 py-3 transition-colors",
                      checked ? "border-primary bg-primary-soft" : "border-line hover:bg-surface-2",
                    )}
                  >
                    <input
                      type="radio"
                      name="flavor"
                      value={option.id}
                      checked={checked}
                      onChange={() => setFlavor(option.id)}
                      className="sr-only"
                    />
                    <span className="flex items-center gap-2 text-sm font-semibold text-ink">
                      <Icon className="size-4 text-primary" aria-hidden />
                      {option.name}
                      {checked ? <Check className="ml-auto size-4 text-primary" aria-hidden /> : null}
                    </span>
                    <span className="text-xs leading-snug text-muted">{option.body}</span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          <ul className="mt-5 space-y-3">
            {[
              { icon: ShieldCheck, title: "Solo lo necesario", body: "Omni lee los correos para detectar trámites; no borra ni mueve nada." },
              { icon: Send, title: "Nada sale sin ti", body: "Cada respuesta o envío te espera en Aprobaciones." },
              { icon: Lock, title: "Tus datos, cifrados", body: "El acceso y tus datos personales se guardan cifrados." },
            ].map(({ icon: Icon, title, body }) => (
              <li key={title} className="flex items-start gap-3">
                <Icon className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
                <p className="text-sm leading-relaxed text-muted">
                  <span className="font-semibold text-ink">{title}.</span> {body}
                </p>
              </li>
            ))}
          </ul>

          <label className="mt-5 flex items-start gap-3 rounded-2xl border border-line px-4 py-3">
            <input
              type="checkbox"
              checked={withDemoData}
              onChange={(event: ChangeEvent<HTMLInputElement>) => setWithDemoData(event.target.checked)}
              className="mt-0.5 size-4 shrink-0 accent-primary"
            />
            <span className="text-sm leading-relaxed text-muted">
              <span className="font-semibold text-ink">Cargar datos de ejemplo</span> en Mis datos (una familia ficticia) para
              ver cómo se llenan los formularios. Solo si aún no tienes datos.
            </span>
          </label>

          <p className="mt-4 rounded-2xl bg-attention-soft px-4 py-3 text-sm leading-relaxed text-attention">
            <span className="font-semibold">Modo demo:</span> correos ficticios de dominios .test. No se pide tu contraseña y
            ningún correo sale a internet.
          </p>

          <button type="button" onClick={connect} className={cn(buttonClass("primary", "lg"), "mt-6 w-full")}>
            Conectar bandeja de prueba
          </button>
        </div>
      ) : null}

      {step === "connecting" ? (
        <div role="status" aria-live="polite">
          <div className="flex flex-col items-center pt-4 text-center">
            <OmniMark size={56} thinking />
            <h2 className="mt-5 text-lg font-semibold text-ink">Un momento…</h2>
            <p className="mt-1 text-sm text-muted">Omni está leyendo tu bandeja.</p>
          </div>
          <ol className="mt-6 space-y-3.5">
            {PHASES.map((label, index) => (
              <li key={label} className="flex items-center gap-3 text-sm">
                {index < phase ? (
                  <CircleCheck className="size-5 shrink-0 text-primary" aria-hidden />
                ) : index === phase ? (
                  <Loader className="size-5 shrink-0 animate-spin text-primary" aria-hidden />
                ) : (
                  <Circle className="size-5 shrink-0 text-line-strong" aria-hidden />
                )}
                <span className={index <= phase ? "font-medium text-ink" : "text-muted"}>{label}</span>
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      {step === "done" && outcome ? (
        <div>
          <div className="flex flex-col items-center pt-2 text-center">
            <span className="grid size-14 place-items-center rounded-full bg-primary-soft text-primary">
              <Check className="size-7" aria-hidden />
            </span>
            <h2 className="mt-4 text-xl font-semibold tracking-tight text-ink">
              {outcome.sync.suggested > 0
                ? `Encontré ${plural(outcome.sync.suggested, "trámite", "trámites")}`
                : "Tu bandeja está al día"}
            </h2>
            <p className="mt-1 text-sm text-muted">
              Revisé {plural(outcome.sync.triaged || outcome.sync.fetched, "correo", "correos")} de {outcome.mailbox.address}
              {outcome.sync.source === "AI" ? " con IA" : ""}.
            </p>
          </div>
          <p className="mt-5 rounded-2xl bg-surface-2 px-4 py-3 text-sm leading-relaxed text-muted">
            Te propuse fechas para cada uno sin chocar con tu calendario. Revísalos y{" "}
            <span className="font-semibold text-ink">confírmalos con un toque</span>.
          </p>
          <button type="button" onClick={finish} className={cn(buttonClass("primary", "lg"), "mt-6 w-full")}>
            Ver mis trámites
          </button>
        </div>
      ) : null}

      {step === "error" ? (
        <div className="flex flex-col items-center py-2 text-center">
          <span className="grid size-14 place-items-center rounded-full bg-danger-soft text-danger">
            <CircleAlert className="size-7" aria-hidden />
          </span>
          <h2 className="mt-4 text-lg font-semibold text-ink">No se pudo conectar</h2>
          <p role="alert" className="mt-1 max-w-xs text-sm leading-relaxed text-muted">
            {error ?? "Algo salió mal."}
          </p>
          <div className="mt-6 flex w-full flex-col gap-2">
            <button type="button" onClick={() => setStep("intro")} className={cn(buttonClass("primary", "lg"), "w-full")}>
              Intentar de nuevo
            </button>
            <button type="button" onClick={() => onClose(false)} className={cn(buttonClass("secondary", "lg"), "w-full")}>
              Cerrar
            </button>
          </div>
        </div>
      ) : null}
    </Dialog>
  );
}

export function ConnectMailButton({
  label = "Conectar correo",
  variant = "primary",
  size = "md",
  className,
  demo = false,
  initialStep,
}: {
  label?: string;
  variant?: "primary" | "secondary";
  size?: "sm" | "md" | "lg";
  className?: string;
  demo?: boolean;
  /** Vista previa: abrir el diálogo en un paso. */
  initialStep?: Step;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [open, setOpen] = useState(Boolean(initialStep));
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={cn(buttonClass(variant, size), className)}>
        <Mail className="size-4" aria-hidden />
        {label}
      </button>
      {open ? (
        <ConnectMailDialog
          demo={demo}
          initialStep={initialStep}
          onClose={(connected) => {
            setOpen(false);
            if (connected && !demo) startTransition(() => router.refresh());
          }}
        />
      ) : null}
    </>
  );
}

/** Bandeja conectada: dirección, última revisión, "Revisar correo" y desconectar. */
export function MailboxBar({
  mailboxes,
  timeZone,
  demo = false,
}: {
  mailboxes: MailboxView[];
  timeZone: string;
  demo?: boolean;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState<"sync" | "disconnect" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const mailbox = mailboxes[0];
  if (!mailbox) return null;

  async function sync() {
    setBusy("sync");
    setMessage(null);
    try {
      if (demo) {
        await sleep(900);
        setMessage("Sin correos nuevos. Todo al día.");
        return;
      }
      const result = await apiFetch<{ sync: SyncResult; suggested: ProcedureView[] }>("/api/v1/procedures/inbox/sync", { method: "POST" });
      setMessage(
        result.sync.suggested > 0
          ? `Encontré ${plural(result.sync.suggested, "trámite nuevo", "trámites nuevos")}.`
          : result.sync.created > 0
            ? `${plural(result.sync.created, "correo nuevo", "correos nuevos")}, ningún trámite.`
            : "Sin correos nuevos. Todo al día.",
      );
      startTransition(() => router.refresh());
    } catch (err) {
      setMessage(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function disconnect() {
    setBusy("disconnect");
    setMessage(null);
    try {
      if (!demo) await apiFetch(`/api/v1/procedures/mailboxes/${mailbox.id}`, { method: "DELETE" });
      setConfirmDisconnect(false);
      if (!demo) startTransition(() => router.refresh());
    } catch (err) {
      setMessage(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mb-6 flex flex-col gap-3 rounded-2xl border border-line bg-surface px-4 py-3 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary">
          {mailbox.flavor === "outlook" ? <Inbox className="size-4" aria-hidden /> : <Mail className="size-4" aria-hidden />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex min-w-0 items-center gap-2 text-sm font-semibold text-ink">
            <span className="min-w-0 truncate">{mailbox.address}</span>
            <Chip>Demo</Chip>
          </p>
          <p className="text-xs text-muted">
            {confirmDisconnect
              ? "Se borran los correos guardados y los trámites sin confirmar."
              : message ??
                (mailbox.status !== "ACTIVE"
                  ? "La conexión venció: vuelve a conectarla."
                  : `${plural(mailbox.messageCount, "correo", "correos")}${mailbox.lastSyncedAt ? ` · revisado ${dayText(mailbox.lastSyncedAt, timeZone)}` : ""}`)}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {confirmDisconnect ? (
          <>
            <button type="button" onClick={disconnect} disabled={busy !== null} className="text-sm font-semibold text-danger hover:underline">
              {busy === "disconnect" ? "Desconectando…" : "Sí, desconectar"}
            </button>
            <button type="button" onClick={() => setConfirmDisconnect(false)} className="text-sm text-muted hover:text-ink">
              Cancelar
            </button>
          </>
        ) : (
          <>
            <button type="button" onClick={sync} disabled={busy !== null} className={buttonClass("secondary", "sm")}>
              <RefreshCw className={cn("size-4", busy === "sync" ? "animate-spin" : null)} aria-hidden />
              {busy === "sync" ? "Revisando…" : "Revisar correo"}
            </button>
            <button
              type="button"
              onClick={() => setConfirmDisconnect(true)}
              className="text-sm text-muted underline-offset-2 hover:text-ink hover:underline"
            >
              Desconectar
            </button>
          </>
        )}
      </div>
    </div>
  );
}
