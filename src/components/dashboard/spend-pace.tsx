"use client";

import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { money } from "@/lib/format";

type Day = { day: number; amount: number };

/** Gasto acumulado día por día (lo que llevas gastado en el mes hasta ese día). */
export function cumulative(daily: Day[]): Day[] {
  let total = 0;
  return daily.map((d) => {
    total += d.amount;
    return { day: d.day, amount: Math.round(total * 100) / 100 };
  });
}

const W = 300;
const H = 72;

/**
 * Ritmo de gasto del mes: la línea de este mes (acumulado hasta hoy, en el color de acento con un lavado
 * suave) sobre la del mes pasado (gris, completa). Un cursor vertical encuentra el día; el recuadro muestra
 * los dos valores. Mismo detalle con el teclado (flechas) y en la tabla para lectores de pantalla.
 */
export function SpendPace({
  daily,
  previousDaily,
  daysInMonth,
  currency,
  monthLabel,
  previousLabel,
}: {
  daily: Day[];
  previousDaily: Day[];
  daysInMonth: number;
  currency: string;
  monthLabel: string;
  previousLabel: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<number | null>(null);
  const current = cumulative(daily);
  const previous = cumulative(previousDaily).filter((d) => d.day <= daysInMonth);
  const top = Math.max(current[current.length - 1]?.amount ?? 0, previous[previous.length - 1]?.amount ?? 0, 1) * 1.08;
  const x = (day: number) => ((day - 1) / Math.max(daysInMonth - 1, 1)) * W;
  const y = (amount: number) => H - (amount / top) * H;
  const path = (points: Day[]) => points.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.day).toFixed(1)},${y(p.amount).toFixed(1)}`).join(" ");
  const last = current[current.length - 1];
  const today = last?.day ?? 1;

  function dayAt(event: PointerEvent<HTMLDivElement>): number {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return today;
    const ratio = Math.max(0, Math.min(1, (event.clientX - box.left) / box.width));
    return Math.max(1, Math.min(daysInMonth, Math.round(ratio * (daysInMonth - 1)) + 1));
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    setActive((day) => {
      const base = day ?? today;
      if (event.key === "Home") return 1;
      if (event.key === "End") return daysInMonth;
      return Math.max(1, Math.min(daysInMonth, base + (event.key === "ArrowLeft" ? -1 : 1)));
    });
  }

  const focusDay = active;
  const nowValue = focusDay !== null ? current.find((d) => d.day === focusDay) : null;
  const prevValue = focusDay !== null ? previous.find((d) => d.day === focusDay) : null;
  const leftPct = focusDay !== null ? (x(focusDay) / W) * 100 : 0;
  const shift = leftPct > 70 ? "-100%" : leftPct < 30 ? "0%" : "-50%";
  const pct = (value: number, of: number) => `${(value / of) * 100}%`;

  return (
    <figure className="m-0">
      <div
        ref={ref}
        role="img"
        tabIndex={0}
        aria-label={`Gasto acumulado de ${monthLabel}: ${money(last?.amount ?? 0, currency)} hasta el día ${today}, comparado con ${previousLabel}. Usa las flechas para recorrer los días.`}
        onPointerMove={(event: PointerEvent<HTMLDivElement>) => setActive(dayAt(event))}
        onPointerLeave={() => setActive(null)}
        onFocus={() => setActive((day) => day ?? today)}
        onBlur={() => setActive(null)}
        onKeyDown={onKeyDown}
        className="relative touch-none rounded-md outline-offset-4"
        style={{ height: H }}
      >
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="absolute inset-0 size-full overflow-visible" aria-hidden>
          <line x1={0} x2={W} y1={H} y2={H} stroke="var(--line)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
          {previous.length > 1 ? (
            <path d={path(previous)} fill="none" stroke="var(--line-strong)" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          ) : null}
          {current.length > 1 ? (
            <>
              <path d={`${path(current)} L${x(today).toFixed(1)},${H} L0,${H} Z`} fill="var(--primary)" fillOpacity={0.1} />
              <path d={path(current)} fill="none" stroke="var(--primary)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
            </>
          ) : null}
        </svg>
        {focusDay !== null ? <div aria-hidden className="absolute inset-y-0 w-px bg-muted/50" style={{ left: pct(x(focusDay), W) }} /> : null}
        {last ? (
          <span
            aria-hidden
            className="absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary ring-2 ring-surface"
            style={{ left: pct(x(last.day), W), top: pct(y(last.amount), H) }}
          />
        ) : null}
        {focusDay !== null ? (
          <div
            className="pointer-events-none absolute -top-2 z-10 whitespace-nowrap rounded-xl border border-line bg-surface px-2.5 py-1.5 text-xs text-ink shadow-float"
            style={{ left: `${leftPct}%`, transform: `translate(${shift}, -100%)` }}
          >
            <p className="text-muted">Día {focusDay}</p>
            {nowValue ? (
              <p className="flex items-center gap-1.5">
                <span aria-hidden className="h-0.5 w-3 rounded-full bg-primary" />
                <span className="font-semibold">{money(nowValue.amount, currency)}</span>
                <span className="text-muted">{monthLabel}</span>
              </p>
            ) : null}
            {prevValue ? (
              <p className="flex items-center gap-1.5">
                <span aria-hidden className="h-0.5 w-3 rounded-full bg-line-strong" />
                <span className="font-semibold">{money(prevValue.amount, currency)}</span>
                <span className="text-muted">{previousLabel}</span>
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
      <figcaption className="mt-2 flex items-center gap-3 text-[11px] text-muted">
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="h-0.5 w-3 rounded-full bg-primary" />
          {monthLabel.charAt(0).toUpperCase() + monthLabel.slice(1)}
        </span>
        {previous.length > 1 ? (
          <span className="flex items-center gap-1.5">
            <span aria-hidden className="h-0.5 w-3 rounded-full bg-line-strong" />
            {previousLabel.charAt(0).toUpperCase() + previousLabel.slice(1)}
          </span>
        ) : null}
      </figcaption>
      <table className="sr-only">
        <caption>Gasto acumulado por día</caption>
        <thead>
          <tr>
            <th scope="col">Día</th>
            <th scope="col">{monthLabel}</th>
            <th scope="col">{previousLabel}</th>
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((day) => {
            const a = current.find((d) => d.day === day);
            const b = previous.find((d) => d.day === day);
            return (
              <tr key={day}>
                <td>{day}</td>
                <td>{a ? money(a.amount, currency) : "—"}</td>
                <td>{b ? money(b.amount, currency) : "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </figure>
  );
}
