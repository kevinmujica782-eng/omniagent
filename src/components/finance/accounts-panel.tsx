"use client";

import { Landmark, RefreshCw, Unplug } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { ACCOUNT_ICON } from "@/components/icons";
import { Chip, IconTile, Progress, buttonClass } from "@/components/ui";
import { apiFetch, errorMessage, sleep } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { ACCOUNT_TYPE_LABEL } from "@/lib/finance-copy";
import { money, plural, relativeDays } from "@/lib/format";
import type { AccountView, BankConnectionView } from "@/types/cards";

type SyncResult = { added: number; modified: number; removed: number };

function syncMessage(result: SyncResult): string {
  if (result.added === 0 && result.modified === 0 && result.removed === 0) return "Ya estaba al día.";
  const parts: string[] = [];
  if (result.added > 0) parts.push(plural(result.added, "movimiento nuevo", "movimientos nuevos"));
  if (result.modified > 0) parts.push(plural(result.modified, "actualizado", "actualizados"));
  if (result.removed > 0) parts.push(plural(result.removed, "eliminado", "eliminados"));
  return `Al día: ${parts.join(", ")}.`;
}

export function AccountRow({ account }: { account: AccountView }) {
  const Icon = ACCOUNT_ICON[account.type] ?? Landmark;
  const isCard = account.type === "CREDIT_CARD";
  const balance = account.currentBalance ?? 0;
  const usePct = isCard && account.creditLimit ? Math.round((balance / account.creditLimit) * 100) : null;
  return (
    <div className="flex items-start gap-3 px-4 py-3">
      <IconTile icon={Icon} size="sm" tone="neutral" />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <p className="truncate text-sm font-medium text-ink">
            {account.name}
            {account.mask ? <span className="text-muted"> ••{account.mask}</span> : null}
          </p>
          {account.currentBalance !== null ? (
            <p className="shrink-0 text-sm font-semibold tabular-nums text-ink">
              {money(balance, account.currency, { cents: true })}
            </p>
          ) : null}
        </div>
        <p className="text-xs text-muted">
          {account.subtype ?? ACCOUNT_TYPE_LABEL[account.type]}
          {isCard && account.currentBalance !== null ? " · saldo por pagar" : ""}
        </p>
        {usePct !== null && account.creditLimit ? (
          <div className="mt-2">
            <Progress
              value={balance}
              max={account.creditLimit}
              tone={usePct >= 70 ? "danger" : usePct >= 30 ? "attention" : "primary"}
              label={`Uso de la tarjeta: ${usePct}%`}
            />
            <p className="mt-1 text-xs text-muted">
              Usas {usePct}% de {money(account.creditLimit, account.currency)}
              {usePct >= 30 ? ". Por debajo de 30% cuida tu historial de crédito." : "."}
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** Cuentas conectadas agrupadas por institución: sincronizar y desconectar (con confirmación). */
export function AccountsPanel({
  connections,
  demo = false,
}: {
  connections: BankConnectionView[];
  demo?: boolean;
}) {
  const router = useRouter();
  const [items, setItems] = useState(connections);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, { tone: "good" | "danger"; text: string }>>({});
  const [, startTransition] = useTransition();

  useEffect(() => setItems(connections), [connections]);

  function note(id: string, tone: "good" | "danger", text: string) {
    setNotes((prev) => ({ ...prev, [id]: { tone, text } }));
  }

  async function sync(connection: BankConnectionView) {
    setBusy(`${connection.id}:sync`);
    try {
      const result: SyncResult = demo
        ? (await sleep(700), { added: 0, modified: 1, removed: 0 })
        : await apiFetch<SyncResult>(`/api/v1/finance/connections/${connection.id}/sync`, { method: "POST" });
      note(connection.id, "good", syncMessage(result));
      setItems((prev) =>
        prev.map((c) => (c.id === connection.id ? { ...c, status: "ACTIVE", lastSyncedAt: new Date().toISOString() } : c)),
      );
      if (!demo) startTransition(() => router.refresh());
    } catch (error) {
      note(connection.id, "danger", errorMessage(error));
    } finally {
      setBusy(null);
    }
  }

  async function disconnect(connection: BankConnectionView) {
    setBusy(`${connection.id}:remove`);
    try {
      if (demo) await sleep(500);
      else await apiFetch(`/api/v1/finance/connections/${connection.id}`, { method: "DELETE" });
      setConfirming(null);
      setItems((prev) => prev.filter((c) => c.id !== connection.id));
      if (!demo) startTransition(() => router.refresh());
    } catch (error) {
      note(connection.id, "danger", errorMessage(error));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {items.map((connection) => {
        const expired = connection.status !== "ACTIVE";
        const itemNote = notes[connection.id];
        return (
          <div key={connection.id} className="overflow-hidden rounded-2xl border border-line bg-surface">
            <div className="flex items-center gap-3 border-b border-line bg-surface-2 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-semibold text-ink">
                  <span>{connection.institutionName}</span>
                  {connection.provider === "sandbox" ? <Chip>Demo</Chip> : null}
                  {expired ? <Chip tone="danger">Requiere reconexión</Chip> : null}
                </p>
                <p className="text-xs text-muted">
                  {busy === `${connection.id}:sync`
                    ? "Sincronizando…"
                    : connection.lastSyncedAt
                      ? `Actualizado ${relativeDays(connection.lastSyncedAt)}`
                      : "Sin sincronizar"}
                </p>
              </div>
              {/* En el móvil solo íconos; el nombre de la acción queda para lectores de pantalla. */}
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => sync(connection)}
                  disabled={busy !== null || expired}
                  aria-label={`Sincronizar ${connection.institutionName}`}
                  className="inline-flex items-center gap-2 rounded-full px-2.5 py-1.5 text-sm font-semibold text-primary transition-colors hover:bg-primary-soft disabled:pointer-events-none disabled:opacity-50 sm:px-3.5"
                >
                  <RefreshCw
                    className={cn("size-4", busy === `${connection.id}:sync` && "animate-spin")}
                    aria-hidden
                  />
                  <span className="hidden sm:inline">Sincronizar</span>
                </button>
                <button
                  type="button"
                  onClick={() => setConfirming(connection.id)}
                  disabled={busy !== null}
                  aria-label={`Desconectar ${connection.institutionName}`}
                  className="inline-flex items-center gap-2 rounded-full px-2.5 py-1.5 text-sm font-semibold text-muted transition-colors hover:bg-danger-soft hover:text-danger disabled:opacity-50 sm:px-3"
                >
                  <Unplug className="size-4" aria-hidden />
                  <span className="hidden sm:inline">Desconectar</span>
                </button>
              </div>
            </div>

            {confirming === connection.id ? (
              <div role="alertdialog" aria-label={`Desconectar ${connection.institutionName}`} className="border-b border-line bg-danger-soft px-4 py-3">
                <p className="text-sm text-danger">
                  ¿Desconectar {connection.institutionName}? Se borran de OmniAgent sus cuentas y movimientos.
                </p>
                <div className="mt-2.5 flex justify-end gap-2">
                  <button type="button" onClick={() => setConfirming(null)} className={buttonClass("secondary", "sm")}>
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={() => disconnect(connection)}
                    disabled={busy !== null}
                    className="rounded-full bg-danger px-3.5 py-1.5 text-sm font-semibold text-on-primary transition-opacity hover:opacity-90 disabled:opacity-50"
                  >
                    {busy === `${connection.id}:remove` ? "Desconectando…" : "Sí, desconectar"}
                  </button>
                </div>
              </div>
            ) : null}

            {itemNote ? (
              <p
                role={itemNote.tone === "danger" ? "alert" : "status"}
                className={cn(
                  "border-b border-line px-4 py-2 text-xs",
                  itemNote.tone === "danger" ? "text-danger" : "text-primary",
                )}
              >
                {itemNote.text}
              </p>
            ) : null}

            <div className="divide-y divide-line">
              {connection.accounts.map((account) => (
                <AccountRow key={account.id} account={account} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
