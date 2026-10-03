"use client";

import { ArrowRight, Check, ChevronDown, MessageCircle } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
import { ApprovalSlip } from "@/components/approval-slip";
import { RECOMMENDATION_ICON } from "@/components/icons";
import { OmniMark } from "@/components/omni-mark";
import { Chip, IconTile, buttonClass, type ChipTone } from "@/components/ui";
import { apiFetch, errorMessage, sleep } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { DIFFICULTY_LABEL, HEALTH_LABEL, RECOMMENDATION_ACTION } from "@/lib/finance-copy";
import { money, plural, relativeDays } from "@/lib/format";
import type { ApprovalCard, BudgetView, InsightsCard, RecommendationView } from "@/types/cards";

/**
 * Informe de ahorro de Omni: salud financiera, hallazgos y recomendaciones que se aplican con un toque.
 * Cancelar una suscripción nunca es directo: deja una boleta de aprobación.
 */

const HEALTH_TONE: Record<InsightsCard["health"], ChipTone> = { buena: "good", estable: "neutral", en_riesgo: "attention" };

type Decision = "accept" | "dismiss" | "done";

/** Al aceptarlas queda un recordatorio: el usuario puede marcarlas como hechas después. */
const REMINDER_KINDS = new Set<RecommendationView["kind"]>(["AVOID_FEES", "NEGOTIATE_BILL", "OTHER"]);

type ApplyResult = { recommendation: RecommendationView; approval: ApprovalCard | null; budget: BudgetView | null };

/** Resultado simulado para la vista previa (no llama a la API). */
function demoOutcome(rec: RecommendationView, decision: Decision, currency: string): ApplyResult {
  if (decision === "dismiss") return { recommendation: { ...rec, status: "DISMISSED" }, approval: null, budget: null };
  if (decision === "done") {
    return { recommendation: { ...rec, status: "DONE", resultMessage: "Marcada como hecha." }, approval: null, budget: null };
  }
  const label = rec.targetLabel ?? rec.title;
  if (rec.kind === "CANCEL_SUBSCRIPTION") {
    return {
      recommendation: { ...rec, status: "ACCEPTED", resultMessage: `Dejé lista la baja de ${label} en Aprobaciones.` },
      approval: {
        kind: "approval",
        actionId: `demo-${rec.id}`,
        type: "CANCEL_SUBSCRIPTION",
        status: "PENDING",
        title: label,
        summary: rec.detail,
        merchant: label,
        amount: rec.estimatedMonthlySavings,
        amountPeriod: "al mes",
        currency,
        lines: [],
        resultMessage: null,
        createdAt: new Date().toISOString(),
      },
      budget: null,
    };
  }
  const message =
    rec.kind === "CATEGORY_BUDGET" || rec.kind === "REDUCE_ANT_EXPENSES"
      ? `Presupuesto creado para ${label.toLowerCase()}.`
      : rec.kind === "SAVINGS_GOAL"
        ? "Meta creada: la verás en Metas."
        : "Te dejé un recordatorio en tus trámites.";
  return { recommendation: { ...rec, status: "ACCEPTED", resultMessage: message }, approval: null, budget: null };
}

export function InsightsCardView({
  card: initial,
  demo = false,
  inChat = false,
  className,
  actions,
}: {
  card: InsightsCard;
  /** Vista previa: no llama a la API. */
  demo?: boolean;
  /** Dentro del chat se oculta "Hablar con Omni" (ya estás hablando con Omni). */
  inChat?: boolean;
  className?: string;
  /** Acciones extra en el pie (p. ej. "Analizar de nuevo" en Finanzas). */
  actions?: ReactNode;
}) {
  const router = useRouter();
  const [card, setCard] = useState(initial);
  const [busy, setBusy] = useState<{ id: string; decision: Decision } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [approvals, setApprovals] = useState<Record<string, ApprovalCard>>({});
  const [showDismissed, setShowDismissed] = useState(false);
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const visible = card.recommendations.filter((rec) => rec.status !== "DISMISSED");
  const dismissed = card.recommendations.filter((rec) => rec.status === "DISMISSED");
  const approvalsHref = demo ? "/preview?screen=aprobaciones" : "/aprobaciones";

  async function decide(rec: RecommendationView, decision: Decision) {
    setBusy({ id: rec.id, decision });
    setErrors((prev) => {
      const next = { ...prev };
      delete next[rec.id];
      return next;
    });
    try {
      let result: ApplyResult;
      if (demo) {
        await sleep(450);
        result = demoOutcome(rec, decision, card.currency);
      } else {
        result = await apiFetch<ApplyResult>(`/api/v1/finance/recommendations/${rec.id}`, {
          method: "PATCH",
          body: { decision },
        });
      }
      setCard((prev) => ({
        ...prev,
        recommendations: prev.recommendations.map((r) => (r.id === rec.id ? result.recommendation : r)),
      }));
      const approval = result.approval;
      if (approval) setApprovals((prev) => ({ ...prev, [rec.id]: approval }));
      // Presupuestos, metas y el contador de aprobaciones viven en otras partes de la página.
      if (!demo) startTransition(() => router.refresh());
    } catch (error) {
      setErrors((prev) => ({ ...prev, [rec.id]: errorMessage(error) }));
    } finally {
      setBusy(null);
    }
  }

  async function openChat() {
    setOpening(true);
    setOpenError(null);
    try {
      if (demo) {
        await sleep(300);
        router.push("/preview?screen=analisis");
        return;
      }
      const { conversationId } = await apiFetch<{ conversationId: string }>(
        `/api/v1/finance/analysis/${card.analysisId}/conversation`,
        { method: "POST" },
      );
      router.push(`/chat?c=${conversationId}`);
    } catch (error) {
      setOpenError(errorMessage(error));
      setOpening(false);
    }
  }

  const showFooter = !inChat || card.source === "RULES" || actions;

  return (
    <article
      className={cn("w-full overflow-hidden rounded-3xl border border-line bg-surface", className)}
      aria-label="Informe financiero de Omni"
    >
      <div className="p-5">
        <div className="flex items-center gap-3">
          <OmniMark size={32} />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-ink">Informe de Omni</p>
            <p className="truncate text-xs text-muted">Del {card.periodLabel}</p>
          </div>
          <Chip tone={HEALTH_TONE[card.health]}>{HEALTH_LABEL[card.health]}</Chip>
        </div>

        <h3 className="mt-4 text-lg font-semibold leading-snug tracking-tight text-balance text-ink">{card.headline}</h3>
        <p className="mt-1.5 text-sm leading-relaxed text-muted">{card.summary}</p>

        {card.totalMonthlySavings > 0 ? (
          <div className="mt-4 flex items-end justify-between gap-3 rounded-2xl bg-primary-soft px-4 py-3 text-primary">
            <div>
              <p className="text-xs font-medium">Puedes liberar</p>
              <p className="text-2xl font-semibold tracking-tight tabular-nums">
                {money(card.totalMonthlySavings, card.currency)}
                <span className="ml-1 text-sm font-normal">al mes</span>
              </p>
            </div>
            <p className="pb-1 text-right text-xs tabular-nums">
              ≈ {money(card.totalMonthlySavings * 12, card.currency)} al año
            </p>
          </div>
        ) : null}

        {card.keyPoints.length > 0 ? (
          <ul className="mt-4 space-y-2">
            {card.keyPoints.map((point) => (
              <li key={point} className="flex gap-2.5 text-sm leading-relaxed text-ink">
                <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-orbit" />
                <span>{point}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {card.recommendations.length > 0 ? (
        <div className="border-t border-line px-5">
          <p className="flex items-center justify-between gap-3 pt-4 text-sm font-semibold text-ink">
            Recomendaciones
            <span className="text-xs font-normal text-muted">
              {plural(visible.filter((r) => r.status === "NEW").length, "pendiente", "pendientes")}
            </span>
          </p>
          <ul className="divide-y divide-line">
            {visible.map((rec) => (
              <RecommendationRow
                key={rec.id}
                rec={rec}
                currency={card.currency}
                busy={busy?.id === rec.id ? busy.decision : null}
                locked={busy !== null}
                error={errors[rec.id] ?? null}
                approval={approvals[rec.id] ?? null}
                approvalsHref={approvalsHref}
                demo={demo}
                onDecide={decide}
              />
            ))}
          </ul>
          {dismissed.length > 0 ? (
            <div className="border-t border-line py-3">
              <button
                type="button"
                onClick={() => setShowDismissed((v) => !v)}
                aria-expanded={showDismissed}
                className="flex items-center gap-1.5 text-xs font-medium text-muted hover:text-ink"
              >
                <ChevronDown className={cn("size-4 transition-transform", showDismissed && "rotate-180")} aria-hidden />
                {plural(dismissed.length, "descartada", "descartadas")}
              </button>
              {showDismissed ? (
                <ul className="mt-2 space-y-1.5">
                  {dismissed.map((rec) => (
                    <li key={rec.id} className="text-sm text-muted line-through decoration-line-strong">
                      {rec.title}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {showFooter ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-line bg-surface-2 px-5 py-3.5">
          {!inChat ? (
            <button type="button" onClick={openChat} disabled={opening} className={buttonClass("primary", "sm")}>
              <MessageCircle className="size-4" aria-hidden />
              {opening ? "Abriendo…" : "Hablar con Omni"}
            </button>
          ) : null}
          {actions}
          <span className="ml-auto whitespace-nowrap text-xs text-muted">
            {card.source === "RULES" ? "Informe básico, sin IA" : `Hecho ${relativeDays(card.createdAt)}`}
          </span>
          {openError ? (
            <p role="alert" className="w-full text-sm text-danger">
              {openError}
            </p>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

function RecommendationRow({
  rec,
  currency,
  busy,
  locked,
  error,
  approval,
  approvalsHref,
  demo,
  onDecide,
}: {
  rec: RecommendationView;
  currency: string;
  busy: Decision | null;
  locked: boolean;
  error: string | null;
  approval: ApprovalCard | null;
  approvalsHref: string;
  demo: boolean;
  onDecide: (rec: RecommendationView, decision: Decision) => void;
}) {
  const Icon = RECOMMENDATION_ICON[rec.kind];
  const expired = rec.status === "EXPIRED";
  const settled = rec.status === "ACCEPTED" || rec.status === "DONE";

  return (
    <li className="py-3.5">
      <div className="flex items-start gap-3">
        <IconTile icon={Icon} size="sm" tone={expired ? "neutral" : "primary"} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <p className={cn("text-sm font-semibold leading-snug", expired ? "text-muted" : "text-ink")}>{rec.title}</p>
            <div className="shrink-0 text-right">
              {rec.estimatedMonthlySavings > 0 ? (
                <p className={cn("text-sm font-semibold tabular-nums", expired ? "text-muted" : "text-primary")}>
                  +{money(rec.estimatedMonthlySavings, currency)}
                  <span className="text-xs font-normal text-muted">/mes</span>
                </p>
              ) : null}
              {rec.status === "NEW" ? <p className="text-[11px] text-muted">{DIFFICULTY_LABEL[rec.difficulty]}</p> : null}
            </div>
          </div>
          <p className="mt-0.5 text-sm leading-relaxed text-muted">{rec.detail}</p>

          {rec.status === "NEW" ? (
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => onDecide(rec, "accept")}
                disabled={locked}
                className={buttonClass("primary", "sm")}
              >
                {busy === "accept" ? "Aplicando…" : RECOMMENDATION_ACTION[rec.kind]}
              </button>
              <button
                type="button"
                onClick={() => onDecide(rec, "dismiss")}
                disabled={locked}
                className={buttonClass("ghost", "sm")}
              >
                {busy === "dismiss" ? "Descartando…" : "Descartar"}
              </button>
            </div>
          ) : null}

          {settled ? (
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
              <p className="flex items-start gap-1.5 text-sm font-medium text-primary">
                <Check className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span>{rec.resultMessage ?? "Hecho."}</span>
              </p>
              {rec.kind === "CANCEL_SUBSCRIPTION" && rec.status === "ACCEPTED" && !approval ? (
                <Link
                  href={approvalsHref}
                  className="inline-flex items-center gap-1 text-sm font-semibold text-primary underline-offset-2 hover:underline"
                >
                  Ir a Aprobaciones
                  <ArrowRight className="size-3.5" aria-hidden />
                </Link>
              ) : null}
              {rec.status === "ACCEPTED" && REMINDER_KINDS.has(rec.kind) ? (
                <button
                  type="button"
                  onClick={() => onDecide(rec, "done")}
                  disabled={locked}
                  className="text-xs font-medium text-muted underline-offset-2 hover:text-ink hover:underline"
                >
                  {busy === "done" ? "Guardando…" : "Ya lo hice"}
                </button>
              ) : null}
            </div>
          ) : null}

          {expired ? <p className="mt-1.5 text-xs text-muted">Reemplazada por un análisis más reciente.</p> : null}

          {error ? (
            <p role="alert" className="mt-2 text-sm text-danger">
              {error}
            </p>
          ) : null}
        </div>
      </div>
      {approval ? (
        <div className="mt-3 sm:pl-11">
          <ApprovalSlip card={approval} demo={demo} />
        </div>
      ) : null}
    </li>
  );
}
