import { Check, Sparkles } from "lucide-react";
import { UpgradeButton } from "@/components/upgrade-sheet";
import type { AgentFeatureId } from "@/modules/billing/plans";
import type { UpgradeCard } from "@/types/cards";

/** En el chat, cuando algo choca con un límite del plan Gratis: el motivo, qué da Pro y el botón. */
export function UpgradeCardView({ card }: { card: UpgradeCard }) {
  return (
    <div className="w-full max-w-md overflow-hidden rounded-2xl border border-line bg-surface">
      <div className="flex items-start gap-3 bg-primary-soft px-4 py-3">
        <Sparkles className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-ink">Con Pro no tendrías este límite</p>
          <p className="mt-0.5 text-xs leading-relaxed text-muted">{card.reason}</p>
        </div>
      </div>
      <ul className="flex flex-col gap-1.5 px-4 py-3 text-sm text-ink">
        {card.highlights.map((line) => (
          <li key={line} className="flex items-start gap-2">
            <Check className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
            <span>{line}</span>
          </li>
        ))}
      </ul>
      <div className="px-4 pb-4">
        <UpgradeButton feature={(card.feature as AgentFeatureId | null) ?? null} reason={card.reason} className="w-full">
          Ver Pro · {card.priceLabel}
        </UpgradeButton>
      </div>
    </div>
  );
}
