"use client";

import { Plus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useState, useTransition, type ChangeEvent, type FormEvent } from "react";
import { BudgetRow, CardShell } from "@/components/chat/cards";
import { buttonClass } from "@/components/ui";
import { apiFetch, errorMessage, sleep } from "@/lib/api-client";
import { isNeutralCategory } from "@/modules/finance/categories";
import type { BudgetView } from "@/types/cards";

/** Presupuestos mensuales por categoría: crear, ver el avance del mes y quitar. */
export function BudgetsPanel({
  budgets,
  categories,
  currency,
  demo = false,
  className,
}: {
  budgets: BudgetView[];
  categories: string[];
  currency: string;
  demo?: boolean;
  className?: string;
}) {
  const router = useRouter();
  const formId = useId();
  const [items, setItems] = useState(budgets);
  const [adding, setAdding] = useState(false);
  const [category, setCategory] = useState("");
  const [limit, setLimit] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  useEffect(() => setItems(budgets), [budgets]);

  const options = categories.filter((c) => !isNeutralCategory(c) && !items.some((b) => b.category === c));

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const monthlyLimit = Number(limit.replace(",", "."));
    if (!category || !Number.isFinite(monthlyLimit) || monthlyLimit <= 0) {
      setError("Elige una categoría y un monto mayor que cero.");
      return;
    }
    setBusy("save");
    setError(null);
    try {
      if (demo) {
        await sleep(350);
        setItems((prev) => [
          ...prev,
          { id: `demo-${category}`, category, currency, monthlyLimit, spent: 0, pct: 0, state: "ok" },
        ]);
      } else {
        await apiFetch<BudgetView>("/api/v1/finance/budgets", { method: "POST", body: { category, monthlyLimit } });
        startTransition(() => router.refresh());
      }
      setAdding(false);
      setCategory("");
      setLimit("");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function remove(budget: BudgetView) {
    setBusy(budget.id);
    setError(null);
    try {
      if (demo) await sleep(250);
      else await apiFetch(`/api/v1/finance/budgets/${budget.id}`, { method: "DELETE" });
      setItems((prev) => prev.filter((b) => b.id !== budget.id));
      if (!demo) startTransition(() => router.refresh());
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <CardShell
      className={className}
      title="Presupuestos del mes"
      aside={
        !adding && options.length > 0 ? (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline"
          >
            <Plus className="size-4" aria-hidden />
            Añadir
          </button>
        ) : undefined
      }
    >
      {items.length === 0 && !adding ? (
        <p className="text-sm leading-relaxed text-muted">
          Ponle un tope a una categoría y te aviso cuando llegues al 80%. También puedes aceptar las recomendaciones de
          Omni.
        </p>
      ) : null}

      {items.length > 0 ? (
        <div className="divide-y divide-line">
          {items.map((budget) => (
            <BudgetRow
              key={budget.id}
              budget={budget}
              action={
                <button
                  type="button"
                  onClick={() => remove(budget)}
                  disabled={busy !== null}
                  aria-label={`Quitar el presupuesto de ${budget.category}`}
                  className="grid size-6 place-items-center rounded-full text-muted transition-colors hover:bg-surface-2 hover:text-ink disabled:opacity-50"
                >
                  <X className="size-3.5" aria-hidden />
                </button>
              }
            />
          ))}
        </div>
      ) : null}

      {adding ? (
        <form onSubmit={save} className="mt-3 rounded-2xl bg-surface-2 p-3" aria-label="Nuevo presupuesto">
          <div className="grid gap-2 sm:grid-cols-[1fr_8rem]">
            <label className="sr-only" htmlFor={`${formId}-category`}>
              Categoría
            </label>
            <select
              id={`${formId}-category`}
              value={category}
              onChange={(event: ChangeEvent<HTMLSelectElement>) => setCategory(event.target.value)}
              className="rounded-xl border border-line-strong bg-surface px-3 py-2 text-sm text-ink"
            >
              <option value="">Elige una categoría</option>
              {options.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
            <label className="sr-only" htmlFor={`${formId}-limit`}>
              Límite al mes
            </label>
            <input
              id={`${formId}-limit`}
              inputMode="decimal"
              placeholder="Límite al mes"
              value={limit}
              onChange={(event: ChangeEvent<HTMLInputElement>) => setLimit(event.target.value.replace(/[^\d.,]/g, ""))}
              className="rounded-xl border border-line-strong bg-surface px-3 py-2 text-sm tabular-nums text-ink placeholder:text-muted"
            />
          </div>
          <div className="mt-2.5 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setAdding(false);
                setError(null);
              }}
              className={buttonClass("ghost", "sm")}
            >
              Cancelar
            </button>
            <button type="submit" disabled={busy !== null} className={buttonClass("primary", "sm")}>
              {busy === "save" ? "Guardando…" : "Guardar"}
            </button>
          </div>
        </form>
      ) : null}

      {error ? (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      ) : null}
    </CardShell>
  );
}
