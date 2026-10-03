import { Check } from "lucide-react";
import type { ReactNode } from "react";
import { Chip } from "@/components/ui";
import { cn } from "@/lib/cn";
import { planFeatures, type PlanLimits } from "@/modules/billing/plans";

export function PlanCard({ plan, current = false, cta }: { plan: PlanLimits; current?: boolean; cta?: ReactNode }) {
  return (
    <div
      className={cn(
        "flex flex-col rounded-2xl border bg-surface p-5",
        plan.id === "PRO" ? "border-primary" : "border-line",
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <p className="text-base font-semibold text-ink">{plan.name}</p>
        {current ? <Chip tone="good">Tu plan</Chip> : null}
      </div>
      <p className="mt-2 text-3xl font-semibold tracking-tight tabular-nums text-ink">
        {plan.price}
        {plan.period ? <span className="ml-1 text-sm font-normal tracking-normal text-muted">{plan.period}</span> : null}
      </p>
      <ul className="mt-4 flex flex-1 flex-col gap-2 text-sm text-ink">
        {planFeatures(plan).map((feature) => (
          <li key={feature} className="flex items-start gap-2">
            <Check className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
            <span>{feature}</span>
          </li>
        ))}
      </ul>
      {cta ? <div className="mt-5">{cta}</div> : null}
    </div>
  );
}
