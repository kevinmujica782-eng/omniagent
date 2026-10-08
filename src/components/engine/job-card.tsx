"use client";

import { CircleAlert, Check, Circle, Globe, Hourglass, LoaderCircle, Minus, RefreshCw, Wallet, X, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Chip, IconTile, type ChipTone } from "@/components/ui";
import { cn } from "@/lib/cn";
import { JOB_STATUS_LABEL, STEP_STATUS_LABEL, jobStatusLine } from "@/lib/engine-copy";
import type { JobStatusId, JobView, PlaybookId, StepStatusId } from "@/types/engine";
import { useLiveJob } from "./use-live-job";

// Tarjeta de un trabajo del motor: qué está haciendo Omni en segundo plano, paso por paso y en vivo. Aparece en el
// chat y en el asistente cuando Omni empieza un trabajo, y se actualiza sola hasta que termina.

const PLAYBOOK_ICON: Record<PlaybookId, LucideIcon> = {
  "finance.analyze": Wallet,
  "daily.sweep": RefreshCw,
  "website.create": Globe,
  "website.update": Globe,
};

const STATUS_TONE: Record<JobStatusId, ChipTone> = {
  QUEUED: "neutral",
  RUNNING: "good",
  WAITING: "attention",
  SUCCEEDED: "good",
  FAILED: "danger",
  CANCELED: "neutral",
};

function StepIcon({ status }: { status: StepStatusId }) {
  const label = STEP_STATUS_LABEL[status];
  const base = "mt-0.5 size-4 shrink-0";
  switch (status) {
    case "SUCCEEDED":
      return <Check className={cn(base, "text-primary")} aria-label={label} />;
    case "RUNNING":
      return <LoaderCircle className={cn(base, "animate-spin text-primary motion-reduce:animate-none")} aria-label={label} />;
    case "WAITING":
      return <Hourglass className={cn(base, "text-attention")} aria-label={label} />;
    case "FAILED":
      return <CircleAlert className={cn(base, "text-danger")} aria-label={label} />;
    case "SKIPPED":
    case "CANCELED":
      return <Minus className={cn(base, "text-muted")} aria-label={label} />;
    default:
      return <Circle className={cn(base, "text-line-strong")} aria-label={label} />;
  }
}

function ResultLink({ href, label }: { href: string; label: string }) {
  const className =
    "inline-flex h-9 items-center rounded-full bg-primary px-4 text-sm font-semibold text-on-primary transition-colors hover:bg-primary-hover";
  // Las páginas web públicas se abren aparte (se ven como las verá cualquiera).
  return href.startsWith("/s/") ? (
    <a href={href} target="_blank" rel="noopener" className={className}>
      {label}
    </a>
  ) : (
    <Link href={href} className={className}>
      {label}
    </Link>
  );
}

export function JobCard({
  job: initial,
  demo = false,
  timeZone,
  className,
}: {
  job: JobView;
  /** Vista previa: sin API ni Realtime. */
  demo?: boolean;
  timeZone?: string;
  className?: string;
}) {
  const [job, setJob] = useLiveJob(initial, { demo });
  const [canceling, setCanceling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const progress = job.total > 0 ? Math.round((job.done / job.total) * 100) : 0;

  async function cancel() {
    if (demo) return;
    setCanceling(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/engine/jobs/${job.id}/cancel`, { method: "POST" });
      const json = (await res.json().catch(() => null)) as { data?: { job?: JobView }; error?: { message?: string } } | null;
      if (!res.ok || !json?.data?.job) {
        setError(json?.error?.message ?? "No se pudo detener. Inténtalo de nuevo.");
        return;
      }
      setJob(json.data.job);
    } catch {
      setError("Sin conexión. Inténtalo de nuevo.");
    } finally {
      setCanceling(false);
    }
  }

  return (
    <section aria-label={job.title} className={cn("w-full max-w-md rounded-2xl border border-line bg-surface p-4", className)}>
      <header className="flex items-start gap-3">
        <IconTile icon={PLAYBOOK_ICON[job.playbook]} tone={job.status === "WAITING" ? "attention" : "primary"} size="sm" />
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold leading-snug text-ink">{job.title}</h3>
          <p className={cn("mt-0.5 text-xs leading-relaxed", job.status === "FAILED" ? "text-danger" : "text-muted")} aria-live="polite">
            {jobStatusLine(job, timeZone)}
          </p>
        </div>
        <Chip tone={STATUS_TONE[job.status]}>{JOB_STATUS_LABEL[job.status]}</Chip>
      </header>

      <div
        className="mt-3 h-1 overflow-hidden rounded-full bg-surface-2"
        role="progressbar"
        aria-label="Avance"
        aria-valuemin={0}
        aria-valuemax={job.total}
        aria-valuenow={job.done}
      >
        <div
          className={cn("h-full rounded-full transition-[width] duration-500", job.status === "FAILED" ? "bg-danger" : "bg-primary")}
          style={{ width: `${progress}%` }}
        />
      </div>

      <ol className="mt-3 flex flex-col gap-2.5">
        {job.steps.map((step) => (
          <li key={step.key} className="flex gap-2.5">
            <StepIcon status={step.status} />
            <div className="min-w-0">
              <p className={cn("text-sm leading-snug", step.status === "PENDING" || step.status === "CANCELED" ? "text-muted" : "text-ink")}>
                {step.title}
              </p>
              {step.note && step.status !== "PENDING" ? <p className="text-xs leading-relaxed text-muted">{step.note}</p> : null}
            </div>
          </li>
        ))}
      </ol>

      {job.status === "WAITING" && job.waitingHref ? (
        <Link
          href={job.waitingHref}
          className="mt-4 flex items-center justify-between gap-3 rounded-xl bg-attention-soft px-3.5 py-2.5 text-sm font-semibold text-attention"
        >
          <span>Te espera una aprobación</span>
          <span>Revisar</span>
        </Link>
      ) : null}

      {job.status === "SUCCEEDED" && job.result ? (
        <div className="mt-4 border-t border-line pt-3">
          <p className="text-sm leading-relaxed text-ink">{job.result.summary}</p>
          {job.result.warnings.length > 0 ? (
            <ul className="mt-2 flex flex-col gap-1">
              {job.result.warnings.map((warning) => (
                <li key={warning} className="flex gap-1.5 text-xs leading-relaxed text-attention">
                  <CircleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                  {warning}
                </li>
              ))}
            </ul>
          ) : null}
          {job.result.href && job.result.linkLabel ? (
            <div className="mt-3">
              <ResultLink href={job.result.href} label={job.result.linkLabel} />
            </div>
          ) : null}
        </div>
      ) : null}

      {job.cancellable ? (
        <div className="mt-3 flex justify-end">
          <button
            type="button"
            onClick={() => void cancel()}
            disabled={canceling || demo}
            className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium text-muted transition-colors hover:bg-surface-2 hover:text-ink disabled:opacity-50"
          >
            <X className="size-3.5" aria-hidden />
            {canceling ? "Deteniendo…" : "Detener"}
          </button>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="mt-2 text-xs text-danger">
          {error}
        </p>
      ) : null}
    </section>
  );
}
