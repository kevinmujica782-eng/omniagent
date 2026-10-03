"use client";

import {
  Check,
  ChevronDown,
  CircleAlert,
  CircleCheck,
  Clock,
  Copy,
  FlaskConical,
  HandCoins,
  History,
  Loader,
  Mail,
  MessageSquareReply,
  PackageCheck,
  Pencil,
  Send,
  ShieldAlert,
  Undo2,
  X,
  type LucideIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, type ChangeEvent } from "react";
import { ApprovalSlip } from "@/components/approval-slip";
import { MetaLine } from "@/components/returns/meta-line";
import { Dialog } from "@/components/dialog";
import { Chip, INPUT_CLASS, IconTile, buttonClass, type ChipTone } from "@/components/ui";
import { apiFetch, errorMessage } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { dateTime, money } from "@/lib/format";
import { CASE_STATUS_LABEL, OUTCOME_LABEL, REASON_LABEL, caseStatusLine, mailtoHref } from "@/lib/returns-copy";
import type { ReturnCaseStatusId, ReturnCaseView } from "@/types/cards";

// Tarjeta de un reclamo: en qué va, lo que falta (aprobar, enviarlo, devolver el paquete, escalar), el mensaje para
// la tienda y el historial. Con `demo` no llama a la API (vista previa): simula el siguiente paso.

type ReplyKind = "refund" | "replacement" | "store_credit" | "return_label" | "needs_info" | "rejected" | "shipping_update";
type CaseAction =
  | { action: "sent" | "propose" | "package_sent" | "info_sent" | "close" | "reopen" }
  | { action: "refund_received"; amount?: number | null }
  | { action: "edit"; subject: string; body: string }
  | { action: "reply"; text?: string | null; kind?: ReplyKind | null; amount?: number | null };

const STATUS_ICON: Record<ReturnCaseStatusId, LucideIcon> = {
  DRAFT: Send,
  SENT: Clock,
  ANSWERED: CircleAlert,
  RESOLVED: CircleCheck,
  REJECTED: ShieldAlert,
  CLOSED: Check,
};

const STATUS_TONE: Record<ReturnCaseStatusId, ChipTone> = {
  DRAFT: "attention",
  SENT: "neutral",
  ANSWERED: "attention",
  RESOLVED: "good",
  REJECTED: "danger",
  CLOSED: "neutral",
};

const DONE_MESSAGE: Partial<Record<CaseAction["action"], string>> = {
  sent: "Anotado: lo enviaste tú. Te pregunto si la tienda responde.",
  propose: "Listo para aprobar: sale desde tu correo cuando lo apruebes.",
  package_sent: "Anotado: devolviste el paquete. Te aviso cuando la tienda confirme el reembolso.",
  info_sent: "Anotado: le respondiste a la tienda. Sigo pendiente.",
  refund_received: "¡Listo! El reembolso quedó registrado.",
  close: "Cerraste el reclamo.",
  reopen: "Reabriste el reclamo.",
  edit: "Guardé el mensaje: se enviará tal cual.",
  reply: "Guardé la respuesta de la tienda.",
};

/** Vista previa: el siguiente paso sin API. */
function demoApply(view: ReturnCaseView, body: CaseAction): ReturnCaseView {
  const now = new Date().toISOString();
  const event = (kind: ReturnCaseView["events"][number]["kind"], text: string) => [...view.events, { at: now, kind, text }];
  switch (body.action) {
    case "sent":
      return { ...view, status: "SENT", sentAt: now, followUpAt: new Date(Date.now() + 2 * 86_400_000).toISOString(), events: event("sent", `Lo enviaste tú a ${view.merchant}.`) };
    case "package_sent":
    case "info_sent":
      return { ...view, status: "SENT", nextStep: null, nextStepBy: null, awaiting: null, events: event(body.action, body.action === "package_sent" ? `Enviaste el producto de vuelta a ${view.merchant}.` : `Le respondiste a ${view.merchant}.`) };
    case "refund_received":
      return { ...view, status: "RESOLVED", outcome: view.outcome ?? "REFUND", refundAmount: view.refundAmount ?? view.amount, refundReceivedAt: now, events: event("refund_received", "Confirmaste que recibiste el reembolso.") };
    case "close":
      return { ...view, status: "CLOSED", events: event("closed", "Cerraste el reclamo.") };
    case "reopen":
      return { ...view, status: view.sentAt ? "SENT" : "DRAFT", events: event("reopened", "Reabriste el reclamo.") };
    case "edit":
      return { ...view, subject: body.subject, body: body.body };
    case "reply":
      return body.kind === "refund"
        ? { ...view, status: "RESOLVED", outcome: "REFUND", refundAmount: body.amount ?? view.amount, resolvedAt: now, events: event("reply", `${view.merchant} aprobó el reembolso.`) }
        : { ...view, events: event("reply", `${view.merchant} respondió.`) };
    default:
      return view;
  }
}

function ReplyDialog({ view, onClose, onSave }: { view: ReturnCaseView; onClose: () => void; onSave: (body: CaseAction) => Promise<void> }) {
  const [kind, setKind] = useState<ReplyKind | "text">("refund");
  const [text, setText] = useState("");
  const [amount, setAmount] = useState(view.amount ? String(view.amount) : "");
  const [busy, setBusy] = useState(false);
  const options: { kind: ReplyKind | "text"; label: string }[] = [
    { kind: "refund", label: "Aprobó el reembolso" },
    { kind: "return_label", label: "Me mandó cómo devolverlo" },
    { kind: "needs_info", label: "Pide fotos o más datos" },
    { kind: "replacement", label: "Me envía uno nuevo" },
    { kind: "store_credit", label: "Me dio saldo a favor" },
    { kind: "shipping_update", label: "Me dio una nueva fecha" },
    { kind: "rejected", label: "Lo rechazó" },
    { kind: "text", label: "Pegar su respuesta" },
  ];
  const withAmount = kind === "refund" || kind === "store_credit";
  async function save() {
    const value = Number(amount.replace(",", "."));
    setBusy(true);
    await onSave(
      kind === "text"
        ? { action: "reply", text: text.trim() }
        : { action: "reply", kind, amount: withAmount && value > 0 ? value : null },
    );
    setBusy(false);
  }
  return (
    <Dialog title="¿Qué respondió la tienda?" onClose={onClose} closable={!busy}>
      <p className="text-sm text-muted">
        {view.merchant} · {view.orderTitle}
      </p>
      <fieldset className="mt-4">
        <legend className="sr-only">Respuesta de la tienda</legend>
        <div className="flex flex-wrap gap-2">
          {options.map((option) => (
            <button
              key={option.kind}
              type="button"
              aria-pressed={kind === option.kind}
              onClick={() => setKind(option.kind)}
              className={cn(
                "rounded-full border px-3 py-1.5 text-sm transition-colors",
                kind === option.kind ? "border-primary bg-primary-soft font-semibold text-primary" : "border-line-strong text-ink hover:bg-surface-2",
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      </fieldset>
      {kind === "text" ? (
        <label className="mt-4 block">
          <span className="text-sm font-medium text-ink">Su respuesta</span>
          <textarea
            value={text}
            onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setText(event.target.value)}
            rows={6}
            maxLength={8000}
            placeholder="Pega aquí lo que te escribió la tienda. Omni lo lee y actualiza el reclamo."
            className={cn(INPUT_CLASS, "mt-1.5 resize-y")}
          />
        </label>
      ) : null}
      {withAmount ? (
        <label className="mt-4 block">
          <span className="text-sm font-medium text-ink">Monto ({view.currency})</span>
          <input
            inputMode="decimal"
            value={amount}
            onChange={(event: ChangeEvent<HTMLInputElement>) => setAmount(event.target.value)}
            className={cn(INPUT_CLASS, "mt-1.5")}
          />
        </label>
      ) : null}
      <div className="mt-6 flex flex-col gap-2">
        <button
          type="button"
          onClick={save}
          disabled={busy || (kind === "text" && text.trim().length < 10)}
          className={cn(buttonClass("primary", "lg"), "w-full")}
        >
          {busy ? <Loader className="size-4 animate-spin" aria-hidden /> : null}
          Guardar respuesta
        </button>
        <button type="button" onClick={onClose} disabled={busy} className={buttonClass("ghost")}>
          Cancelar
        </button>
      </div>
    </Dialog>
  );
}

function EditMessageDialog({ view, onClose, onSave }: { view: ReturnCaseView; onClose: () => void; onSave: (body: CaseAction) => Promise<void> }) {
  const [subject, setSubject] = useState(view.subject);
  const [body, setBody] = useState(view.body);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog title="Editar el mensaje" onClose={onClose} closable={!busy}>
      <label className="block">
        <span className="text-sm font-medium text-ink">Asunto</span>
        <input value={subject} maxLength={160} onChange={(e: ChangeEvent<HTMLInputElement>) => setSubject(e.target.value)} className={cn(INPUT_CLASS, "mt-1.5")} />
      </label>
      <label className="mt-4 block">
        <span className="text-sm font-medium text-ink">Mensaje</span>
        <textarea
          value={body}
          rows={12}
          maxLength={5000}
          onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setBody(e.target.value)}
          className={cn(INPUT_CLASS, "mt-1.5 resize-y font-[inherit] leading-relaxed")}
        />
      </label>
      <p className="mt-2 text-xs text-muted">Si ya estaba listo para aprobar, se enviará exactamente este texto.</p>
      <div className="mt-6 flex flex-col gap-2">
        <button
          type="button"
          disabled={busy || subject.trim().length < 3 || body.trim().length < 10}
          onClick={async () => {
            setBusy(true);
            await onSave({ action: "edit", subject, body });
            setBusy(false);
          }}
          className={cn(buttonClass("primary", "lg"), "w-full")}
        >
          {busy ? <Loader className="size-4 animate-spin" aria-hidden /> : null}
          Guardar mensaje
        </button>
        <button type="button" onClick={onClose} disabled={busy} className={buttonClass("ghost")}>
          Cancelar
        </button>
      </div>
    </Dialog>
  );
}

export function CaseCard({
  returnCase,
  timeZone,
  demo = false,
  highlight = false,
  mailboxConnected = true,
}: {
  returnCase: ReturnCaseView;
  timeZone: string;
  demo?: boolean;
  highlight?: boolean;
  mailboxConnected?: boolean;
}) {
  const router = useRouter();
  const [view, setView] = useState(returnCase);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<"reply" | "edit" | null>(null);
  const pendingApproval = view.status === "DRAFT" && view.approval?.status === "PENDING";
  const [showMessage, setShowMessage] = useState(view.status === "DRAFT" && !pendingApproval);
  const [showHistory, setShowHistory] = useState(false);

  // Tras aprobar en la boleta (o cualquier cambio), la página se vuelve a pedir: se toma el caso nuevo.
  useEffect(() => setView(returnCase), [returnCase]);

  useEffect(() => {
    if (highlight) document.getElementById(`caso-${returnCase.id}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [highlight, returnCase.id]);

  async function act(body: CaseAction) {
    setError(null);
    setNotice(null);
    if (demo) {
      setView((current) => demoApply(current, body));
      setNotice(`${DONE_MESSAGE[body.action] ?? "Listo."} (Vista previa: nada se guarda.)`);
      setDialog(null);
      return;
    }
    setBusy(body.action);
    try {
      const updated = await apiFetch<ReturnCaseView>(`/api/v1/returns/cases/${view.id}`, { method: "PATCH", body });
      setView(updated);
      setNotice(DONE_MESSAGE[body.action] ?? "Listo.");
      setDialog(null);
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function simulate() {
    setError(null);
    setNotice(null);
    if (demo) {
      setView((current) => demoApply(current, { action: "reply", kind: "refund", amount: current.amount }));
      setNotice("La tienda de prueba respondió. (Vista previa: nada se guarda.)");
      return;
    }
    setBusy("simulate");
    try {
      const updated = await apiFetch<ReturnCaseView>(`/api/v1/returns/cases/${view.id}/simulate-reply`, { method: "POST" });
      setView(updated);
      setNotice("La tienda de prueba respondió: mira el historial.");
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function copy(text: string, what: string) {
    try {
      await navigator.clipboard.writeText(text);
      setNotice(`${what} copiado.`);
    } catch {
      setError("No se pudo copiar. Selecciona el texto y cópialo a mano.");
    }
  }

  const Icon = STATUS_ICON[view.status];
  const needsYou = view.status === "DRAFT" || view.status === "ANSWERED" || view.status === "REJECTED" || view.escalated;
  const open = view.status === "DRAFT" || view.status === "SENT" || view.status === "ANSWERED";
  const mailto = view.status === "DRAFT" ? mailtoHref(view) : null;
  const button = (key: string, label: string, onClick: () => void, variant: "primary" | "secondary" | "ghost" = "secondary", icon?: LucideIcon) => {
    const ButtonIcon = icon;
    return (
      <button key={key} type="button" onClick={onClick} disabled={busy !== null} className={buttonClass(variant, "sm")}>
        {busy === key ? <Loader className="size-4 animate-spin" aria-hidden /> : ButtonIcon ? <ButtonIcon className="size-4" aria-hidden /> : null}
        {label}
      </button>
    );
  };

  const actions = [
    ...(view.status === "DRAFT" && !pendingApproval && view.sendTo && mailboxConnected ? [button("propose", "Que Omni lo envíe", () => act({ action: "propose" }), "primary", Send)] : []),
    ...(view.status === "DRAFT" && !pendingApproval ? [button("sent", "Ya lo envié", () => act({ action: "sent" }), view.sendTo && mailboxConnected ? "secondary" : "primary", Check)] : []),
    ...(view.status === "DRAFT" ? [button("edit-open", "Editar mensaje", () => setDialog("edit"), "ghost", Pencil)] : []),
    ...(view.status === "ANSWERED" && view.awaiting === "package" ? [button("package_sent", "Ya envié el paquete", () => act({ action: "package_sent" }), "primary", PackageCheck)] : []),
    ...(view.status === "ANSWERED" && view.awaiting === "info" ? [button("info_sent", "Ya le respondí", () => act({ action: "info_sent" }), "primary", Check)] : []),
    ...(view.status === "SENT" || view.status === "ANSWERED" ? [button("reply-open", "La tienda respondió", () => setDialog("reply"), "secondary", MessageSquareReply)] : []),
    ...(view.status === "SENT" && view.sandbox ? [button("simulate", "Simular respuesta de la tienda", simulate, "ghost", FlaskConical)] : []),
    ...(view.status === "RESOLVED" && view.outcome === "REFUND" && !view.refundReceivedAt
      ? [button("refund_received", "Ya me llegó el dinero", () => act({ action: "refund_received" }), "secondary", HandCoins)]
      : []),
    ...(view.status === "REJECTED" || view.status === "CLOSED" ? [button("reopen", "Reabrir", () => act({ action: "reopen" }), "ghost", Undo2)] : []),
    ...(open || view.status === "REJECTED" ? [button("close", "Cerrar reclamo", () => act({ action: "close" }), "ghost", X)] : []),
  ];

  return (
    <article
      id={`caso-${view.id}`}
      className={cn(
        "rounded-2xl border bg-surface p-4",
        highlight ? "border-primary ring-2 ring-primary/20" : needsYou && open ? "border-orbit" : "border-line",
      )}
    >
      <header className="flex items-start gap-3">
        <IconTile icon={Icon} size="sm" tone={needsYou ? "attention" : view.status === "RESOLVED" ? "primary" : "neutral"} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold leading-snug text-ink">
            {REASON_LABEL[view.reason]} · {view.orderTitle}
          </p>
          <MetaLine className="mt-0.5" parts={[view.merchant, view.orderNumber, `pides: ${OUTCOME_LABEL[view.desired].toLowerCase()}`]} />
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            <Chip tone={STATUS_TONE[view.status]}>{CASE_STATUS_LABEL[view.status]}</Chip>
            {view.sandbox ? <Chip>Tienda de prueba</Chip> : null}
          </div>
        </div>
      </header>

      <p className={cn("mt-3 text-sm leading-relaxed", view.status === "ANSWERED" ? "rounded-xl bg-attention-soft px-3 py-2 font-medium text-attention" : "text-ink")}>
        {caseStatusLine(view, timeZone)}
      </p>

      {view.escalation.length > 0 ? (
        <div className="mt-3 rounded-xl border border-line bg-surface-2 px-3 py-3">
          <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-sm leading-relaxed text-ink">
            {view.escalation.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          {view.disputeSummary ? (
            <div className="mt-3">
              <p className="text-xs font-semibold text-muted">Resumen para el banco o la plataforma</p>
              <p className="mt-1 text-sm leading-relaxed text-ink">{view.disputeSummary}</p>
              <button type="button" onClick={() => copy(view.disputeSummary!, "Resumen")} className={cn(buttonClass("ghost", "sm"), "-ml-3 mt-1")}>
                <Copy className="size-4" aria-hidden />
                Copiar resumen
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {pendingApproval && view.approval ? (
        <div className="mt-3">
          <ApprovalSlip card={view.approval} demo={demo} />
        </div>
      ) : null}

      {view.status === "RESOLVED" && view.outcome === "REFUND" && view.refundAmount ? (
        <p className="mt-3 flex items-center gap-2 text-sm font-semibold text-primary">
          <HandCoins className="size-4" aria-hidden />
          {money(view.refundAmount, view.currency, { cents: true })} {view.refundReceivedAt ? "recuperados" : "por recibir"}
        </p>
      ) : null}

      <div className="mt-3 border-t border-line pt-3">
        <button
          type="button"
          aria-expanded={showMessage}
          onClick={() => setShowMessage((v) => !v)}
          className="flex w-full items-center justify-between gap-2 text-left text-sm font-semibold text-ink"
        >
          <span className="flex items-center gap-2">
            <Mail className="size-4 text-muted" aria-hidden />
            {view.status === "DRAFT" ? "Mensaje para la tienda" : "Mensaje que se envió"}
          </span>
          <ChevronDown className={cn("size-4 text-muted transition-transform", showMessage && "rotate-180")} aria-hidden />
        </button>
        {showMessage ? (
          <div className="mt-2 rounded-xl bg-surface-2 px-3 py-3">
            {view.sendTo ? <p className="text-xs text-muted">Para: {view.sendTo}</p> : null}
            <p className="mt-0.5 text-sm font-semibold text-ink">{view.subject}</p>
            <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-ink">{view.body}</p>
            <div className="mt-2 flex flex-wrap gap-1">
              <button type="button" onClick={() => copy(`${view.subject}\n\n${view.body}`, "Mensaje")} className={cn(buttonClass("ghost", "sm"), "-ml-3")}>
                <Copy className="size-4" aria-hidden />
                Copiar mensaje
              </button>
              {mailto && !pendingApproval ? (
                <a href={mailto} className={buttonClass("ghost", "sm")}>
                  <Mail className="size-4" aria-hidden />
                  Abrir en tu correo
                </a>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>

      {actions.length > 0 ? <div className="mt-3 flex flex-wrap gap-2">{actions}</div> : null}

      {notice ? (
        <p role="status" className="mt-3 rounded-xl bg-primary-soft px-3 py-2 text-sm text-primary">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-3 rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      ) : null}

      {view.events.length > 0 ? (
        <div className="mt-3">
          <button
            type="button"
            aria-expanded={showHistory}
            onClick={() => setShowHistory((v) => !v)}
            className="flex items-center gap-1.5 text-xs font-semibold text-muted hover:text-ink"
          >
            <History className="size-3.5" aria-hidden />
            Historial ({view.events.length})
            <ChevronDown className={cn("size-3.5 transition-transform", showHistory && "rotate-180")} aria-hidden />
          </button>
          {showHistory ? (
            <ol className="mt-2 flex flex-col gap-2 border-l border-line pl-3">
              {[...view.events].reverse().map((event, index) => (
                <li key={`${event.at}-${index}`} className="text-sm leading-snug">
                  <p className="text-ink">{event.text}</p>
                  <p className="text-xs text-muted">{dateTime(event.at, timeZone)}</p>
                </li>
              ))}
            </ol>
          ) : null}
        </div>
      ) : null}

      {dialog === "reply" ? <ReplyDialog view={view} onClose={() => setDialog(null)} onSave={act} /> : null}
      {dialog === "edit" ? <EditMessageDialog view={view} onClose={() => setDialog(null)} onSave={act} /> : null}
    </article>
  );
}
