"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { CardShell, usageLabel } from "@/components/chat/cards";
import { Chip, buttonClass } from "@/components/ui";
import { apiFetch, errorMessage, sleep } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { CADENCE_LABEL, money } from "@/lib/format";
import { monthlyEquivalent } from "@/modules/finance/analyzers";
import type { ApprovalCard, SubscriptionItem, SubscriptionsCard } from "@/types/cards";

type Note = { tone: "good" | "danger"; text: string; approvals?: boolean };

/**
 * Suscripciones con acciones: confirmar si la usas (la señal más confiable) o preparar la baja,
 * que queda en Aprobaciones hasta que la apruebes.
 */
export function SubscriptionsPanel({
  card,
  demo = false,
  className,
}: {
  card: SubscriptionsCard;
  demo?: boolean;
  className?: string;
}) {
  const router = useRouter();
  const [items, setItems] = useState(card.items);
  const [busy, setBusy] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, Note>>({});
  const [, startTransition] = useTransition();

  // Al refrescar la página llegan datos nuevos del servidor.
  useEffect(() => setItems(card.items), [card.items]);

  const monthly = (list: SubscriptionItem[]) =>
    Math.round(list.reduce((sum, item) => sum + monthlyEquivalent(item.amount, item.cadence), 0) * 100) / 100;
  const unused = items.filter((item) => item.status === "UNUSED_SUSPECTED");
  const unusedTotal = monthly(unused);
  const approvalsHref = demo ? "/preview?screen=aprobaciones" : "/aprobaciones";

  function patch(id: string, changes: Partial<SubscriptionItem>) {
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, ...changes } : item)));
  }

  function note(id: string, value: Note | null) {
    setNotes((prev) => {
      const next = { ...prev };
      if (value) next[id] = value;
      else delete next[id];
      return next;
    });
  }

  async function setUsage(item: SubscriptionItem, inUse: boolean) {
    setBusy(`${item.id}:usage`);
    note(item.id, null);
    try {
      if (demo) await sleep(350);
      else await apiFetch(`/api/v1/finance/subscriptions/${item.id}`, { method: "PATCH", body: { inUse } });
      const keep = item.status === "CANCELLATION_REQUESTED";
      patch(item.id, {
        usageSource: "user",
        ...(inUse ? { lastUsedDaysAgo: 0 } : {}),
        ...(keep ? {} : { status: inUse ? "ACTIVE" : "UNUSED_SUSPECTED" }),
      });
    } catch (error) {
      note(item.id, { tone: "danger", text: errorMessage(error) });
    } finally {
      setBusy(null);
    }
  }

  async function prepareCancel(item: SubscriptionItem) {
    setBusy(`${item.id}:cancel`);
    note(item.id, null);
    try {
      let already = false;
      if (demo) {
        await sleep(450);
      } else {
        const result = await apiFetch<{ card: ApprovalCard | null; alreadyRequested: boolean }>(
          `/api/v1/finance/subscriptions/${item.id}/cancel`,
          { method: "POST" },
        );
        already = result.alreadyRequested;
        startTransition(() => router.refresh()); // contador de Aprobaciones del encabezado
      }
      note(item.id, {
        tone: "good",
        text: already ? "La baja ya estaba solicitada." : "Baja lista: apruébala para que Omni la tramite.",
        approvals: !already,
      });
    } catch (error) {
      note(item.id, { tone: "danger", text: errorMessage(error) });
    } finally {
      setBusy(null);
    }
  }

  return (
    <CardShell
      className={className}
      title="Suscripciones"
      aside={
        <span className="text-sm font-semibold tabular-nums text-ink">
          {money(card.monthlyTotal, card.currency, { cents: true })}
          <span className="font-normal text-muted"> al mes</span>
        </span>
      }
    >
      {unused.length > 0 ? (
        <p className="mb-1 rounded-xl bg-attention-soft px-3 py-2 text-sm text-attention">
          {unused.length} sin uso: {money(unusedTotal, card.currency, { cents: true })} al mes que puedes recuperar.
        </p>
      ) : null}
      <ul className="divide-y divide-line">
        {items.map((item) => {
          const unknown = item.status === "ACTIVE" && item.lastUsedDaysAgo === null && item.usageSource === null;
          const isBusy = busy?.startsWith(`${item.id}:`) ?? false;
          const itemNote = notes[item.id];
          return (
            <li key={item.id} className="py-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ink">{item.merchant}</p>
                  <p className={cn("text-xs", item.status === "UNUSED_SUSPECTED" ? "text-attention" : "text-muted")}>
                    {usageLabel(item)}
                  </p>
                </div>
                <p className="shrink-0 text-sm tabular-nums text-ink">
                  {money(item.amount, card.currency, { cents: true })}
                  <span className="text-xs text-muted">/{CADENCE_LABEL[item.cadence]}</span>
                </p>
              </div>

              {item.status === "UNUSED_SUSPECTED" && !itemNote?.approvals ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => prepareCancel(item)}
                    disabled={busy !== null}
                    className={buttonClass("primary", "sm")}
                  >
                    {busy === `${item.id}:cancel` ? "Preparando…" : "Preparar la baja"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setUsage(item, true)}
                    disabled={busy !== null}
                    className={buttonClass("ghost", "sm")}
                  >
                    {busy === `${item.id}:usage` ? "Guardando…" : "Sí la uso"}
                  </button>
                </div>
              ) : null}

              {unknown ? (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className="text-xs text-muted">¿La sigues usando?</span>
                  <button
                    type="button"
                    onClick={() => setUsage(item, true)}
                    disabled={busy !== null}
                    className={buttonClass("secondary", "sm")}
                  >
                    Sí
                  </button>
                  <button
                    type="button"
                    onClick={() => setUsage(item, false)}
                    disabled={busy !== null}
                    className={buttonClass("secondary", "sm")}
                  >
                    No
                  </button>
                  {isBusy ? <span className="text-xs text-muted">Guardando…</span> : null}
                </div>
              ) : null}

              {item.status === "CANCELLATION_REQUESTED" ? (
                <div className="mt-2">
                  <Chip tone="attention">Baja en trámite</Chip>
                </div>
              ) : null}

              {itemNote ? (
                <p
                  role={itemNote.tone === "danger" ? "alert" : "status"}
                  className={cn(
                    "mt-2 flex flex-wrap items-center gap-x-2 text-sm",
                    itemNote.tone === "danger" ? "text-danger" : "font-medium text-primary",
                  )}
                >
                  {itemNote.text}
                  {itemNote.approvals ? (
                    <Link href={approvalsHref} className="inline-flex items-center gap-1 font-semibold underline-offset-2 hover:underline">
                      Revisar
                      <ArrowRight className="size-3.5" aria-hidden />
                    </Link>
                  ) : null}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
    </CardShell>
  );
}
