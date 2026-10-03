"use client";

import { CircleCheck, Link2, Search, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type ChangeEvent, type FormEvent, type ReactNode } from "react";
import { Sparkline } from "@/components/concierge/price-chart";
import { Dialog } from "@/components/dialog";
import { WATCH_KIND_ICON } from "@/components/icons";
import { Chip, IconTile, INPUT_CLASS, buttonClass } from "@/components/ui";
import { cn } from "@/lib/cn";
import { KIND_LABEL, METHOD_LABEL, MAX_QUANTITY, SENSITIVITY_OPTIONS, frequencyText, looksLikeUrl, quantityLabel, ruleText } from "@/lib/concierge-copy";
import { money, plural } from "@/lib/format";
import type { ProductPreviewView, TrackedItemView } from "@/types/cards";

// "Seguir un precio": pegar un enlace (o buscar en las tiendas de prueba) → vista previa con el precio de hoy →
// elegir cuándo avisar (sensibilidad y precio objetivo) → listo. Nada se compra aquí.

type Step = { kind: "find" } | { kind: "preview"; preview: ProductPreviewView } | { kind: "done"; item: TrackedItemView };

const QUICK = ["Audífonos", "Cine el sábado", "Vuelo a Bogotá", "Hotel en Cartagena"];

type ApiResult<T> = { ok: true; data: T } | { ok: false; message: string; code?: string };

async function call<T>(url: string, init?: RequestInit): Promise<ApiResult<T>> {
  try {
    const res = await fetch(url, init);
    const json = await res.json().catch(() => null);
    if (!res.ok) return { ok: false, message: json?.error?.message ?? "No se pudo completar.", code: json?.error?.code };
    return { ok: true, data: json.data as T };
  } catch {
    return { ok: false, message: "Sin conexión. Inténtalo de nuevo." };
  }
}

const fold = (text: string) =>
  text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

/** Búsqueda local (vista previa): palabras de más de 3 letras en el título, la tienda o el tipo. */
function filterCatalog(catalog: ProductPreviewView[], query: string): ProductPreviewView[] {
  const words = fold(query)
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 3);
  return catalog.filter((item) => {
    const haystack = fold(`${item.title ?? ""} ${item.merchant ?? ""} ${KIND_LABEL[item.kind]} ${item.detail ?? ""}`);
    return words.some((w) => haystack.includes(w.slice(0, Math.max(4, w.length - 2))));
  });
}

const postJson = (body: unknown): RequestInit => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

function stockText(preview: Pick<ProductPreviewView, "inStock" | "stockCount" | "kind">): string | null {
  if (preview.inStock === false) return "Agotado por ahora";
  if (preview.stockCount !== null && preview.stockCount <= 20) {
    const unit = preview.kind === "EVENT_TICKET" ? ["entrada", "entradas"] : preview.kind === "HOTEL" ? ["habitación", "habitaciones"] : preview.kind === "FLIGHT" ? ["asiento", "asientos"] : ["unidad", "unidades"];
    return `Quedan ${plural(preview.stockCount, unit[0], unit[1])}`;
  }
  return null;
}

export function PreviewCard({ preview, children }: { preview: ProductPreviewView; children?: ReactNode }) {
  const Icon = WATCH_KIND_ICON[preview.kind];
  const stock = stockText(preview);
  return (
    <div className="rounded-2xl border border-line bg-surface p-4">
      <div className="flex items-start gap-3">
        <IconTile icon={Icon} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs text-muted">
            {preview.merchant ?? preview.host} · {KIND_LABEL[preview.kind]}
          </p>
          <p className="mt-0.5 text-[15px] font-semibold leading-snug text-ink">{preview.title ?? preview.host}</p>
          {preview.detail ? <p className="mt-0.5 text-xs text-muted">{preview.detail}</p> : null}
        </div>
      </div>
      {preview.price !== null ? (
        <div className="mt-3 flex items-end justify-between gap-3">
          <div>
            <p className="text-2xl font-semibold tracking-tight text-ink">{money(preview.price, preview.currency ?? "USD", { cents: !Number.isInteger(preview.price) })}</p>
            <p className="text-xs text-muted">Precio de hoy{stock ? ` · ${stock}` : ""}</p>
          </div>
          {preview.spark.length > 2 ? <Sparkline values={preview.spark} label="Precio de los últimos 30 días en la tienda" /> : null}
        </div>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-1.5">
        {preview.source === "sandbox" ? <Chip tone="attention">Tienda de prueba</Chip> : null}
        {preview.method ? (
          <Chip tone={preview.method === "ai" ? "good" : "neutral"}>
            {preview.method === "ai" ? <Sparkles className="size-3" aria-hidden /> : null}
            {METHOD_LABEL[preview.method]}
          </Chip>
        ) : null}
      </div>
      {children}
    </div>
  );
}

export function TrackDialog({
  onClose,
  currency,
  checkEveryMinutes,
  demo = false,
  demoCatalog,
  initial,
}: {
  onClose: () => void;
  currency: string;
  checkEveryMinutes: number;
  demo?: boolean;
  /** Vista previa: catálogo de prueba para buscar sin API. */
  demoCatalog?: ProductPreviewView[];
  initial?: ProductPreviewView;
}) {
  const router = useRouter();
  const [step, setStep] = useState<Step>(initial ? { kind: "preview", preview: initial } : { kind: "find" });
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ProductPreviewView[] | null>(null);
  const [busy, setBusy] = useState<"search" | "ai" | "track" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pct, setPct] = useState(15);
  const [target, setTarget] = useState("");
  const [quantity, setQuantity] = useState(1);

  async function find(text: string) {
    const value = text.trim();
    if (!value) return;
    setError(null);
    setBusy("search");
    if (demo) {
      setResults(filterCatalog(demoCatalog ?? [], value));
      setBusy(null);
      return;
    }
    if (looksLikeUrl(value)) {
      const result = await call<ProductPreviewView>("/api/v1/concierge/preview", postJson({ url: value }));
      setBusy(null);
      if (result.ok) openPreview(result.data);
      else setError(result.message);
      return;
    }
    const result = await call<ProductPreviewView[]>(`/api/v1/concierge/search?q=${encodeURIComponent(value)}`);
    setBusy(null);
    if (result.ok) setResults(result.data);
    else setError(result.message);
  }

  function openPreview(preview: ProductPreviewView) {
    setStep({ kind: "preview", preview });
    setQuantity(preview.kind === "EVENT_TICKET" ? 2 : 1);
    setTarget("");
    setPct(15);
    setError(null);
  }

  async function readWithAI(preview: ProductPreviewView) {
    setBusy("ai");
    setError(null);
    const result = await call<ProductPreviewView>("/api/v1/concierge/preview", postJson({ url: preview.url, useAI: true }));
    setBusy(null);
    if (result.ok) setStep({ kind: "preview", preview: result.data });
    else setError(result.message);
  }

  async function track(preview: ProductPreviewView) {
    const targetPrice = target.trim() ? Number(target.replace(",", ".")) : null;
    if (targetPrice !== null && !(targetPrice > 0)) {
      setError("Escribe un precio objetivo válido o déjalo vacío.");
      return;
    }
    setBusy("track");
    setError(null);
    if (demo) {
      await new Promise((resolve) => setTimeout(resolve, 400));
      setBusy(null);
      setStep({
        kind: "done",
        item: {
          id: "demo-new",
          kind: preview.kind,
          status: "ACTIVE",
          title: preview.title ?? preview.host,
          merchant: preview.merchant,
          url: preview.url,
          host: preview.host,
          source: preview.source,
          method: preview.method,
          currency: preview.currency ?? currency,
          currentPrice: preview.price,
          referencePrice: null,
          changePct: null,
          lowestPrice: preview.price,
          highestPrice: preview.price,
          targetPrice,
          dropAlertPct: pct,
          quantity,
          inStock: preview.inStock,
          stockCount: preview.stockCount,
          detail: preview.detail,
          eventDate: preview.eventDate,
          lastCheckedAt: new Date().toISOString(),
          nextCheckAt: new Date(Date.now() + checkEveryMinutes * 60_000).toISOString(),
          checkEveryMinutes,
          health: "ok",
          lastError: null,
          spark: preview.spark,
          createdAt: new Date().toISOString(),
        },
      });
      return;
    }
    const result = await call<{ item: TrackedItemView; created: boolean }>(
      "/api/v1/concierge/items",
      postJson({ url: preview.url, targetPrice, dropAlertPct: pct, quantity, useAI: preview.method === "ai" }),
    );
    setBusy(null);
    if (result.ok) {
      setStep({ kind: "done", item: result.data.item });
      router.refresh();
    } else if (result.code === "needs_ai") {
      setStep({ kind: "preview", preview: { ...preview, canReadWithAI: true, warnings: [result.message] } });
    } else setError(result.message);
  }

  const title = step.kind === "done" ? "Listo" : "Seguir un precio";
  const back = step.kind === "preview" && !initial ? () => setStep({ kind: "find" }) : undefined;

  return (
    <Dialog title={title} onClose={onClose} onBack={back} closable={busy === null}>
      {step.kind === "find" ? (
        <div className="flex flex-col gap-4">
          <p className="text-sm leading-relaxed text-muted">
            Pega el enlace de un producto, boleto, vuelo u hotel, o busca en las tiendas de prueba. Omni revisa el precio solo y te
            avisa cuando baje de verdad.
          </p>
          <form
            className="flex gap-2"
            onSubmit={(event: FormEvent<HTMLFormElement>) => {
              event.preventDefault();
              void find(query);
            }}
          >
            <label className="sr-only" htmlFor="track-query">
              Enlace o búsqueda
            </label>
            <input
              id="track-query"
              value={query}
              onChange={(event: ChangeEvent<HTMLInputElement>) => setQuery(event.target.value)}
              placeholder="https://… o «audífonos»"
              className={INPUT_CLASS}
              autoComplete="off"
              inputMode="url"
            />
            <button type="submit" disabled={busy !== null || !query.trim()} className={cn(buttonClass("primary", "md"), "shrink-0")}>
              {looksLikeUrl(query) ? <Link2 className="size-4" aria-hidden /> : <Search className="size-4" aria-hidden />}
              <span className="sr-only sm:not-sr-only">{busy === "search" ? "Buscando…" : looksLikeUrl(query) ? "Revisar" : "Buscar"}</span>
            </button>
          </form>
          <div className="flex flex-wrap gap-2">
            {QUICK.map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => {
                  setQuery(q);
                  void find(q);
                }}
                className="rounded-full border border-line-strong bg-surface px-3 py-1.5 text-sm text-ink transition-colors hover:border-primary hover:bg-primary-soft hover:text-primary"
              >
                {q}
              </button>
            ))}
          </div>
          {error ? (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          ) : null}
          {results ? (
            results.length > 0 ? (
              <ul className="flex flex-col divide-y divide-line overflow-hidden rounded-2xl border border-line">
                {results.map((r) => {
                  const Icon = WATCH_KIND_ICON[r.kind];
                  return (
                    <li key={r.url}>
                      <button type="button" onClick={() => openPreview(r)} className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-2">
                        <IconTile icon={Icon} size="sm" tone="neutral" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-ink">{r.title}</span>
                          <span className="block truncate text-xs text-muted">
                            {r.merchant}
                            {r.blocked ? " · no permite revisiones" : ""}
                          </span>
                        </span>
                        {r.price !== null ? (
                          <span className="shrink-0 text-sm font-semibold tabular-nums text-ink">{money(r.price, r.currency ?? "USD", { cents: !Number.isInteger(r.price) })}</span>
                        ) : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-sm text-muted">No encontré nada parecido en las tiendas de prueba. Pega el enlace del producto.</p>
            )
          ) : null}
          <p className="text-xs leading-relaxed text-muted">
            Las tiendas de prueba (.test) son ficticias: sirven para probar alertas y compras sin salir a internet. En páginas
            reales, Omni se identifica como OmniAgentBot y respeta lo que cada tienda permite.
          </p>
        </div>
      ) : null}

      {step.kind === "preview" ? (
        <div className="flex flex-col gap-4">
          <PreviewCard preview={step.preview}>
            {step.preview.warnings.length > 0 ? (
              <ul className="mt-3 flex flex-col gap-1 text-xs leading-relaxed text-muted">
                {step.preview.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            ) : null}
          </PreviewCard>

          {step.preview.blocked ? (
            <p role="alert" className="rounded-2xl bg-attention-soft px-4 py-3 text-sm leading-relaxed text-attention">
              {step.preview.blocked.message}
            </p>
          ) : step.preview.price === null ? (
            step.preview.canReadWithAI ? (
              <div className="rounded-2xl bg-surface-2 px-4 py-4">
                <p className="text-sm leading-relaxed text-ink">Esta página no publica el precio en sus datos de producto. Omni puede leerla con IA.</p>
                <button
                  type="button"
                  onClick={() => readWithAI(step.preview)}
                  disabled={busy !== null || demo}
                  className={cn(buttonClass("primary", "sm"), "mt-3")}
                >
                  <Sparkles className="size-4" aria-hidden />
                  {busy === "ai" ? "Leyendo…" : "Leer con IA"}
                </button>
                <p className="mt-2 text-xs text-muted">Usa una de tus lecturas con IA del mes.</p>
              </div>
            ) : (
              <p className="text-sm text-muted">No encontré el precio en esta página.</p>
            )
          ) : (
            <>
              <fieldset>
                <legend className="mb-2 text-sm font-semibold text-ink">Avísame si baja</legend>
                <div className="grid grid-cols-3 gap-2">
                  {SENSITIVITY_OPTIONS.map((option) => (
                    <label
                      key={option.pct}
                      className={cn(
                        "relative flex cursor-pointer flex-col items-center rounded-2xl border px-2 py-2.5 text-center transition-colors",
                        pct === option.pct ? "border-primary bg-primary-soft" : "border-line hover:bg-surface-2",
                      )}
                    >
                      <input type="radio" name="sensitivity" className="sr-only" checked={pct === option.pct} onChange={() => setPct(option.pct)} />
                      <span className={cn("text-base font-semibold", pct === option.pct ? "text-primary" : "text-ink")}>{option.label}</span>
                      <span className="text-[11px] leading-tight text-muted">{option.hint}</span>
                    </label>
                  ))}
                </div>
                <p className="mt-2 text-xs text-muted">Frente al precio normal de los últimos 30 días: un "descuento" tras subir el precio no cuenta.</p>
              </fieldset>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="flex flex-col gap-1.5">
                  <span className="text-sm font-semibold text-ink">Precio objetivo (opcional)</span>
                  <input
                    value={target}
                    onChange={(event: ChangeEvent<HTMLInputElement>) => setTarget(event.target.value)}
                    inputMode="decimal"
                    placeholder={step.preview.price ? `Por ejemplo, ${money(Math.round(step.preview.price * 0.85), step.preview.currency ?? currency)}` : ""}
                    className={INPUT_CLASS}
                  />
                </label>
                {step.preview.kind !== "PRODUCT" ? (
                  <label className="flex flex-col gap-1.5">
                    <span className="text-sm font-semibold text-ink">{quantityLabel(step.preview.kind)}</span>
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

              {error ? (
                <p role="alert" className="text-sm text-danger">
                  {error}
                </p>
              ) : null}
              <button type="button" onClick={() => track(step.preview)} disabled={busy !== null} className={cn(buttonClass("primary", "lg"), "w-full")}>
                {busy === "track" ? "Guardando…" : "Seguir precio"}
              </button>
              <p className="-mt-2 text-center text-xs text-muted">
                Reviso el precio {frequencyText(checkEveryMinutes)}. Nada se compra sin que tú lo permitas.
              </p>
            </>
          )}
          {error && step.preview.price === null ? (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}

      {step.kind === "done" ? (
        <div className="flex flex-col items-center text-center">
          <span className="mt-2 grid size-14 place-items-center rounded-full bg-primary-soft text-primary">
            <CircleCheck className="size-7" aria-hidden />
          </span>
          <p className="mt-4 text-lg font-semibold text-ink">Lo sigo</p>
          <p className="mt-1 max-w-xs text-sm leading-relaxed text-muted">{step.item.title}</p>
          <p className="mt-4 rounded-2xl bg-surface-2 px-4 py-3 text-sm leading-relaxed text-ink">
            {ruleText(step.item.dropAlertPct, step.item.targetPrice, step.item.currency)}. Reviso el precio {frequencyText(step.item.checkEveryMinutes)}.
          </p>
          <div className="mt-5 flex w-full flex-col gap-2">
            <button type="button" onClick={onClose} className={cn(buttonClass("primary", "md"), "w-full")}>
              Listo
            </button>
            <button
              type="button"
              onClick={() => {
                setStep({ kind: "find" });
                setResults(null);
                setQuery("");
              }}
              className={cn(buttonClass("ghost", "md"), "w-full")}
            >
              Seguir otro
            </button>
          </div>
        </div>
      ) : null}
    </Dialog>
  );
}

/** Botón que abre el diálogo para seguir un precio. */
export function TrackButton({
  label = "Seguir un precio",
  size = "sm",
  variant = "primary",
  className,
  currency,
  checkEveryMinutes,
  demo = false,
  demoCatalog,
  initial,
  icon = true,
  autoOpen,
}: {
  label?: string;
  size?: "sm" | "md" | "lg";
  variant?: "primary" | "secondary" | "ghost";
  className?: string;
  currency: string;
  checkEveryMinutes: number;
  demo?: boolean;
  demoCatalog?: ProductPreviewView[];
  initial?: ProductPreviewView;
  icon?: boolean;
  /** Abrir el diálogo al montar (por defecto, si hay una vista previa inicial). */
  autoOpen?: boolean;
}) {
  const [open, setOpen] = useState(autoOpen ?? Boolean(initial));
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={cn(buttonClass(variant, size), className)}>
        {icon ? <Link2 className="size-4" aria-hidden /> : null}
        {label}
      </button>
      {open ? (
        <TrackDialog
          onClose={() => setOpen(false)}
          currency={currency}
          checkEveryMinutes={checkEveryMinutes}
          demo={demo}
          demoCatalog={demoCatalog}
          initial={initial}
        />
      ) : null}
    </>
  );
}
