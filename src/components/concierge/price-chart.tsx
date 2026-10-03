"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { cn } from "@/lib/cn";
import { money } from "@/lib/format";

// Gráficas de precio: una sola serie (el precio), con la referencia "lo normal" y el objetivo como líneas
// anotadas. Línea de 2 px, punto final con anillo del color de la superficie, rejilla en líneas finas sólidas,
// etiquetas selectivas (hoy, mínimo) y cruz con tooltip al pasar el dedo o el cursor (también con el teclado).

type Point = { at: string; price: number };

/** Minigráfica para listas: la tendencia de 30 días; el valor va en texto al lado. */
export function Sparkline({
  values,
  width = 96,
  height = 28,
  reference = null,
  className,
  label,
}: {
  values: number[];
  width?: number;
  height?: number;
  reference?: number | null;
  className?: string;
  label: string;
}) {
  if (values.length < 2) return <span className={cn("inline-block", className)} style={{ width, height }} aria-hidden />;
  const pad = 4;
  const all = reference !== null ? [...values, reference] : values;
  const min = Math.min(...all);
  const max = Math.max(...all);
  const span = max - min || 1;
  const x = (i: number) => pad + (i / (values.length - 1)) * (width - pad * 2);
  const y = (v: number) => pad + (1 - (v - min) / span) * (height - pad * 2);
  const path = values.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const last = values[values.length - 1];
  const dropped = reference !== null && last < reference;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className={cn("shrink-0 overflow-visible", className)} role="img" aria-label={label}>
      {reference !== null ? (
        <line x1={pad} x2={width - pad} y1={y(reference)} y2={y(reference)} className="stroke-line-strong" strokeWidth={1} />
      ) : null}
      <path d={path} fill="none" className="stroke-muted" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={x(values.length - 1)} cy={y(last)} r={3.5} className={cn(dropped ? "fill-primary" : "fill-ink", "stroke-surface")} strokeWidth={2} />
    </svg>
  );
}

function useWidth<T extends HTMLElement>(fallback = 320) {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setWidth(Math.max(200, Math.round(el.getBoundingClientRect().width)));
    update();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
}

function dayKey(iso: string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
  } catch {
    return iso.slice(0, 10);
  }
}

function shortDay(iso: string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("es-US", { day: "numeric", month: "short", timeZone }).format(new Date(iso));
  } catch {
    return iso.slice(0, 10);
  }
}

/** Ticks redondos para el eje de precios: 3 o 4 valores limpios que cubren el rango. */
function niceTicks(min: number, max: number): number[] {
  const span = max - min || Math.max(1, max * 0.1);
  const rough = span / 3;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= rough) ?? rough;
  const ticks: number[] = [];
  for (let t = Math.floor(min / step) * step; t <= max + step * 0.001 && ticks.length < 6; t += step) ticks.push(Math.round(t * 100) / 100);
  if (ticks[ticks.length - 1] < max) ticks.push(Math.round((ticks[ticks.length - 1] + step) * 100) / 100);
  return ticks.filter((t) => t >= 0);
}

/** Gráfica del historial (detalle del seguimiento). */
export function PriceChart({
  points,
  currency,
  reference = null,
  target = null,
  timeZone,
  height = 200,
}: {
  points: Point[];
  currency: string;
  reference?: number | null;
  target?: number | null;
  timeZone: string;
  height?: number;
}) {
  const { ref, width } = useWidth<HTMLDivElement>();
  const titleId = useId();
  const [active, setActive] = useState<number | null>(null);

  // Un precio por día (el último de cada día).
  const daily = useMemo(() => {
    const byDay = new Map<string, Point>();
    for (const p of [...points].sort((a, b) => a.at.localeCompare(b.at))) byDay.set(dayKey(p.at, timeZone), p);
    return [...byDay.values()];
  }, [points, timeZone]);

  if (daily.length < 2) {
    return <p className="rounded-2xl bg-surface-2 px-4 py-6 text-center text-sm text-muted">Todavía no hay suficientes precios para una gráfica.</p>;
  }

  const m = (n: number) => money(n, currency, { cents: !Number.isInteger(n) });
  const prices = daily.map((p) => p.price);
  const lo = Math.min(...prices, ...(target !== null ? [target] : []), ...(reference !== null ? [reference] : []));
  const hi = Math.max(...prices, ...(reference !== null ? [reference] : []));
  const ticks = niceTicks(lo * 0.97, hi * 1.02);
  const yMin = Math.min(ticks[0], lo * 0.97);
  const yMax = Math.max(ticks[ticks.length - 1], hi * 1.02);
  const left = 44;
  const right = 52;
  const top = 12;
  const bottom = 28;
  const plotW = width - left - right;
  const plotH = height - top - bottom;
  const x = (i: number) => left + (i / (daily.length - 1)) * plotW;
  const y = (v: number) => top + (1 - (v - yMin) / (yMax - yMin || 1)) * plotH;
  const line = daily.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.price).toFixed(1)}`).join(" ");
  const area = `${line} L${x(daily.length - 1).toFixed(1)},${top + plotH} L${left},${top + plotH} Z`;
  const lastIndex = daily.length - 1;
  const minIndex = prices.indexOf(Math.min(...prices));
  const current = daily[lastIndex];

  function nearest(clientX: number, rect: DOMRect) {
    const rel = ((clientX - rect.left) / rect.width) * width;
    const i = Math.round(((rel - left) / plotW) * (daily.length - 1));
    return Math.max(0, Math.min(daily.length - 1, i));
  }
  function onPointer(event: PointerEvent<SVGSVGElement>) {
    setActive(nearest(event.clientX, event.currentTarget.getBoundingClientRect()));
  }
  function onKey(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      setActive((i) => {
        const base = i ?? lastIndex;
        return Math.max(0, Math.min(lastIndex, base + (event.key === "ArrowLeft" ? -1 : 1)));
      });
    } else if (event.key === "Escape") setActive(null);
  }

  const hover = active !== null ? daily[active] : null;
  const tipLeft = active !== null ? Math.min(Math.max(x(active) - 70, 0), width - 140) : 0;
  const summary = `Precio de los últimos ${daily.length} días: mínimo ${m(Math.min(...prices))}, máximo ${m(Math.max(...prices))}, hoy ${m(current.price)}.`;

  return (
    <figure className="w-full">
      <div
        ref={ref}
        className="relative w-full rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-primary"
        tabIndex={0}
        role="group"
        aria-labelledby={titleId}
        onKeyDown={onKey}
        onBlur={() => setActive(null)}
      >
        <span id={titleId} className="sr-only">
          {summary} Usa las flechas para recorrer los días.
        </span>
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          className="block touch-pan-y select-none"
          onPointerMove={onPointer}
          onPointerDown={onPointer}
          onPointerLeave={() => setActive(null)}
          aria-hidden
        >
          {ticks.map((t) => (
            <g key={t}>
              <line x1={left} x2={left + plotW} y1={y(t)} y2={y(t)} className="stroke-line" strokeWidth={1} />
              <text x={left - 8} y={y(t) + 4} textAnchor="end" className="fill-muted text-[11px] tabular-nums">
                {money(t, currency)}
              </text>
            </g>
          ))}
          {/* Lo normal y el objetivo se nombran en la leyenda de abajo (así no chocan con la etiqueta del precio de hoy). */}
          {reference !== null ? <line x1={left} x2={left + plotW} y1={y(reference)} y2={y(reference)} className="stroke-muted" strokeWidth={1} /> : null}
          {target !== null && target >= yMin ? (
            <line x1={left} x2={left + plotW} y1={y(target)} y2={y(target)} className="stroke-attention" strokeWidth={1.5} strokeDasharray="5 4" />
          ) : null}
          <path d={area} className="fill-primary" fillOpacity={0.1} />
          <path d={line} fill="none" className="stroke-primary" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
          {minIndex !== lastIndex ? (
            <g>
              <circle cx={x(minIndex)} cy={y(prices[minIndex])} r={4} className="fill-primary stroke-surface" strokeWidth={2} />
              <text x={x(minIndex)} y={y(prices[minIndex]) + 18} textAnchor="middle" className="fill-muted text-[11px] tabular-nums">
                Mín. {m(prices[minIndex])}
              </text>
            </g>
          ) : null}
          <circle cx={x(lastIndex)} cy={y(current.price)} r={4.5} className="fill-primary stroke-surface" strokeWidth={2} />
          <text x={x(lastIndex) + 7} y={y(current.price) + 4} className="fill-ink text-[12px] font-semibold tabular-nums">
            {m(current.price)}
          </text>
          <text x={left} y={height - 8} className="fill-muted text-[11px]">
            {shortDay(daily[0].at, timeZone)}
          </text>
          <text x={left + plotW} y={height - 8} textAnchor="end" className="fill-muted text-[11px]">
            Hoy
          </text>
          {hover && active !== null ? (
            <g>
              <line x1={x(active)} x2={x(active)} y1={top} y2={top + plotH} className="stroke-ink" strokeOpacity={0.35} strokeWidth={1} />
              <circle cx={x(active)} cy={y(hover.price)} r={5} className="fill-primary stroke-surface" strokeWidth={2} />
            </g>
          ) : null}
        </svg>
        {hover && active !== null ? (
          <div
            className="pointer-events-none absolute top-1 w-[140px] rounded-xl border border-line bg-surface px-3 py-2 shadow-float"
            style={{ left: tipLeft }}
            role="status"
          >
            <p className="text-sm font-semibold tabular-nums text-ink">{m(hover.price)}</p>
            <p className="text-xs text-muted">{shortDay(hover.at, timeZone)}</p>
          </div>
        ) : null}
      </div>
      <figcaption className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-xs text-muted">
        {reference !== null ? (
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="h-px w-4 bg-muted" />
            Normal (30 días): {m(reference)}
          </span>
        ) : null}
        {target !== null ? (
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="w-4 border-t-[1.5px] border-dashed border-attention" />
            Tu objetivo: {m(target)}
          </span>
        ) : null}
      </figcaption>
      <details className="mt-2 px-1 text-sm">
        <summary className="cursor-pointer text-xs font-semibold text-primary">Ver los precios día por día</summary>
        <table className="mt-2 w-full text-left text-xs">
          <thead>
            <tr className="text-muted">
              <th className="py-1 font-medium">Día</th>
              <th className="py-1 text-right font-medium">Precio</th>
            </tr>
          </thead>
          <tbody>
            {[...daily].reverse().map((p) => (
              <tr key={p.at} className="border-t border-line">
                <td className="py-1 text-ink">{shortDay(p.at, timeZone)}</td>
                <td className="py-1 text-right tabular-nums text-ink">{m(p.price)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
