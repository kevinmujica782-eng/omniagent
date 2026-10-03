"use client";

import {
  CircleAlert,
  Clock,
  Ellipsis,
  Loader,
  PackageCheck,
  PackageX,
  Pencil,
  Send,
  Trash2,
  Truck,
  Undo2,
  type LucideIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { MetaLine } from "@/components/returns/meta-line";
import { OrderFormDialog } from "@/components/returns/order-form";
import { ProblemButton } from "@/components/returns/problem-sheet";
import { Chip, IconTile, buttonClass } from "@/components/ui";
import { apiFetch, errorMessage } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { money } from "@/lib/format";
import { deliveryLine } from "@/lib/returns-copy";
import type { DeliveryKindId, TrackedOrderView } from "@/types/cards";

// Un pedido en la lista: dónde va, hasta cuándo se puede devolver y lo que se puede hacer (reclamar, marcar que llegó,
// corregir sus datos o dejar de seguirlo). Con `demo` no llama a la API (vista previa).

const DELIVERY_ICON: Record<DeliveryKindId, LucideIcon> = {
  on_the_way: Truck,
  due_today: Clock,
  late: CircleAlert,
  delivered: PackageCheck,
  canceled: PackageX,
};

const SOURCE_LABEL: Record<TrackedOrderView["source"], string | null> = {
  OMNIAGENT: "Comprado con Omni",
  EMAIL: "De tu correo",
  MANUAL: null,
  EXAMPLE: "Ejemplo",
};

function MoreMenu({ items }: { items: { label: string; icon: LucideIcon; onClick: () => void; danger?: boolean }[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label="Más opciones"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="grid size-8 place-items-center rounded-full text-muted transition-colors hover:bg-surface-2 hover:text-ink"
      >
        <Ellipsis className="size-4" aria-hidden />
      </button>
      {open ? (
        <div role="menu" className="absolute right-0 top-full z-20 mt-1 w-52 overflow-hidden rounded-2xl border border-line bg-surface py-1 shadow-float">
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                item.onClick();
              }}
              className={cn("flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-surface-2", item.danger ? "text-danger" : "text-ink")}
            >
              <item.icon className="size-4" aria-hidden />
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function OrderRow({
  order,
  timeZone,
  currency,
  mailboxConnected,
  demo = false,
  highlight = false,
  openProblem = false,
}: {
  order: TrackedOrderView;
  timeZone: string;
  currency: string;
  mailboxConnected: boolean;
  demo?: boolean;
  highlight?: boolean;
  /** Vista previa: la hoja del problema abierta. */
  openProblem?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const Icon = DELIVERY_ICON[order.delivery];
  const late = order.delivery === "late";
  const delivered = order.delivery === "delivered";
  const pending = order.status === "ORDERED" || order.status === "SHIPPED";
  const source = SOURCE_LABEL[order.source];

  useEffect(() => {
    if (highlight) ref.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [highlight]);

  async function patch(action: "delivered" | "dismiss" | "restore" | "delete", done: string) {
    setError(null);
    setNotice(null);
    if (demo) {
      setNotice(`${done} (Vista previa: nada se guarda.)`);
      return;
    }
    setBusy(action);
    try {
      await apiFetch(`/api/v1/returns/orders/${order.id}`, action === "delete" ? { method: "DELETE" } : { method: "PATCH", body: { action } });
      setNotice(done);
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  const menu = [
    { label: "Corregir datos", icon: Pencil, onClick: () => setEditing(true) },
    ...(order.dismissed
      ? [{ label: "Volver a seguirlo", icon: Undo2, onClick: () => patch("restore", "Volviste a seguir este pedido.") }]
      : [{ label: "Dejar de seguirlo", icon: PackageX, onClick: () => patch("dismiss", "Ya no lo sigues: no habrá avisos de este pedido.") }]),
    ...(order.source === "MANUAL" || order.source === "EXAMPLE"
      ? [{ label: "Borrar pedido", icon: Trash2, danger: true, onClick: () => patch("delete", "Pedido borrado.") }]
      : []),
  ];

  return (
    <div ref={ref} className={cn("flex flex-col gap-3 px-4 py-3.5", highlight && "bg-primary-soft")}>
      <div className="flex items-start gap-3">
        <IconTile icon={Icon} size="sm" tone={late ? "attention" : delivered ? "primary" : "neutral"} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <p className="min-w-0 text-sm font-medium leading-snug text-ink">{order.title}</p>
            {order.total !== null ? <p className="shrink-0 text-sm font-semibold tabular-nums text-ink">{money(order.total, order.currency, { cents: true })}</p> : null}
          </div>
          <MetaLine
            className="mt-0.5"
            parts={[
              order.merchant,
              // "Pedido 88213" ya dice el número.
              order.orderNumber && !order.title.includes(order.orderNumber) ? `#${order.orderNumber}` : null,
              order.carrier && order.carrier !== order.merchant ? `con ${order.carrier}` : null,
            ]}
          />
          <p className={cn("mt-1 text-xs leading-snug", late ? "font-semibold text-attention" : "text-muted")}>{deliveryLine(order, timeZone)}</p>
          {source ? (
            <div className="mt-1.5">
              <Chip tone={order.source === "EXAMPLE" ? "attention" : "neutral"}>{source}</Chip>
            </div>
          ) : null}
        </div>
        <MoreMenu items={menu} />
      </div>

      {!order.openCase && !order.dismissed && order.delivery !== "canceled" ? (
        <div className="flex flex-wrap gap-2 pl-11">
          {late ? (
            <ProblemButton
              order={order}
              timeZone={timeZone}
              mailboxConnected={mailboxConnected}
              label={order.likelyLost ? "Reclamar: no llegó" : "Reclamar el retraso"}
              variant="primary"
              icon={<Send className="size-4" aria-hidden />}
              demo={demo}
              initialOpen={openProblem}
            />
          ) : null}
          {delivered && order.lastOutcome !== "REFUND" && order.lastOutcome !== "STORE_CREDIT" && (order.returnDaysLeft === null || order.returnDaysLeft >= 0) ? (
            <ProblemButton
              order={order}
              timeZone={timeZone}
              mailboxConnected={mailboxConnected}
              label="Tengo un problema"
              demo={demo}
              initialOpen={openProblem}
            />
          ) : null}
          {pending ? (
            <button type="button" onClick={() => patch("delivered", "¡Qué bien! Lo marqué como entregado.")} disabled={busy !== null} className={buttonClass(late ? "secondary" : "ghost", "sm")}>
              {busy === "delivered" ? <Loader className="size-4 animate-spin" aria-hidden /> : <PackageCheck className="size-4" aria-hidden />}
              Ya llegó
            </button>
          ) : null}
        </div>
      ) : null}

      {notice ? (
        <p role="status" className="ml-11 rounded-xl bg-primary-soft px-3 py-2 text-sm text-primary">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="ml-11 rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      ) : null}
      {editing ? <OrderFormDialog mode="edit" order={order} timeZone={timeZone} currency={currency} onClose={() => setEditing(false)} demo={demo} /> : null}
    </div>
  );
}
