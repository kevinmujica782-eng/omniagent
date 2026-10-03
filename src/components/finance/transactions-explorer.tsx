"use client";

import { Loader, Search, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type ChangeEvent } from "react";
import { TransactionRow } from "@/components/finance/transaction-row";
import { buttonClass } from "@/components/ui";
import { apiFetch, errorMessage } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { money, plural } from "@/lib/format";
import type { AccountView, TransactionView, TransactionsPageView } from "@/types/cards";

const PAGE_SIZE = 20;

type Filters = { q: string; category: string; type: "" | "gasto" | "ingreso"; accountId: string };

const EMPTY: Filters = { q: "", category: "", type: "", accountId: "" };

function queryString(filters: Filters, offset: number): string {
  const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
  if (filters.q.trim()) params.set("q", filters.q.trim());
  if (filters.category) params.set("category", filters.category);
  if (filters.type) params.set("type", filters.type);
  if (filters.accountId) params.set("accountId", filters.accountId);
  return params.toString();
}

/** En la vista previa se filtra en el navegador con los movimientos de ejemplo. */
function filterLocally(items: TransactionView[], filters: Filters, accounts: AccountView[]): TransactionsPageView {
  const q = filters.q.trim().toLowerCase();
  const account = accounts.find((a) => a.id === filters.accountId);
  const accountLabel = account ? `${account.name}${account.mask ? ` ••${account.mask}` : ""}` : null;
  const matches = items.filter(
    (tx) =>
      (!q || `${tx.merchantName ?? ""} ${tx.description}`.toLowerCase().includes(q)) &&
      (!filters.category || tx.category === filters.category) &&
      (!filters.type || (filters.type === "gasto" ? tx.direction === "DEBIT" : tx.direction === "CREDIT")) &&
      (!accountLabel || tx.accountLabel === accountLabel),
  );
  const sum = (direction: TransactionView["direction"]) =>
    Math.round(matches.filter((tx) => tx.direction === direction).reduce((s, tx) => s + tx.amount, 0) * 100) / 100;
  return { items: matches, nextOffset: null, totalSpent: sum("DEBIT"), totalIncome: sum("CREDIT"), count: matches.length };
}

/** Búsqueda de movimientos con filtros, totales y paginación ("Ver más"). */
export function TransactionsExplorer({
  initial,
  categories,
  accounts,
  timeZone,
  demo = false,
}: {
  initial: TransactionsPageView;
  categories: string[];
  accounts: AccountView[];
  timeZone?: string;
  demo?: boolean;
}) {
  const id = useId();
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [page, setPage] = useState<TransactionsPageView>(initial);
  const [loading, setLoading] = useState<"filter" | "more" | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Filtros de la página que se está mostrando (evita repetir consultas).
  const shownKey = useRef(queryString(EMPTY, 0));

  const currency = accounts[0]?.currency ?? initial.items[0]?.currency ?? "USD";
  const active = filters.q.trim() !== "" || filters.category !== "" || filters.type !== "" || filters.accountId !== "";
  const demoPage = useMemo(
    () => (demo ? filterLocally(initial.items, filters, accounts) : null),
    [demo, initial.items, filters, accounts],
  );

  // Datos nuevos del servidor (p. ej. tras sincronizar): se aplican si no hay filtros activos.
  useEffect(() => {
    if (shownKey.current === queryString(EMPTY, 0)) setPage(initial);
  }, [initial]);

  // Al cambiar los filtros se vuelve a consultar (el texto espera 300 ms a que dejes de escribir).
  useEffect(() => {
    if (demo) return;
    const key = queryString(filters, 0);
    if (key === shownKey.current) {
      setLoading(null); // p. ej. se borró el texto antes de que llegara la respuesta
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading("filter");
      setError(null);
      try {
        const next = await apiFetch<TransactionsPageView>(`/api/v1/finance/transactions?${key}`, {
          signal: controller.signal,
        });
        shownKey.current = key;
        setPage(next);
      } catch (err) {
        if (controller.signal.aborted) return;
        setError(errorMessage(err));
      } finally {
        if (!controller.signal.aborted) setLoading(null);
      }
    }, 300);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [filters, demo]);

  async function loadMore() {
    if (page.nextOffset === null) return;
    setLoading("more");
    setError(null);
    try {
      const next = await apiFetch<TransactionsPageView>(
        `/api/v1/finance/transactions?${queryString(filters, page.nextOffset)}`,
      );
      setPage((prev) => ({ ...next, items: [...prev.items, ...next.items] }));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(null);
    }
  }

  const view = demoPage ?? page;
  const set = <K extends keyof Filters>(key: K, value: Filters[K]) => setFilters((prev) => ({ ...prev, [key]: value }));
  const selectClass =
    "min-w-[6.5rem] flex-1 rounded-full border border-line-strong bg-surface px-3 py-1.5 text-sm text-ink transition-colors hover:bg-surface-2 sm:flex-none";

  return (
    <div>
      <div className="flex flex-col gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
          <label htmlFor={`${id}-q`} className="sr-only">
            Buscar movimientos
          </label>
          <input
            id={`${id}-q`}
            type="search"
            value={filters.q}
            onChange={(event: ChangeEvent<HTMLInputElement>) => set("q", event.target.value)}
            placeholder="Busca un comercio o concepto"
            maxLength={80}
            className="w-full rounded-full border border-line-strong bg-surface py-2 pl-10 pr-10 text-sm text-ink placeholder:text-muted"
          />
          {loading === "filter" ? (
            <Loader className="absolute right-3.5 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted" aria-hidden />
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor={`${id}-category`} className="sr-only">
            Categoría
          </label>
          <select
            id={`${id}-category`}
            value={filters.category}
            onChange={(event: ChangeEvent<HTMLSelectElement>) => set("category", event.target.value)}
            className={selectClass}
          >
            <option value="">Categoría</option>
            {categories.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </select>
          <label htmlFor={`${id}-type`} className="sr-only">
            Tipo
          </label>
          <select
            id={`${id}-type`}
            value={filters.type}
            onChange={(event: ChangeEvent<HTMLSelectElement>) => set("type", event.target.value as Filters["type"])}
            className={selectClass}
          >
            <option value="">Todo</option>
            <option value="gasto">Salidas</option>
            <option value="ingreso">Entradas</option>
          </select>
          {accounts.length > 1 ? (
            <>
              <label htmlFor={`${id}-account`} className="sr-only">
                Cuenta
              </label>
              <select
                id={`${id}-account`}
                value={filters.accountId}
                onChange={(event: ChangeEvent<HTMLSelectElement>) => set("accountId", event.target.value)}
                className={selectClass}
              >
                <option value="">Cuenta</option>
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name}
                    {account.mask ? ` ••${account.mask}` : ""}
                  </option>
                ))}
              </select>
            </>
          ) : null}
          {active ? (
            <button
              type="button"
              onClick={() => setFilters(EMPTY)}
              className="inline-flex items-center gap-1 rounded-full px-2.5 py-1.5 text-sm font-medium text-muted hover:bg-surface-2 hover:text-ink"
            >
              <X className="size-3.5" aria-hidden />
              Limpiar
            </button>
          ) : null}
        </div>
      </div>

      <p className="mt-3 px-1 text-xs text-muted" aria-live="polite">
        {plural(view.count, "movimiento", "movimientos")} · Salió{" "}
        <span className="font-semibold tabular-nums text-ink">{money(view.totalSpent, currency)}</span> · Entró{" "}
        <span className="font-semibold tabular-nums text-primary">{money(view.totalIncome, currency)}</span>
      </p>

      <div
        className={cn(
          "mt-2 divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface transition-opacity",
          loading === "filter" && "opacity-60",
        )}
      >
        {view.items.length > 0 ? (
          view.items.map((tx) => <TransactionRow key={tx.id} tx={tx} timeZone={timeZone} />)
        ) : (
          <p className="px-4 py-8 text-center text-sm text-muted">
            {active ? "No hay movimientos con esos filtros." : "Todavía no hay movimientos."}
          </p>
        )}
      </div>

      {error ? (
        <p role="alert" className="mt-2 px-1 text-sm text-danger">
          {error}
        </p>
      ) : null}

      {view.nextOffset !== null ? (
        <div className="mt-3 flex justify-center">
          <button type="button" onClick={loadMore} disabled={loading !== null} className={buttonClass("secondary", "sm")}>
            {loading === "more" ? "Cargando…" : "Ver más"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
