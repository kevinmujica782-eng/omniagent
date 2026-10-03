"use client";

import { ExternalLink, FlaskConical, Pause, Play, RefreshCw, Sparkles, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, type ChangeEvent, type FormEvent, type ReactNode } from "react";
import { CheckoutButton } from "@/components/concierge/payment-sheet";
import { PriceChart, Sparkline } from "@/components/concierge/price-chart";
import { Dialog } from "@/components/dialog";
import { WATCH_KIND_ICON } from "@/components/icons";
import { Chip, IconTile, INPUT_CLASS, buttonClass } from "@/components/ui";
import { cn } from "@/lib/cn";
import { changeShort, KIND_LABEL, MAX_QUANTITY, METHOD_LABEL, quantityLabel, rowStatus, ruleText, statusLine, whenText } from "@/lib/concierge-copy";
import { money } from "@/lib/format";
import type { CheckoutView, TrackedItemView } from "@/types/cards";

// Lista de lo que Omni vigila y el detalle de cada seguimiento (historial, reglas de aviso y acciones).

type Detail = { item: TrackedItemView; points: { at: string; price: number }[]; stats: { min: number; max: number; median: number; days: number } };

/** Termina en punto sin duplicarlo ("8:15 a. m." ya lo trae). */
const sentence = (text: string) => (text.endsWith(".") ? text : `${text}.`);

function priceText(item: TrackedItemView): string {
  return item.currentPrice === null ? "Sin precio" : money(item.currentPrice, item.currency, { cents: !Number.isInteger(item.currentPrice) });
}

export function TrackedRow({ item, timeZone, onOpen, now }: { item: TrackedItemView; timeZone: string; onOpen: () => void; now: Date }) {
  const Icon = WATCH_KIND_ICON[item.kind];
  const change = changeShort(item.changePct);
  const problem = item.health !== "ok" || item.status !== "ACTIVE";
  const bigDrop = (item.changePct ?? 0) <= -5;
  return (
    <button type="button" onClick={onOpen} className="flex w-full min-w-0 items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-surface-2">
      <IconTile icon={Icon} size="sm" tone={item.status === "ACTIVE" ? "primary" : "neutral"} />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-3">
          <span className="min-w-0 truncate text-sm font-medium text-ink">{item.title}</span>
          <span className="shrink-0 text-sm font-semibold tabular-nums text-ink">{priceText(item)}</span>
        </span>
        <span className="mt-0.5 flex items-baseline justify-between gap-3">
          <span className={cn("min-w-0 truncate text-xs", problem ? "text-attention" : "text-muted")}>
            {item.merchant ?? item.host ?? KIND_LABEL[item.kind]} · {rowStatus(item, now, timeZone)}
          </span>
          {change ? (
            <span
              className={cn("shrink-0 text-xs tabular-nums", bigDrop ? "font-semibold text-primary" : "text-muted")}
              title="Frente al precio normal de 30 días"
            >
              {change}
            </span>
          ) : null}
        </span>
      </span>
      {item.spark.length > 2 ? (
        <Sparkline values={item.spark} reference={item.referencePrice} width={64} height={26} className="hidden sm:block" label={`Precio de ${item.title} en 30 días`} />
      ) : null}
    </button>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5 truncate text-sm font-semibold tabular-nums text-ink">{value}</dd>
    </div>
  );
}

function ItemDialog({
  initial,
  timeZone,
  onClose,
  demo,
  demoPoints,
  demoCheckout,
}: {
  initial: TrackedItemView;
  timeZone: string;
  onClose: () => void;
  demo: boolean;
  demoPoints?: { at: string; price: number }[];
  demoCheckout?: CheckoutView;
}) {
  const router = useRouter();
  const [detail, setDetail] = useState<Detail | null>(
    demo ? { item: initial, points: demoPoints ?? [], stats: { min: 0, max: 0, median: 0, days: 30 } } : null,
  );
  const item = detail?.item ?? initial;
  const [target, setTarget] = useState(item.targetPrice === null ? "" : String(item.targetPrice));
  const [pct, setPct] = useState(item.dropAlertPct);
  const [quantity, setQuantity] = useState(item.quantity);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const m = (n: number) => money(n, item.currency, { cents: !Number.isInteger(n) });

  useEffect(() => {
    if (demo) return;
    let alive = true;
    fetch(`/api/v1/concierge/items/${initial.id}`)
      .then((res) => res.json())
      .then((json) => {
        if (alive && json?.data) setDetail(json.data as Detail);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [demo, initial.id]);

  async function act(name: string, url: string, method: "POST" | "PATCH" | "DELETE", body?: unknown, done?: (data: unknown) => void) {
    setBusy(name);
    setMessage(null);
    if (demo) {
      await new Promise((resolve) => setTimeout(resolve, 350));
      setBusy(null);
      setMessage("Vista previa: no se guardó nada.");
      return;
    }
    try {
      const res = await fetch(url, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setMessage(json?.error?.message ?? "No se pudo completar.");
        return;
      }
      done?.(json?.data);
      router.refresh();
    } catch {
      setMessage("Sin conexión. Inténtalo de nuevo.");
    } finally {
      setBusy(null);
    }
  }

  function refreshItem(next: TrackedItemView) {
    setDetail((d) => (d ? { ...d, item: next } : d));
  }

  const values = detail?.points.map((p) => p.price) ?? [];
  const low = values.length ? Math.min(...values) : item.lowestPrice;
  const high = values.length ? Math.max(...values) : item.highestPrice;
  const active = item.status === "ACTIVE";
  const canEdit = item.status === "ACTIVE" || item.status === "PAUSED";
  const automatic = item.source !== "manual";
  const buttons: ReactNode[] = [];
  if (active && automatic) {
    buttons.push(
      <button
        key="check"
        type="button"
        disabled={busy !== null}
        className={buttonClass("secondary", "sm")}
        onClick={() =>
          act("check", `/api/v1/concierge/items/${item.id}/check`, "POST", undefined, (data) => {
            const result = data as { item: TrackedItemView; message: string };
            refreshItem(result.item);
            setMessage(result.message);
          })
        }
      >
        <RefreshCw className="size-4" aria-hidden />
        {busy === "check" ? "Revisando…" : "Revisar ahora"}
      </button>,
    );
  }
  if (active && item.source === "sandbox") {
    buttons.push(
      <button
        key="simulate"
        type="button"
        disabled={busy !== null}
        className={buttonClass("secondary", "sm")}
        onClick={() =>
          act("simulate", `/api/v1/concierge/items/${item.id}/simulate-drop`, "POST", undefined, (data) => {
            const result = data as { item: TrackedItemView; message: string };
            refreshItem(result.item);
            setMessage(result.message);
          })
        }
      >
        <FlaskConical className="size-4" aria-hidden />
        {busy === "simulate" ? "Probando…" : "Probar una bajada"}
      </button>,
    );
  }
  if (canEdit) {
    buttons.push(
      <button
        key="pause"
        type="button"
        disabled={busy !== null}
        className={buttonClass("secondary", "sm")}
        onClick={() =>
          act("pause", `/api/v1/concierge/items/${item.id}`, "PATCH", { status: active ? "PAUSED" : "ACTIVE" }, (data) => refreshItem(data as TrackedItemView))
        }
      >
        {active ? <Pause className="size-4" aria-hidden /> : <Play className="size-4" aria-hidden />}
        {active ? "Pausar" : "Reanudar"}
      </button>,
    );
  }

  return (
    <Dialog title={KIND_LABEL[item.kind]} onClose={onClose} className="sm:max-w-lg">
      <div className="flex flex-col gap-4">
        <div>
          <p className="text-xs text-muted">{item.merchant ?? item.host}</p>
          <p className="mt-0.5 text-lg font-semibold leading-snug text-ink">{item.title}</p>
          {item.detail ? <p className="mt-0.5 text-sm text-muted">{item.detail}</p> : null}
          <div className="mt-2 flex flex-wrap gap-1.5">
            {item.source === "sandbox" ? <Chip tone="attention">Tienda de prueba</Chip> : null}
            {item.method ? (
              <Chip tone={item.method === "ai" ? "good" : "neutral"}>
                {item.method === "ai" ? <Sparkles className="size-3" aria-hidden /> : null}
                {METHOD_LABEL[item.method]}
              </Chip>
            ) : null}
            {item.inStock === false ? <Chip tone="danger">Agotado</Chip> : null}
            {item.status !== "ACTIVE" ? <Chip>{item.status === "PAUSED" ? "Pausado" : item.status === "PURCHASED" ? "Comprado" : "Archivado"}</Chip> : null}
          </div>
        </div>

        {detail ? (
          <PriceChart points={detail.points} currency={item.currency} reference={item.referencePrice} target={item.targetPrice} timeZone={timeZone} />
        ) : (
          <div className="h-[200px] animate-pulse rounded-2xl bg-surface-2" aria-label="Cargando el historial" />
        )}

        <dl className="grid grid-cols-4 gap-3 rounded-2xl bg-surface-2 px-4 py-3">
          <Stat label="Hoy" value={priceText(item)} />
          <Stat label="Normal" value={item.referencePrice !== null ? m(item.referencePrice) : "—"} />
          <Stat label="Mínimo" value={low !== null && low !== undefined ? m(low) : "—"} />
          <Stat label="Máximo" value={high !== null && high !== undefined ? m(high) : "—"} />
        </dl>

        <p className="text-sm leading-relaxed text-muted">
          {sentence(
            `${statusLine(item, new Date(), timeZone)}${item.lastCheckedAt ? ` · última revisión ${whenText(item.lastCheckedAt, new Date(), timeZone)}` : ""}`,
          )}
          {item.lastError && item.health !== "ok" ? ` ${item.lastError}` : ""}
        </p>

        {canEdit ? (
          <form
            className="flex flex-col gap-3 rounded-2xl border border-line px-4 py-4"
            onSubmit={(event: FormEvent<HTMLFormElement>) => {
              event.preventDefault();
              const targetPrice = target.trim() ? Number(target.replace(",", ".")) : null;
              if (targetPrice !== null && !(targetPrice > 0)) {
                setMessage("Escribe un precio objetivo válido o déjalo vacío.");
                return;
              }
              void act("save", `/api/v1/concierge/items/${item.id}`, "PATCH", { targetPrice, dropAlertPct: pct, quantity }, (data) => {
                refreshItem(data as TrackedItemView);
                setMessage("Guardado.");
              });
            }}
          >
            <p className="text-sm font-semibold text-ink">Cuándo avisarte</p>
            <p className="-mt-2 text-xs text-muted">{ruleText(item.dropAlertPct, item.targetPrice, item.currency)}.</p>
            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-muted">Si baja (vs. lo normal)</span>
                <select value={pct} onChange={(event: ChangeEvent<HTMLSelectElement>) => setPct(Number(event.target.value))} className={INPUT_CLASS}>
                  {[5, 10, 15, 20, 25, 30, 40].map((n) => (
                    <option key={n} value={n}>
                      {n}%
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-muted">Precio objetivo</span>
                <input value={target} onChange={(event: ChangeEvent<HTMLInputElement>) => setTarget(event.target.value)} inputMode="decimal" placeholder="Opcional" className={INPUT_CLASS} />
              </label>
              {item.kind !== "PRODUCT" ? (
                <label className="flex flex-col gap-1.5">
                  <span className="text-xs font-medium text-muted">{quantityLabel(item.kind)}</span>
                  <select value={quantity} onChange={(event: ChangeEvent<HTMLSelectElement>) => setQuantity(Number(event.target.value))} className={INPUT_CLASS}>
                    {Array.from({ length: MAX_QUANTITY }, (_, i) => i + 1).map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
            </div>
            <button type="submit" disabled={busy !== null} className={cn(buttonClass("secondary", "sm"), "self-start")}>
              {busy === "save" ? "Guardando…" : "Guardar"}
            </button>
          </form>
        ) : null}

        {message ? (
          <p role="status" className="rounded-2xl bg-primary-soft px-4 py-3 text-sm text-primary">
            {message}
          </p>
        ) : null}

        <div className="flex flex-wrap gap-2">
          {canEdit && automatic && item.currentPrice !== null && item.inStock !== false ? (
            <CheckoutButton itemId={item.id} label="Comprar" demo={demo} demoCheckout={demoCheckout} />
          ) : null}
          {buttons}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
          {item.url && item.source === "web" ? (
            <a href={item.url} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary">
              <ExternalLink className="size-4" aria-hidden />
              Abrir en la tienda
            </a>
          ) : (
            <span className="text-xs text-muted">{item.source === "sandbox" ? "Tienda ficticia: no existe en internet." : "Sin enlace."}</span>
          )}
          {item.status !== "ARCHIVED" ? (
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => {
                if (!demo && !window.confirm("¿Dejar de seguir este precio? El historial y los pedidos se conservan.")) return;
                void act("delete", `/api/v1/concierge/items/${item.id}`, "DELETE", undefined, () => onClose());
              }}
              className="inline-flex items-center gap-1.5 text-sm font-semibold text-danger"
            >
              <Trash2 className="size-4" aria-hidden />
              Dejar de seguir
            </button>
          ) : null}
        </div>
      </div>
    </Dialog>
  );
}

export function TrackedList({
  items,
  timeZone,
  demo = false,
  demoPoints,
  demoCheckout,
  openId = null,
}: {
  items: TrackedItemView[];
  timeZone: string;
  demo?: boolean;
  demoPoints?: Record<string, { at: string; price: number }[]>;
  demoCheckout?: CheckoutView;
  /** Abre este seguimiento al cargar (enlaces desde avisos: /compras?producto=…). */
  openId?: string | null;
}) {
  const [open, setOpen] = useState<TrackedItemView | null>(() => items.find((i) => i.id === openId) ?? null);
  const now = new Date();
  return (
    <>
      <div className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
        {items.map((item) => (
          <TrackedRow key={item.id} item={item} timeZone={timeZone} now={now} onOpen={() => setOpen(item)} />
        ))}
      </div>
      {open ? (
        <ItemDialog
          initial={open}
          timeZone={timeZone}
          onClose={() => setOpen(null)}
          demo={demo}
          demoPoints={demoPoints?.[open.id]}
          demoCheckout={demoCheckout}
        />
      ) : null}
    </>
  );
}
