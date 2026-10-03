import Link from "next/link";
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";

// Piezas de UI sin estado: sirven en Server y Client Components.

export type ButtonVariant = "primary" | "secondary" | "ghost";
export type ButtonSize = "sm" | "md" | "lg";

const BUTTON_BASE =
  "inline-flex items-center justify-center gap-2 rounded-full font-semibold transition-colors disabled:pointer-events-none disabled:opacity-50";
const BUTTON_SIZE: Record<ButtonSize, string> = {
  sm: "px-3.5 py-1.5 text-sm",
  md: "px-4 py-2.5 text-sm",
  lg: "px-6 py-3 text-base",
};
const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  primary: "bg-primary text-on-primary hover:bg-primary-hover",
  secondary: "border border-line-strong bg-surface text-ink hover:bg-surface-2",
  ghost: "text-primary hover:bg-primary-soft",
};

export function buttonClass(variant: ButtonVariant = "primary", size: ButtonSize = "md"): string {
  return cn(BUTTON_BASE, BUTTON_SIZE[size], BUTTON_VARIANT[variant]);
}

export function ButtonLink({
  href,
  children,
  variant = "primary",
  size = "md",
  className,
}: {
  href: string;
  children: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
}) {
  return (
    <Link href={href} className={cn(buttonClass(variant, size), className)}>
      {children}
    </Link>
  );
}

/** Campo de texto, fecha o selección con el estilo de la app. */
export const INPUT_CLASS =
  "w-full min-w-0 rounded-xl border border-line-strong bg-surface px-3 py-2.5 text-sm text-ink placeholder:text-muted focus:border-primary focus:outline-none";

export function PageBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("mx-auto w-full max-w-3xl px-4 pb-16 pt-6 sm:px-6", className)}>{children}</div>;
}

export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}) {
  // En el teléfono la descripción ocupa todo el ancho bajo el título y la acción (así no queda
  // encajonada junto al botón); desde sm, la acción va a la derecha de ambos.
  return (
    <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 pb-5 sm:items-start">
      <h1 className="row-start-1 text-2xl font-semibold tracking-tight text-ink">{title}</h1>
      {action ? <div className="col-start-2 row-start-1 sm:row-span-2">{action}</div> : null}
      {description ? (
        <p className="col-span-2 row-start-2 mt-1 text-sm leading-relaxed text-pretty text-muted sm:col-span-1">{description}</p>
      ) : null}
    </header>
  );
}

export function Section({
  title,
  action,
  children,
  className,
}: {
  title: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("mt-8 first:mt-0", className)}>
      <div className="mb-2.5 flex items-center justify-between gap-3 px-1">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Contenedor de filas con divisores, como una lista de ajustes. */
export function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface", className)}>
      {children}
    </div>
  );
}

export function IconTile({
  icon: Icon,
  tone = "primary",
  size = "md",
}: {
  icon: LucideIcon;
  tone?: "primary" | "attention" | "neutral";
  size?: "sm" | "md";
}) {
  const tones = {
    primary: "bg-primary-soft text-primary",
    attention: "bg-attention-soft text-attention",
    neutral: "bg-surface-2 text-muted",
  };
  return (
    <span
      className={cn(
        "grid shrink-0 place-items-center",
        size === "md" ? "size-10 rounded-xl" : "size-8 rounded-lg",
        tones[tone],
      )}
    >
      <Icon className={size === "md" ? "size-5" : "size-4"} aria-hidden />
    </span>
  );
}

export type ChipTone = "neutral" | "good" | "attention" | "danger";

export function Chip({ tone = "neutral", children }: { tone?: ChipTone; children: ReactNode }) {
  const tones: Record<ChipTone, string> = {
    neutral: "border border-line bg-surface-2 text-muted",
    good: "bg-primary-soft text-primary",
    attention: "bg-attention-soft text-attention",
    danger: "bg-danger-soft text-danger",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium tabular-nums",
        tones[tone],
      )}
    >
      {children}
    </span>
  );
}

/** Punto de color para títulos de sección ("Siguiendo", "Metas"). */
export function Dot({ tone }: { tone: "primary" | "attention" }) {
  return (
    <span
      aria-hidden
      className={cn("size-2.5 rounded-full", tone === "primary" ? "bg-primary" : "bg-orbit")}
    />
  );
}

export function Progress({
  value,
  max,
  label,
  tone = "primary",
}: {
  value: number;
  max: number;
  label?: string;
  tone?: "primary" | "attention" | "danger";
}) {
  const pct = max > 0 ? Math.max(0, Math.min(100, Math.round((value / max) * 100))) : 0;
  const tones = { primary: "bg-primary", attention: "bg-attention", danger: "bg-danger" };
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      className="h-2 w-full overflow-hidden rounded-full bg-line"
    >
      <div className={cn("h-full rounded-full", tones[tone])} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  body,
  action,
}: {
  icon: LucideIcon;
  title: string;
  body?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center rounded-2xl border border-dashed border-line-strong bg-surface px-6 py-10 text-center">
      <IconTile icon={Icon} />
      <p className="mt-3 text-base font-semibold text-ink">{title}</p>
      {body ? <p className="mt-1 max-w-sm text-sm leading-relaxed text-muted">{body}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

export function Notice({ tone = "good", children }: { tone?: "good" | "attention" | "danger"; children: ReactNode }) {
  const tones = {
    good: "bg-primary-soft text-primary",
    attention: "bg-attention-soft text-attention",
    danger: "bg-danger-soft text-danger",
  };
  return <div className={cn("mb-5 rounded-2xl px-4 py-3 text-sm font-medium", tones[tone])}>{children}</div>;
}
