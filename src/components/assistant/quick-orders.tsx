"use client";

import { BookmarkPlus, Inbox, ListChecks, Tag, Truck, Wallet, type LucideIcon } from "lucide-react";
import { plural } from "@/lib/format";

/** Lo que hay en vivo en cada área (los mismos contadores del menú). */
export interface LiveCounts {
  approvals: number;
  procedures: number;
  offers: number;
  orders: number;
}

export interface QuickOrder {
  id: string;
  /** La orden, en imperativo. */
  label: string;
  /** Lo que recibe Omni. */
  prompt: string;
  icon: LucideIcon;
  /** send: se envía al tocarla. draft: queda escrita para completarla (qué producto, qué recordar). */
  mode: "send" | "draft";
  count?: keyof LiveCounts;
  countText?: (n: number) => string;
}

export const QUICK_ORDERS: QuickOrder[] = [
  {
    id: "pendiente",
    label: "¿Qué tengo pendiente?",
    prompt: "¿Qué tengo pendiente por aprobar o por hacer esta semana?",
    icon: ListChecks,
    mode: "send",
    count: "approvals",
    countText: (n) => `${n} por aprobar`,
  },
  {
    id: "correo",
    label: "Revisa mi correo",
    prompt: "Revisa mi correo y dime qué trámites tengo",
    icon: Inbox,
    mode: "send",
    count: "procedures",
    countText: (n) => `${n} por confirmar`,
  },
  {
    id: "gastos",
    label: "Analiza mis gastos",
    prompt: "¿A dónde se fue mi dinero este mes?",
    icon: Wallet,
    mode: "send",
  },
  {
    id: "precio",
    label: "Vigila un precio",
    prompt: "Vigila el precio de ",
    icon: Tag,
    mode: "draft",
    count: "offers",
    countText: (n) => plural(n, "oferta nueva", "ofertas nuevas"),
  },
  {
    id: "pedidos",
    label: "Rastrea mis pedidos",
    prompt: "¿Dónde están mis pedidos?",
    icon: Truck,
    mode: "send",
    count: "orders",
    countText: (n) => `${n} por revisar`,
  },
  {
    id: "recuerda",
    label: "Recuerda algo",
    prompt: "Recuerda que ",
    icon: BookmarkPlus,
    mode: "draft",
  },
];

/**
 * Órdenes rápidas: una lista (no tarjetas sueltas) donde cada orden trae lo que hay en vivo en su área.
 * Solo se muestran cuando Omni puede recibir una orden (no mientras escucha ni mientras procesa).
 */
export function QuickOrders({ counts, onOrder }: { counts: LiveCounts; onOrder: (order: QuickOrder) => void }) {
  return (
    <section aria-labelledby="omni-quick-orders" className="assistant-reveal mt-8">
      <h3 id="omni-quick-orders" className="px-1 text-sm font-medium text-muted">
        Órdenes rápidas
      </h3>
      <ul className="mt-2 divide-y divide-line overflow-hidden rounded-3xl border border-line bg-surface/70">
        {QUICK_ORDERS.map((order) => {
          const Icon = order.icon;
          const n = order.count ? counts[order.count] : 0;
          return (
            <li key={order.id}>
              <button
                type="button"
                onClick={() => onOrder(order)}
                className="flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-2 focus-visible:bg-surface-2"
              >
                <Icon className="size-5 shrink-0 text-primary" aria-hidden />
                <span className="min-w-0 flex-1 text-[15px] font-medium text-ink">{order.label}</span>
                {n > 0 && order.countText ? (
                  <span className="shrink-0 rounded-full bg-attention-soft px-2.5 py-0.5 text-xs font-semibold tabular-nums text-attention">
                    {order.countText(n)}
                  </span>
                ) : order.mode === "draft" ? (
                  <span className="shrink-0 text-xs text-muted">Completa la orden</span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
