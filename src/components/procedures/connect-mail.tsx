"use client";

import {
  Check,
  Circle,
  CircleAlert,
  CircleCheck,
  ExternalLink,
  Eye,
  EyeOff,
  FlaskConical,
  Inbox,
  Loader,
  Lock,
  Mail,
  RefreshCw,
  Send,
  ShieldCheck,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition, type ChangeEvent, type FormEvent, type ReactNode } from "react";
import { Dialog } from "@/components/dialog";
import { OmniMark } from "@/components/omni-mark";
import { Chip, INPUT_CLASS, buttonClass } from "@/components/ui";
import { apiFetch, errorMessage, sleep } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { plural } from "@/lib/format";
import { dayText } from "@/lib/procedures-copy";
import {
  MAIL_SERVICES,
  MICROSOFT_NOTICE,
  detectMailService,
  mailService,
  type MailServiceId,
} from "@/modules/procedures/mail/providers/imap-presets";
import type { MailboxView, ProcedureView } from "@/types/cards";

type Flavor = "gmail" | "outlook";
type Step = "intro" | "real" | "demo" | "connecting" | "done" | "error";
type SyncResult = { fetched: number; created: number; triaged: number; suggested: number; source: "AI" | "RULES" | null };
type Outcome = { mailbox: MailboxView; sync: SyncResult; syncError?: string | null };

const FLAVORS: { id: Flavor; name: string; body: string; icon: typeof Mail }[] = [
  { id: "gmail", name: "Estilo Gmail", body: "Etiquetas, promociones y adjuntos como en Gmail.", icon: Mail },
  { id: "outlook", name: "Estilo Outlook", body: "Bandeja y calendario como en Outlook.", icon: Inbox },
];

const SERVICE_OPTIONS: { id: MailServiceId; name: string }[] = [...MAIL_SERVICES.map((s) => ({ id: s.id, name: s.name })), { id: "custom", name: "Otro" }];

const DEMO_PHASES = ["Conectando la bandeja de prueba", "Leyendo tus correos", "Buscando trámites y fechas"];
const REAL_PHASES = ["Entrando a tu correo", "Leyendo tus correos recientes", "Buscando trámites y fechas"];

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

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="text-sm font-semibold text-ink">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-xs leading-relaxed text-muted">{hint}</span> : null}
    </label>
  );
}

function Assurances({ real }: { real: boolean }) {
  const items = real
    ? [
        { icon: ShieldCheck, title: "Solo lectura", body: "Omni lee tu bandeja para detectar trámites; no borra, no mueve ni marca correos." },
        { icon: Send, title: "Nada sale sin ti", body: "Cada respuesta o envío te espera en Aprobaciones." },
        { icon: Lock, title: "Cifrada", body: "La contraseña de aplicación se guarda cifrada y la puedes revocar cuando quieras." },
      ]
    : [
        { icon: ShieldCheck, title: "Solo lo necesario", body: "Omni lee los correos para detectar trámites; no borra ni mueve nada." },
        { icon: Send, title: "Nada sale sin ti", body: "Cada respuesta o envío te espera en Aprobaciones." },
        { icon: Lock, title: "Tus datos, cifrados", body: "El acceso y tus datos personales se guardan cifrados." },
      ];
  return (
    <ul className="mt-5 space-y-3">
      {items.map(({ icon: Icon, title, body }) => (
        <li key={title} className="flex items-start gap-3">
          <Icon className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
          <p className="text-sm leading-relaxed text-muted">
            <span className="font-semibold text-ink">{title}.</span> {body}
          </p>
        </li>
      ))}
    </ul>
  );
}

/**
 * Conectar el correo: el real (Gmail, Yahoo, iCloud… por IMAP/SMTP con una contraseña de aplicación) o una
 * bandeja de prueba con correos ficticios (dominios .test, nada sale a internet).
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
  const [mode, setMode] = useState<"real" | "demo">(initialStep === "demo" ? "demo" : "real");
  const [flavor, setFlavor] = useState<Flavor>("gmail");
  const [withDemoData, setWithDemoData] = useState(true);
  const [phase, setPhase] = useState(initialStep === "connecting" ? 1 : 0);
  const [outcome, setOutcome] = useState<Outcome | null>(initialStep === "done" ? DEMO_OUTCOME : null);
  const [error, setError] = useState<string | null>(null);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [service, setService] = useState<MailServiceId>("gmail");
  const [serviceTouched, setServiceTouched] = useState(false);
  const [imapHost, setImapHost] = useState("");
  const [imapPort, setImapPort] = useState("993");
  const [smtpHost, setSmtpHost] = useState("");
  const [smtpPort, setSmtpPort] = useState("465");

  const detected = detectMailService(email);
  const microsoft = detected === "microsoft";
  const preset = mailService(service);

  const domain = /^[^@\s]+@([a-z0-9-]+(\.[a-z0-9-]+)+)$/i.exec(email.trim())?.[1]?.toLowerCase() ?? null;

  function onEmail(event: ChangeEvent<HTMLInputElement>) {
    const value = event.target.value;
    setEmail(value);
    const found = detectMailService(value);
    // El proveedor se elige solo según el dominio, mientras la persona no lo haya cambiado a mano.
    if (!serviceTouched && found && found !== "microsoft") setService(found);
  }

  async function run(request: () => Promise<Outcome>) {
    setStep("connecting");
    setPhase(0);
    setError(null);
    const t1 = window.setTimeout(() => setPhase((p) => Math.max(p, 1)), 1500);
    const t2 = window.setTimeout(() => setPhase((p) => Math.max(p, 2)), 4500);
    try {
      const result = await request();
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

  function connectDemo() {
    setMode("demo");
    void run(async () =>
      demo
        ? (await sleep(2400), { ...DEMO_OUTCOME, mailbox: { ...DEMO_OUTCOME.mailbox, flavor } })
        : apiFetch<Outcome>("/api/v1/procedures/mailboxes", { method: "POST", body: { flavor, withDemoData } }),
    );
  }

  function connectReal(event: FormEvent) {
    event.preventDefault();
    if (microsoft) return;
    setMode("real");
    void run(async () => {
      if (demo) {
        await sleep(2400);
        return { ...DEMO_OUTCOME, mailbox: { ...DEMO_OUTCOME.mailbox, address: email || "tu@gmail.com", displayName: "Gmail", provider: "imap" } };
      }
      return apiFetch<Outcome>("/api/v1/procedures/mailboxes/imap", {
        method: "POST",
        body: {
          email: email.trim(),
          password,
          service,
          ...(service === "custom"
            ? { imap: { host: imapHost.trim(), port: Number(imapPort) }, smtp: { host: smtpHost.trim(), port: Number(smtpPort) } }
            : {}),
        },
      });
    });
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
    real: "Tu correo",
    demo: "Bandeja de prueba",
    connecting: "Conectando",
    done: "Correo conectado",
    error: "Conectar correo",
  };
  const back = step === "real" || step === "demo" ? () => setStep("intro") : undefined;
  const phases = mode === "real" ? REAL_PHASES : DEMO_PHASES;

  return (
    <Dialog title={titles[step]} onClose={() => onClose(step === "done")} onBack={back} closable={step !== "connecting"}>
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
          <div className="mt-6 flex flex-col gap-2">
            <button
              type="button"
              onClick={() => setStep("real")}
              className="flex items-start gap-3 rounded-2xl border border-primary bg-primary-soft px-4 py-3.5 text-left transition-colors hover:brightness-[0.98]"
            >
              <Mail className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink">
                  Mi correo
                  <Chip tone="good">Recomendado</Chip>
                </span>
                <span className="mt-0.5 block text-xs leading-relaxed text-muted">Gmail, Yahoo, iCloud y otros. Tus correos de verdad.</span>
              </span>
            </button>
            <button
              type="button"
              onClick={() => setStep("demo")}
              className="flex items-start gap-3 rounded-2xl border border-line px-4 py-3.5 text-left transition-colors hover:bg-surface-2"
            >
              <FlaskConical className="mt-0.5 size-5 shrink-0 text-muted" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-ink">Bandeja de prueba</span>
                <span className="mt-0.5 block text-xs leading-relaxed text-muted">Correos ficticios para ver cómo funciona, sin conectar nada.</span>
              </span>
            </button>
          </div>
        </div>
      ) : null}

      {step === "real" ? (
        <form onSubmit={connectReal}>
          <div className="space-y-4">
            <Field label="Tu correo">
              <input
                type="email"
                inputMode="email"
                autoComplete="email"
                required
                value={email}
                onChange={onEmail}
                placeholder="laura@gmail.com"
                className={cn(INPUT_CLASS, "mt-1.5")}
              />
            </Field>

            {microsoft ? (
              <p className="rounded-2xl bg-attention-soft px-4 py-3 text-sm leading-relaxed text-attention">{MICROSOFT_NOTICE}</p>
            ) : (
              <>
                <fieldset>
                  <legend className="text-sm font-semibold text-ink">Proveedor</legend>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {SERVICE_OPTIONS.map((option) => {
                      const checked = service === option.id;
                      return (
                        <label
                          key={option.id}
                          className={cn(
                            "cursor-pointer rounded-full border px-3 py-1.5 text-sm transition-colors",
                            checked ? "border-primary bg-primary-soft font-semibold text-ink" : "border-line text-muted hover:bg-surface-2",
                          )}
                        >
                          <input
                            type="radio"
                            name="service"
                            value={option.id}
                            checked={checked}
                            onChange={() => {
                              setService(option.id);
                              setServiceTouched(true);
                            }}
                            className="sr-only"
                          />
                          {option.name}
                        </label>
                      );
                    })}
                  </div>
                </fieldset>

                {preset ? (
                  <div className="rounded-2xl bg-surface-2 px-4 py-3">
                    <p className="text-sm leading-relaxed text-muted">
                      <span className="font-semibold text-ink">Necesitas una contraseña de aplicación.</span> {preset.help}
                    </p>
                    <a
                      href={preset.appPasswordUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-2 inline-flex items-center gap-1.5 text-sm font-semibold text-primary underline-offset-2 hover:underline"
                    >
                      Crear contraseña en {preset.name}
                      <ExternalLink className="size-3.5" aria-hidden />
                    </a>
                  </div>
                ) : (
                  <div className="grid grid-cols-[1fr_5.5rem] gap-2">
                    <Field label="Servidor IMAP">
                      <input value={imapHost} onChange={(e) => setImapHost(e.target.value)} required autoCapitalize="none" spellCheck={false} placeholder={domain ? `imap.${domain}` : "imap.tudominio.com"} className={cn(INPUT_CLASS, "mt-1.5")} />
                    </Field>
                    <Field label="Puerto">
                      <select value={imapPort} onChange={(e) => setImapPort(e.target.value)} className={cn(INPUT_CLASS, "mt-1.5")}>
                        <option value="993">993</option>
                        <option value="143">143</option>
                      </select>
                    </Field>
                    <Field label="Servidor SMTP">
                      <input value={smtpHost} onChange={(e) => setSmtpHost(e.target.value)} required autoCapitalize="none" spellCheck={false} placeholder={domain ? `smtp.${domain}` : "smtp.tudominio.com"} className={cn(INPUT_CLASS, "mt-1.5")} />
                    </Field>
                    <Field label="Puerto">
                      <select value={smtpPort} onChange={(e) => setSmtpPort(e.target.value)} className={cn(INPUT_CLASS, "mt-1.5")}>
                        <option value="465">465</option>
                        <option value="587">587</option>
                      </select>
                    </Field>
                  </div>
                )}

                <Field
                  label={preset ? "Contraseña de aplicación" : "Contraseña"}
                  hint={preset ? "No es la contraseña con la que entras a tu correo: es una que creas solo para OmniAgent." : undefined}
                >
                  <span className="relative mt-1.5 block">
                    <input
                      type={showPassword ? "text" : "password"}
                      autoComplete="off"
                      autoCapitalize="none"
                      spellCheck={false}
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder={service === "gmail" ? "abcd efgh ijkl mnop" : undefined}
                      className={cn(INPUT_CLASS, "pr-11 font-mono")}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
                      className="absolute inset-y-0 right-0 grid w-11 place-items-center text-muted hover:text-ink"
                    >
                      {showPassword ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
                    </button>
                  </span>
                </Field>
              </>
            )}
          </div>

          <Assurances real />

          <button type="submit" disabled={microsoft} className={cn(buttonClass("primary", "lg"), "mt-6 w-full")}>
            Conectar mi correo
          </button>
        </form>
      ) : null}

      {step === "demo" ? (
        <div>
          <fieldset>
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
                    <input type="radio" name="flavor" value={option.id} checked={checked} onChange={() => setFlavor(option.id)} className="sr-only" />
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

          <Assurances real={false} />

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

          <button type="button" onClick={connectDemo} className={cn(buttonClass("primary", "lg"), "mt-6 w-full")}>
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
            {phases.map((label, index) => (
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
                : outcome.mailbox.provider === "imap"
                  ? "Tu correo quedó conectado"
                  : "Tu bandeja está al día"}
            </h2>
            <p className="mt-1 text-sm text-muted">
              {outcome.sync.fetched > 0
                ? `Revisé ${plural(outcome.sync.triaged || outcome.sync.fetched, "correo", "correos")} de ${outcome.mailbox.address}${outcome.sync.source === "AI" ? " con IA" : ""}.`
                : `Omni revisará ${outcome.mailbox.address} y te avisará cuando llegue un trámite.`}
            </p>
          </div>
          {outcome.syncError ? (
            <p className="mt-5 rounded-2xl bg-attention-soft px-4 py-3 text-sm leading-relaxed text-attention">{outcome.syncError}</p>
          ) : outcome.sync.suggested > 0 ? (
            <p className="mt-5 rounded-2xl bg-surface-2 px-4 py-3 text-sm leading-relaxed text-muted">
              Te propuse fechas para cada uno sin chocar con tu calendario. Revísalos y{" "}
              <span className="font-semibold text-ink">confírmalos con un toque</span>.
            </p>
          ) : null}
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
            <button type="button" onClick={() => setStep(mode)} className={cn(buttonClass("primary", "lg"), "w-full")}>
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

function MailboxRow({ mailbox, timeZone, demo, onChanged }: { mailbox: MailboxView; timeZone: string; demo: boolean; onChanged: () => void }) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const real = mailbox.provider === "imap";

  async function disconnect() {
    setBusy(true);
    setMessage(null);
    try {
      if (!demo) await apiFetch(`/api/v1/procedures/mailboxes/${mailbox.id}`, { method: "DELETE" });
      setConfirm(false);
      if (!demo) onChanged();
    } catch (err) {
      setMessage(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-3">
      <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary">
        {mailbox.flavor === "outlook" ? <Inbox className="size-4" aria-hidden /> : <Mail className="size-4" aria-hidden />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex min-w-0 items-center gap-2 text-sm font-semibold text-ink">
          <span className="min-w-0 truncate">{mailbox.address}</span>
          {real ? null : <Chip>Demo</Chip>}
        </p>
        <p className="text-xs text-muted">
          {confirm
            ? "Se borran los correos guardados y los trámites sin confirmar."
            : message ??
              (mailbox.status !== "ACTIVE"
                ? real
                  ? "Tu proveedor rechazó la contraseña: vuelve a conectar este correo."
                  : "La conexión venció: vuelve a conectarla."
                : `${plural(mailbox.messageCount, "correo", "correos")}${mailbox.lastSyncedAt ? ` · revisado ${dayText(mailbox.lastSyncedAt, timeZone)}` : ""}`)}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        {confirm ? (
          <>
            <button type="button" onClick={disconnect} disabled={busy} className="text-sm font-semibold text-danger hover:underline">
              {busy ? "Desconectando…" : "Sí, desconectar"}
            </button>
            <button type="button" onClick={() => setConfirm(false)} className="text-sm text-muted hover:text-ink">
              Cancelar
            </button>
          </>
        ) : (
          <button type="button" onClick={() => setConfirm(true)} className="text-sm text-muted underline-offset-2 hover:text-ink hover:underline">
            Desconectar
          </button>
        )}
      </div>
    </div>
  );
}

/** Bandejas conectadas: dirección, última revisión, "Revisar correo", agregar otra y desconectar. */
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
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  if (mailboxes.length === 0) return null;
  const hasReal = mailboxes.some((m) => m.provider === "imap");
  const realActive = mailboxes.some((m) => m.provider === "imap" && m.status === "ACTIVE");

  async function sync() {
    setSyncing(true);
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
      setSyncing(false);
    }
  }

  return (
    <div className="mb-6 rounded-2xl border border-line bg-surface px-4 py-3">
      <div className="flex flex-col gap-3">
        {mailboxes.map((mailbox) => (
          <MailboxRow key={mailbox.id} mailbox={mailbox} timeZone={timeZone} demo={demo} onChanged={() => startTransition(() => router.refresh())} />
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
        <button type="button" onClick={sync} disabled={syncing} className={buttonClass("secondary", "sm")}>
          <RefreshCw className={cn("size-4", syncing ? "animate-spin" : null)} aria-hidden />
          {syncing ? "Revisando…" : "Revisar correo"}
        </button>
        {realActive ? null : (
          <ConnectMailButton label={hasReal ? "Volver a conectar mi correo" : "Conectar mi correo real"} size="sm" variant="secondary" demo={demo} />
        )}
        {message ? (
          <p role="status" className="text-xs text-muted">
            {message}
          </p>
        ) : null}
      </div>
    </div>
  );
}
