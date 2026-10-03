import { OmniMark } from "@/components/omni-mark";
import { cn } from "@/lib/cn";
import { autopilotPerDay } from "@/modules/billing/paywall";
import { cadenceText, type PlanLimits } from "@/modules/billing/plans";

// Un día de los agentes en Pro, dibujado como la órbita de la marca: el anillo es el reloj de 24 horas, cada raya
// es una revisión de precios y cada punto una revisión del correo. Al abrir, la órbita da una vuelta y enciende
// las marcas (sin animación con reduced-motion). Las marcas se distinguen por forma, no solo por color.

const C = 120; // centro del viewBox 240 × 240
const SWEEP_MS = 1500;
const START_MS = 150;

// Colores de datos validados contra la superficie oscura (daltonismo, luminosidad y contraste).
const PRICE_MARK = "#4fa983";
const MAIL_MARK = "#bf8836";

function point(hour: number, radius: number): [number, number] {
  const angle = (hour / 24) * Math.PI * 2 - Math.PI / 2;
  return [C + radius * Math.cos(angle), C + radius * Math.sin(angle)];
}

const delay = (hour: number) => ({ animationDelay: `${START_MS + (hour / 24) * SWEEP_MS}ms` });

export function AutopilotDial({ plan, className }: { plan: PlanLimits; className?: string }) {
  const day = autopilotPerDay(plan);
  const priceHours = Array.from({ length: day.prices }, (_, i) => (i * 24) / day.prices);
  const mailHours = Array.from({ length: day.mail }, (_, i) => (i * 24) / day.mail);
  const label = `En un día con ${plan.name}, Omni revisa tus precios ${day.prices} veces y tu correo ${day.mail} veces.`;

  return (
    <figure className={cn("flex flex-col items-center", className)}>
      <div className="relative size-52 lg:size-60">
        <svg viewBox="0 0 240 240" role="img" aria-label={label} className="size-full overflow-visible">
          <circle cx={C} cy={C} r={89} fill="none" stroke="var(--line-strong)" strokeWidth={1} />
          {[0, 6, 12, 18].map((hour) => {
            const [x, y] = point(hour, 64);
            return (
              <text key={hour} x={x} y={y} dy="0.35em" textAnchor="middle" fontSize={10} fill="var(--muted)" className="tabular-nums">
                {hour} h
              </text>
            );
          })}
          {priceHours.map((hour) => {
            const [x1, y1] = point(hour, 83);
            const [x2, y2] = point(hour, 95);
            return <line key={`p${hour}`} x1={x1} y1={y1} x2={x2} y2={y2} stroke={PRICE_MARK} strokeWidth={2.5} strokeLinecap="round" className="dial-mark" style={delay(hour)} />;
          })}
          {mailHours.map((hour) => {
            const [cx, cy] = point(hour, 106);
            return <circle key={`m${hour}`} cx={cx} cy={cy} r={4.5} fill={MAIL_MARK} className="dial-mark" style={delay(hour)} />;
          })}
          {/* La órbita que recorre el día: una vuelta y se apaga. */}
          <g className="dial-hand" style={{ animationDuration: `${SWEEP_MS}ms`, animationDelay: `${START_MS}ms` }}>
            <line x1={C} y1={C} x2={C} y2={C - 100} stroke="var(--primary)" strokeOpacity={0.45} strokeWidth={1.5} strokeLinecap="round" />
            <circle cx={C} cy={C - 100} r={5} fill="var(--orbit)" />
          </g>
        </svg>
        <div className="absolute inset-0 grid place-items-center">
          <OmniMark size={60} className="size-14 lg:size-16" />
        </div>
      </div>
      <figcaption className="mt-3 flex flex-wrap justify-center gap-x-5 gap-y-1 text-[13px] text-muted">
        <span className="inline-flex items-center gap-2">
          <svg aria-hidden viewBox="0 0 8 14" className="h-3.5 w-2">
            <line x1={4} y1={2} x2={4} y2={12} stroke={PRICE_MARK} strokeWidth={2.5} strokeLinecap="round" />
          </svg>
          Precios, {cadenceText(plan.priceCheckMinutes)}
        </span>
        <span className="inline-flex items-center gap-2">
          <svg aria-hidden viewBox="0 0 10 10" className="size-2.5">
            <circle cx={5} cy={5} r={4.5} fill={MAIL_MARK} />
          </svg>
          Correo, {cadenceText(plan.mailCheckHours * 60)}
        </span>
      </figcaption>
    </figure>
  );
}
