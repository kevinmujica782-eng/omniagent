"use client";

import { FileText, Undo2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { AccountRow } from "@/components/finance/accounts-panel";
import { ImportStatementButton } from "@/components/finance/import-statement-button";
import { Chip, buttonClass } from "@/components/ui";
import { apiFetch, errorMessage, sleep } from "@/lib/api-client";
import { plural, shortDate } from "@/lib/format";
import type { StatementAccountView, StatementImportView } from "@/types/cards";

const day = (iso: string | null) => (iso ? shortDate(`${iso}T00:00:00Z`, "UTC") : "");

function periodOf(entry: StatementImportView): string {
  if (entry.periodStart && entry.periodEnd) return `${day(entry.periodStart)} – ${day(entry.periodEnd)}`;
  return day(entry.periodEnd ?? entry.periodStart) || "Sin periodo";
}

/**
 * Debajo del nombre de la cuenta: el saldo de una cuenta importada no se actualiza solo, así que se dice de qué
 * fecha es (el cierre del estado de cuenta más reciente). Sin saldo, cuántos movimientos hay.
 */
function accountNote(item: StatementAccountView): string {
  const latest = item.imports
    .filter((entry) => entry.status === "PARSED" && entry.periodEnd)
    .map((entry) => entry.periodEnd!)
    .sort()
    .at(-1);
  if (item.account.currentBalance !== null && latest) {
    return item.account.type === "CREDIT_CARD" ? `Corte del ${day(latest)}` : `Saldo al ${day(latest)}`;
  }
  const rows = item.imports.reduce((sum, entry) => sum + entry.rowsImported, 0);
  return plural(rows, "movimiento importado", "movimientos importados");
}

/** Cuentas cargadas con estados de cuenta: sus archivos importados y "deshacer" (con confirmación). */
export function StatementAccountsPanel({
  items,
  defaultCurrency,
  demo = false,
}: {
  items: StatementAccountView[];
  defaultCurrency: string;
  demo?: boolean;
}) {
  const router = useRouter();
  const [list, setList] = useState(items);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [failure, setFailure] = useState<{ id: string; text: string } | null>(null);
  const [, startTransition] = useTransition();

  useEffect(() => setList(items), [items]);
  const accounts = list.map((item) => item.account);

  async function undo(entry: StatementImportView) {
    setBusy(entry.id);
    setFailure(null);
    try {
      if (demo) await sleep(400);
      else await apiFetch(`/api/v1/finance/statements/${entry.id}`, { method: "DELETE" });
      setConfirming(null);
      // Sin importaciones, la cuenta manual se elimina (igual que en el servidor).
      setList((prev) =>
        prev
          .map((item) => ({ ...item, imports: item.imports.filter((other) => other.id !== entry.id) }))
          .filter((item) => item.imports.length > 0),
      );
      if (!demo) startTransition(() => router.refresh());
    } catch (error) {
      setFailure({ id: entry.id, text: errorMessage(error) });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {list.map((item) => {
        const { account, imports } = item;
        return (
        <div key={account.id} className="overflow-hidden rounded-2xl border border-line bg-surface">
          <div className="flex items-center gap-3 border-b border-line bg-surface-2 px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-semibold text-ink">
                <span>{account.institutionName}</span>
                <Chip>Estado de cuenta</Chip>
              </p>
              <p className="text-xs text-muted">{plural(imports.length, "archivo importado", "archivos importados")}</p>
            </div>
            <ImportStatementButton
              label="Subir otro"
              variant="ghost"
              size="sm"
              accounts={accounts}
              defaultCurrency={defaultCurrency}
              presetAccountId={account.id}
              demo={demo}
            />
          </div>

          <AccountRow account={{ ...account, subtype: accountNote(item) }} />

          <ul className="divide-y divide-line border-t border-line">
            {imports.map((entry) => (
              <li key={entry.id} className="px-4 py-2.5">
                <div className="flex items-center gap-3">
                  <FileText className="size-4 shrink-0 text-muted" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-ink">{entry.fileName}</p>
                    <p className="text-xs text-muted">
                      {periodOf(entry)} · {plural(entry.rowsImported, "movimiento", "movimientos")}
                      {entry.status === "FAILED" ? " · no se pudo importar" : ""}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setConfirming(entry.id)}
                    disabled={busy !== null}
                    aria-label={`Deshacer la importación de ${entry.fileName}`}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1.5 text-sm font-semibold text-muted transition-colors hover:bg-danger-soft hover:text-danger disabled:opacity-50"
                  >
                    <Undo2 className="size-4" aria-hidden />
                    <span className="hidden sm:inline">Deshacer</span>
                  </button>
                </div>

                {confirming === entry.id ? (
                  <div role="alertdialog" aria-label={`Deshacer ${entry.fileName}`} className="mt-2.5 rounded-xl bg-danger-soft px-3 py-2.5">
                    <p className="text-sm text-danger">
                      ¿Deshacer esta importación? Se borran sus {plural(entry.rowsImported, "movimiento", "movimientos")} de
                      OmniAgent{imports.length === 1 ? " y la cuenta" : ""}.
                    </p>
                    <div className="mt-2 flex justify-end gap-2">
                      <button type="button" onClick={() => setConfirming(null)} className={buttonClass("secondary", "sm")}>
                        Cancelar
                      </button>
                      <button
                        type="button"
                        onClick={() => undo(entry)}
                        disabled={busy !== null}
                        className="rounded-full bg-danger px-3.5 py-1.5 text-sm font-semibold text-on-danger transition-opacity hover:opacity-90 disabled:opacity-50"
                      >
                        {busy === entry.id ? "Deshaciendo…" : "Sí, deshacer"}
                      </button>
                    </div>
                  </div>
                ) : null}
                {failure?.id === entry.id ? (
                  <p role="alert" className="mt-1.5 text-xs text-danger">
                    {failure.text}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
        );
      })}
    </div>
  );
}
