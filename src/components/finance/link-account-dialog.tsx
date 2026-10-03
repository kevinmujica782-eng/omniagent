"use client";

import {
  Check,
  ChevronLeft,
  ChevronRight,
  Circle,
  CircleAlert,
  CircleCheck,
  Landmark,
  Loader,
  Lock,
  ShieldCheck,
  Unplug,
  X,
  type LucideIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { ACCOUNT_ICON, INSTITUTION_ICON } from "@/components/icons";
import { OmniMark } from "@/components/omni-mark";
import { Chip, IconTile, buttonClass, type ChipTone } from "@/components/ui";
import { apiFetch, errorMessage, sleep } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { HEALTH_LABEL, INSTITUTION_KIND_LABEL } from "@/lib/finance-copy";
import { money, plural } from "@/lib/format";
import { sandboxInstitutionViews } from "@/modules/finance/providers/sandbox-catalog";
import type { InsightsCard, LinkInstitutionView, LinkResultView, LinkSessionView } from "@/types/cards";

/**
 * Diálogo para conectar bancos y tarjetas (equivale a Plaid Link).
 * - Sandbox: instituciones ficticias, se eligen cuentas y no se piden usuarios ni contraseñas.
 * - Plaid: abre Plaid Link (su propia ventana segura) y canjea el public token en el servidor.
 * Al terminar importa 90 días de movimientos y pide el primer análisis a Omni.
 */

export type LinkStep = "intro" | "institution" | "accounts" | "plaid" | "linking" | "done" | "error";

type Outcome = { link: LinkResultView; insights: InsightsCard | null; note: string | null };

const HEALTH_TONE: Record<InsightsCard["health"], ChipTone> = { buena: "good", estable: "neutral", en_riesgo: "attention" };

// ── Plaid Link (solo cuando FINANCE_PROVIDER=plaid) ─────────────────────────
const PLAID_SCRIPT = "https://cdn.plaid.com/link/v2/stable/link-initialize.js";

type PlaidMetadata = { institution: { name: string; institution_id: string } | null; accounts: { id: string }[] };
type PlaidExitError = { display_message: string | null; error_message: string } | null;
type PlaidHandler = { open(): void; destroy(): void };
type PlaidFactory = {
  create(config: {
    token: string;
    onSuccess(publicToken: string, metadata: PlaidMetadata): void;
    onExit(error: PlaidExitError): void;
  }): PlaidHandler;
};

declare global {
  interface Window {
    Plaid?: PlaidFactory;
  }
}

function loadPlaid(): Promise<PlaidFactory> {
  if (window.Plaid) return Promise.resolve(window.Plaid);
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${PLAID_SCRIPT}"]`);
    const script = existing ?? document.createElement("script");
    script.addEventListener("load", () => (window.Plaid ? resolve(window.Plaid) : reject(new Error("plaid"))));
    script.addEventListener("error", () => reject(new Error("plaid")));
    if (!existing) {
      script.src = PLAID_SCRIPT;
      script.async = true;
      document.head.appendChild(script);
    }
  });
}

// ── Vista previa ────────────────────────────────────────────────────────────
function demoSession(): LinkSessionView {
  return {
    provider: "sandbox",
    linkToken: "demo",
    expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
    institutions: sandboxInstitutionViews("demo"),
  };
}

const TITLES: Record<LinkStep, string> = {
  intro: "Conectar cuenta",
  institution: "Elige tu banco",
  accounts: "Elige tus cuentas",
  plaid: "Conectar cuenta",
  linking: "Conectando",
  done: "Cuenta conectada",
  error: "Conectar cuenta",
};

export function LinkAccountDialog({
  onClose,
  demo = false,
  demoInsights = null,
  connectedInstitutions = [],
  initialStep = "intro",
}: {
  /** `linked`: si se conectó algo (para refrescar la página de fondo). */
  onClose: (linked: boolean) => void;
  demo?: boolean;
  demoInsights?: InsightsCard | null;
  /** Nombres de instituciones ya conectadas (se marcan en la lista). */
  connectedInstitutions?: string[];
  /** Solo para la vista previa: abrir en un paso concreto. */
  initialStep?: LinkStep;
}) {
  const router = useRouter();
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const linked = useRef(false);

  const preset = demo ? demoSession() : null;
  const presetInstitution =
    preset?.provider === "sandbox" && (initialStep === "accounts" || initialStep === "done" || initialStep === "linking")
      ? preset.institutions[0]
      : null;

  const [step, setStep] = useState<LinkStep>(initialStep);
  const [session, setSession] = useState<LinkSessionView | null>(preset);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [waitingSession, setWaitingSession] = useState(false);
  const [institution, setInstitution] = useState<LinkInstitutionView | null>(presetInstitution);
  const [selected, setSelected] = useState<string[]>(presetInstitution?.accounts.map((a) => a.id) ?? []);
  const [linkingName, setLinkingName] = useState(presetInstitution?.name ?? "");
  const [phase, setPhase] = useState(initialStep === "linking" ? 1 : 0);
  const [outcome, setOutcome] = useState<Outcome | null>(
    initialStep === "done" && presetInstitution
      ? {
          link: {
            connectionId: "demo",
            institution: { id: presetInstitution.id, name: presetInstitution.name },
            accounts: presetInstitution.accounts.length,
            added: 214,
            modified: 0,
            removed: 0,
          },
          insights: demoInsights,
          note: null,
        }
      : null,
  );
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);

  // La sesión (link token) se pide al abrir: así "Continuar" es inmediato y sabemos si es sandbox o Plaid.
  useEffect(() => {
    if (demo) return;
    let cancelled = false;
    apiFetch<LinkSessionView>("/api/v1/finance/link-token", { method: "POST" })
      .then((value) => {
        if (!cancelled) setSession(value);
      })
      .catch((err: unknown) => {
        if (!cancelled) setSessionError(errorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [demo]);

  // Foco dentro del diálogo al abrir y de vuelta al botón al cerrar.
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panelRef.current?.focus();
    return () => previous?.focus();
  }, []);

  // Si se pulsó "Continuar" antes de tener la sesión, sigue en cuanto llega.
  useEffect(() => {
    if (!waitingSession) return;
    if (session) {
      setWaitingSession(false);
      proceed(session);
    } else if (sessionError) {
      setWaitingSession(false);
      fail(sessionError);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waitingSession, session, sessionError]);

  const sandbox = session?.provider === "sandbox";
  const closable = step !== "linking";

  function close() {
    if (!closable) return;
    onClose(linked.current);
  }

  function fail(message: string) {
    setError(message);
    setStep("error");
  }

  function proceed(current: LinkSessionView) {
    if (current.provider === "sandbox") setStep("institution");
    else void openPlaid(current.linkToken);
  }

  function start() {
    setError(null);
    if (session) proceed(session);
    else if (sessionError) fail(sessionError);
    else setWaitingSession(true);
  }

  async function restart() {
    setError(null);
    setOutcome(null);
    setInstitution(null);
    setSelected([]);
    if (demo) {
      setStep("institution");
      return;
    }
    // Pide una sesión nueva (la anterior pudo vencer o ya se usó en Plaid); el efecto de arriba sigue al llegar.
    setSession(null);
    setSessionError(null);
    setStep("intro");
    setWaitingSession(true);
    try {
      setSession(await apiFetch<LinkSessionView>("/api/v1/finance/link-token", { method: "POST" }));
    } catch (err) {
      setSessionError(errorMessage(err));
    }
  }

  function chooseInstitution(value: LinkInstitutionView) {
    setInstitution(value);
    setSelected(value.accounts.map((account) => account.id));
    setStep("accounts");
  }

  function toggleAccount(id: string) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function runLink(name: string, link: () => Promise<LinkResultView>) {
    setLinkingName(name);
    setPhase(0);
    setError(null);
    setStep("linking");
    const timer = window.setTimeout(() => setPhase((p) => Math.max(p, 1)), 1100);
    try {
      const result = await link();
      window.clearTimeout(timer);
      linked.current = true;
      setPhase(2);
      let insights: InsightsCard | null = null;
      let note: string | null = null;
      try {
        if (demo) {
          await sleep(1400);
          insights = demoInsights;
        } else {
          insights = await apiFetch<InsightsCard>("/api/v1/finance/analysis?origen=conexion", { method: "POST" });
        }
      } catch (err) {
        note = errorMessage(err);
      }
      setOutcome({ link: result, insights, note });
      setStep("done");
    } catch (err) {
      window.clearTimeout(timer);
      fail(errorMessage(err));
    }
  }

  function connectSandbox() {
    if (!institution || selected.length === 0 || session?.provider !== "sandbox") return;
    const body = {
      provider: "sandbox" as const,
      linkToken: session.linkToken,
      institutionId: institution.id,
      accountIds: selected,
    };
    const accounts = selected.length;
    void runLink(institution.name, async () => {
      if (demo) {
        await sleep(1300);
        return {
          connectionId: "demo",
          institution: { id: institution.id, name: institution.name },
          accounts,
          added: 72 * accounts + 70,
          modified: 0,
          removed: 0,
        };
      }
      return apiFetch<LinkResultView>("/api/v1/finance/connections", { method: "POST", body });
    });
  }

  async function openPlaid(token: string) {
    let factory: PlaidFactory;
    try {
      factory = await loadPlaid();
    } catch {
      fail("No se pudo abrir el conector de tu banco. Revisa tu conexión e inténtalo de nuevo.");
      return;
    }
    setStep("plaid");
    const handler = factory.create({
      token,
      onSuccess(publicToken, metadata) {
        handler.destroy();
        void runLink(metadata.institution?.name ?? "tu banco", () =>
          apiFetch<LinkResultView>("/api/v1/finance/connections", {
            method: "POST",
            body: { provider: "plaid", publicToken, accountIds: metadata.accounts.map((account) => account.id) },
          }),
        );
      },
      onExit(exitError) {
        handler.destroy();
        if (exitError) fail(exitError.display_message ?? "No se completó la conexión con tu banco.");
        else setStep("intro");
      },
    });
    handler.open();
  }

  async function openChat() {
    const analysisId = outcome?.insights?.analysisId;
    if (!analysisId) return;
    setOpening(true);
    try {
      if (demo) {
        router.push("/preview?screen=analisis");
        return;
      }
      const { conversationId } = await apiFetch<{ conversationId: string }>(
        `/api/v1/finance/analysis/${analysisId}/conversation`,
        { method: "POST" },
      );
      router.push(`/chat?c=${conversationId}`);
    } catch (err) {
      setOpening(false);
      setOutcome((prev) => (prev ? { ...prev, note: errorMessage(err) } : prev));
    }
  }

  function finish() {
    if (demo) {
      router.push("/preview?screen=finanzas");
      return;
    }
    onClose(linked.current);
  }

  function back() {
    if (step === "accounts") setStep("institution");
    else if (step === "institution") setStep("intro");
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.stopPropagation();
      close();
      return;
    }
    if (event.key !== "Tab" || !panelRef.current) return;
    const focusables = [
      ...panelRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), a[href], select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    ];
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  let content: ReactNode;
  switch (step) {
    case "intro":
      content = (
        <IntroStep
          sandbox={sandbox}
          loading={waitingSession}
          onContinue={start}
          institutionIcon={Landmark}
        />
      );
      break;
    case "institution":
      content =
        session?.provider === "sandbox" ? (
          <InstitutionStep
            institutions={session.institutions}
            connected={connectedInstitutions}
            onChoose={chooseInstitution}
          />
        ) : null;
      break;
    case "accounts":
      content = institution ? (
        <AccountsStep
          institution={institution}
          selected={selected}
          onToggle={toggleAccount}
          onConnect={connectSandbox}
        />
      ) : null;
      break;
    case "plaid":
      content = (
        <div className="flex flex-col items-center py-8 text-center">
          <OmniMark size={48} thinking />
          <p className="mt-4 text-sm font-medium text-ink">Sigue los pasos en la ventana segura de tu banco.</p>
          <p className="mt-1 text-xs text-muted">Tus credenciales van directo al conector: OmniAgent nunca las ve.</p>
        </div>
      );
      break;
    case "linking":
      content = <LinkingStep name={linkingName} phase={phase} />;
      break;
    case "done":
      content = outcome ? (
        <DoneStep
          outcome={outcome}
          opening={opening}
          onOpenChat={openChat}
          onFinish={finish}
          onAnother={restart}
        />
      ) : null;
      break;
    case "error":
      content = (
        <div className="flex flex-col items-center py-2 text-center">
          <span className="grid size-14 place-items-center rounded-full bg-danger-soft text-danger">
            <CircleAlert className="size-7" aria-hidden />
          </span>
          <h2 className="mt-4 text-lg font-semibold text-ink">No se pudo conectar</h2>
          <p role="alert" className="mt-1 max-w-xs text-sm leading-relaxed text-muted">
            {error ?? "Algo salió mal."}
          </p>
          <div className="mt-6 flex w-full flex-col gap-2">
            <button type="button" onClick={restart} className={cn(buttonClass("primary", "lg"), "w-full")}>
              Intentar de nuevo
            </button>
            <button type="button" onClick={close} className={cn(buttonClass("secondary", "lg"), "w-full")}>
              Cerrar
            </button>
          </div>
        </div>
      );
      break;
  }

  const canGoBack = step === "institution" || step === "accounts";

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6">
      <button
        type="button"
        tabIndex={-1}
        aria-label="Cerrar"
        onClick={close}
        className="absolute inset-0 h-full w-full cursor-default bg-black/40"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className="relative flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-3xl bg-surface text-left shadow-float outline-none sm:max-w-md sm:rounded-3xl"
      >
        <header className="flex items-center gap-2 px-3 pt-3">
          {canGoBack ? (
            <button
              type="button"
              onClick={back}
              aria-label="Atrás"
              className="grid size-9 place-items-center rounded-full text-muted transition-colors hover:bg-surface-2 hover:text-ink"
            >
              <ChevronLeft className="size-5" aria-hidden />
            </button>
          ) : (
            <span className="size-9" aria-hidden />
          )}
          <p id={titleId} className="flex-1 text-center text-sm font-semibold text-ink">
            {TITLES[step]}
          </p>
          {closable ? (
            <button
              type="button"
              onClick={close}
              aria-label="Cerrar"
              className="grid size-9 place-items-center rounded-full text-muted transition-colors hover:bg-surface-2 hover:text-ink"
            >
              <X className="size-5" aria-hidden />
            </button>
          ) : (
            <span className="size-9" aria-hidden />
          )}
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6 pt-2">{content}</div>
      </div>
    </div>
  );
}

function ConnectVisual({ icon: Icon }: { icon: LucideIcon }) {
  return (
    <div className="flex items-center gap-2" aria-hidden>
      <span className="grid size-14 place-items-center rounded-2xl bg-primary-soft">
        <OmniMark size={34} />
      </span>
      <span className="w-6 border-t-2 border-dashed border-line-strong" />
      <span className="grid size-9 place-items-center rounded-full border border-line bg-surface text-primary">
        <Lock className="size-4" />
      </span>
      <span className="w-6 border-t-2 border-dashed border-line-strong" />
      <span className="grid size-14 place-items-center rounded-2xl border border-line bg-surface-2 text-ink">
        <Icon className="size-7" />
      </span>
    </div>
  );
}

function IntroStep({
  sandbox,
  loading,
  onContinue,
  institutionIcon,
}: {
  sandbox: boolean;
  loading: boolean;
  onContinue: () => void;
  institutionIcon: LucideIcon;
}) {
  const points: { icon: LucideIcon; title: string; body: string }[] = [
    { icon: ShieldCheck, title: "Solo lectura", body: "Omni ve tus movimientos; no puede mover tu dinero." },
    { icon: Lock, title: "Acceso cifrado", body: "Guardamos el acceso cifrado y nunca vemos tu contraseña." },
    { icon: Unplug, title: "Tú decides", body: "Desconecta cuando quieras y borramos esos datos." },
  ];
  return (
    <div>
      <div className="flex flex-col items-center pt-2 text-center">
        <ConnectVisual icon={institutionIcon} />
        <h2 className="mt-5 text-xl font-semibold tracking-tight text-balance text-ink">
          Conecta tus cuentas y tarjetas
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          Omni lee tus últimos 90 días para encontrar gastos hormiga, suscripciones que no usas y formas de ahorrar.
        </p>
      </div>
      <ul className="mt-6 space-y-3.5">
        {points.map(({ icon: Icon, title, body }) => (
          <li key={title} className="flex items-start gap-3">
            <Icon className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
            <p className="text-sm leading-relaxed text-muted">
              <span className="font-semibold text-ink">{title}.</span> {body}
            </p>
          </li>
        ))}
      </ul>
      {sandbox ? (
        <p className="mt-5 rounded-2xl bg-attention-soft px-4 py-3 text-sm leading-relaxed text-attention">
          <span className="font-semibold">Modo demo:</span> bancos ficticios con movimientos simulados. No se piden
          usuarios ni contraseñas.
        </p>
      ) : null}
      <button
        type="button"
        onClick={onContinue}
        disabled={loading}
        className={cn(buttonClass("primary", "lg"), "mt-6 w-full")}
      >
        {loading ? <Loader className="size-4 animate-spin" aria-hidden /> : null}
        {loading ? "Preparando la conexión…" : "Continuar"}
      </button>
    </div>
  );
}

function InstitutionStep({
  institutions,
  connected,
  onChoose,
}: {
  institutions: LinkInstitutionView[];
  connected: string[];
  onChoose: (institution: LinkInstitutionView) => void;
}) {
  return (
    <div>
      <p className="text-sm leading-relaxed text-muted">Elige dónde tienes tus cuentas. Puedes conectar varias.</p>
      <ul className="mt-4 divide-y divide-line overflow-hidden rounded-2xl border border-line">
        {institutions.map((institution) => {
          const Icon = INSTITUTION_ICON[institution.kind];
          const isConnected = connected.includes(institution.name);
          return (
            <li key={institution.id}>
              <button
                type="button"
                onClick={() => onChoose(institution)}
                className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-surface-2"
              >
                <IconTile icon={Icon} tone="neutral" />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-sm font-semibold text-ink">{institution.name}</span>
                    {isConnected ? <Chip tone="good">Conectada</Chip> : null}
                  </span>
                  <span className="block text-xs leading-snug text-muted">{institution.description}</span>
                </span>
                <ChevronRight className="size-4 shrink-0 text-muted" aria-hidden />
              </button>
            </li>
          );
        })}
      </ul>
      <p className="mt-4 flex items-center justify-center gap-2 text-xs text-muted">
        <Chip>Demo</Chip>
        Instituciones de prueba con datos simulados
      </p>
    </div>
  );
}

function AccountsStep({
  institution,
  selected,
  onToggle,
  onConnect,
}: {
  institution: LinkInstitutionView;
  selected: string[];
  onToggle: (id: string) => void;
  onConnect: () => void;
}) {
  return (
    <div>
      <div className="flex items-center gap-3">
        <IconTile icon={INSTITUTION_ICON[institution.kind]} tone="neutral" />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-ink">{institution.name}</p>
          <p className="text-xs text-muted">{INSTITUTION_KIND_LABEL[institution.kind]}</p>
        </div>
      </div>
      <p className="mt-5 text-sm font-semibold text-ink">¿Qué cuentas quieres compartir?</p>
      <p className="text-xs text-muted">Omni solo verá las que elijas.</p>
      <ul className="mt-3 space-y-2">
        {institution.accounts.map((account) => {
          const checked = selected.includes(account.id);
          const Icon = ACCOUNT_ICON[account.type] ?? Landmark;
          return (
            <li key={account.id}>
              <label
                className={cn(
                  "flex cursor-pointer items-center gap-3 rounded-2xl border px-4 py-3 transition-colors",
                  checked ? "border-primary bg-primary-soft" : "border-line hover:bg-surface-2",
                )}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => onToggle(account.id)}
                  className="size-4 shrink-0 accent-primary"
                />
                <Icon className="size-5 shrink-0 text-muted" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-ink">
                    {account.name} ••{account.mask}
                  </span>
                  <span className="block text-xs text-muted">
                    {account.subtype}
                    {account.creditLimit ? ` · Límite ${money(account.creditLimit, "USD")}` : ""}
                  </span>
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      <button
        type="button"
        onClick={onConnect}
        disabled={selected.length === 0}
        className={cn(buttonClass("primary", "lg"), "mt-6 w-full")}
      >
        {selected.length === 0 ? "Elige al menos una cuenta" : `Conectar ${plural(selected.length, "cuenta", "cuentas")}`}
      </button>
      <p className="mt-3 text-center text-xs text-muted">Se importan los movimientos de los últimos 90 días.</p>
    </div>
  );
}

function LinkingStep({ name, phase }: { name: string; phase: number }) {
  const phases = [`Conexión segura con ${name}`, "Importando 90 días de movimientos", "Omni analiza tus últimos 3 meses"];
  return (
    <div role="status" aria-live="polite">
      <div className="flex flex-col items-center pt-4 text-center">
        <OmniMark size={56} thinking />
        <h2 className="mt-5 text-lg font-semibold text-ink">Un momento…</h2>
        <p className="mt-1 text-sm text-muted">Esto toma unos segundos. No cierres esta ventana.</p>
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
  );
}

function DoneStep({
  outcome,
  opening,
  onOpenChat,
  onFinish,
  onAnother,
}: {
  outcome: Outcome;
  opening: boolean;
  onOpenChat: () => void;
  onFinish: () => void;
  onAnother: () => void;
}) {
  const { link, insights, note } = outcome;
  const pending = insights?.recommendations.filter((rec) => rec.status === "NEW").length ?? 0;
  return (
    <div>
      <div className="flex flex-col items-center pt-2 text-center">
        <span className="grid size-14 place-items-center rounded-full bg-primary-soft text-primary">
          <Check className="size-7" aria-hidden />
        </span>
        <h2 className="mt-4 text-xl font-semibold tracking-tight text-ink">{link.institution.name} quedó conectado</h2>
        <p className="mt-1 text-sm text-muted">
          Importé {plural(link.added, "movimiento", "movimientos")} de {plural(link.accounts, "cuenta", "cuentas")}.
        </p>
      </div>

      {insights ? (
        <div className="mt-5 rounded-2xl border border-line bg-surface-2 p-4">
          <div className="flex items-center gap-2">
            <OmniMark size={22} />
            <p className="flex-1 text-xs font-semibold text-ink">Primer análisis de Omni</p>
            <Chip tone={HEALTH_TONE[insights.health]}>{HEALTH_LABEL[insights.health]}</Chip>
          </div>
          <p className="mt-2.5 text-[15px] font-semibold leading-snug text-ink">{insights.headline}</p>
          {insights.totalMonthlySavings > 0 ? (
            <p className="mt-1.5 text-sm text-muted">
              Encontré{" "}
              <span className="font-semibold text-primary">{money(insights.totalMonthlySavings, insights.currency)} al mes</span>{" "}
              en {plural(pending, "recomendación", "recomendaciones")}.
            </p>
          ) : null}
        </div>
      ) : null}
      {note ? <p className="mt-4 rounded-2xl bg-surface-2 px-4 py-3 text-sm leading-relaxed text-muted">{note}</p> : null}

      <div className="mt-6 flex flex-col gap-2">
        {insights ? (
          <button
            type="button"
            onClick={onOpenChat}
            disabled={opening}
            className={cn(buttonClass("primary", "lg"), "w-full")}
          >
            {opening ? "Abriendo…" : "Ver el análisis con Omni"}
          </button>
        ) : null}
        <button type="button" onClick={onFinish} className={cn(buttonClass("secondary", "lg"), "w-full")}>
          {insights ? "Ver mi resumen" : "Ver mis finanzas"}
        </button>
        <button type="button" onClick={onAnother} className={cn(buttonClass("ghost", "sm"), "mx-auto mt-1")}>
          Conectar otra cuenta
        </button>
      </div>
    </div>
  );
}
