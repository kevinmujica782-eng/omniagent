import { Chip } from "@/components/ui";
import { cn } from "@/lib/cn";
import { money, shortDate } from "@/lib/format";
import type { TransactionView } from "@/types/cards";

/** Fila de movimiento: comercio, categoría, cuenta y fecha, y el monto con signo. Sin estado (sirve en chat y en Finanzas). */
export function TransactionRow({
  tx,
  timeZone,
  showAccount = true,
  className,
}: {
  tx: TransactionView;
  timeZone?: string;
  showAccount?: boolean;
  className?: string;
}) {
  const credit = tx.direction === "CREDIT";
  // La fecha va primero: si la línea no cabe, se recorta la cuenta y no la fecha.
  const meta = [shortDate(tx.postedAt, timeZone), tx.category ?? "Sin categoría", showAccount ? tx.accountLabel : null]
    .filter(Boolean)
    .join(" · ");
  return (
    <div className={cn("flex items-center gap-3 px-4 py-3", className)}>
      <div className="min-w-0 flex-1">
        <p className="flex min-w-0 items-center gap-2 text-sm font-medium text-ink">
          <span className="truncate">{tx.merchantName ?? tx.description}</span>
          {tx.pending ? <Chip>Pendiente</Chip> : null}
        </p>
        <p className="truncate text-xs text-muted">{meta}</p>
      </div>
      <p className={cn("shrink-0 text-sm font-semibold tabular-nums", credit ? "text-primary" : "text-ink")}>
        {credit ? "+" : "−"}
        {money(tx.amount, tx.currency, { cents: true })}
      </p>
    </div>
  );
}
