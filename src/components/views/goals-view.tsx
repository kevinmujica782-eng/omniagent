import { ChevronRight, Plus, Tag, Target } from "lucide-react";
import Link from "next/link";
import { GOAL_ICON } from "@/components/icons";
import { Chip, Dot, IconTile, PageBody, PageHeader, Panel, Progress, Section } from "@/components/ui";
import { money, monthYear } from "@/lib/format";
import { GOAL_CATEGORY_LABEL, GOAL_STARTERS } from "@/modules/goals/categories";
import type { GoalCard, TrackingCard } from "@/types/cards";

const chatHref = (prompt: string) => `/chat?prompt=${encodeURIComponent(prompt)}`;

/** Fila compacta de un precio vigilado (landing). */
export function TrackingRow({ item }: { item: TrackingCard }) {
  const inTarget = item.currentPrice !== null && item.targetPrice !== null && item.currentPrice <= item.targetPrice;
  return (
    <div className="flex items-center gap-3 px-4 py-3.5">
      <IconTile icon={Tag} tone="attention" size="sm" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-ink">{item.title}</p>
        <p className="truncate text-xs text-muted">
          {item.merchant ?? "Varias tiendas"}
          {item.targetPrice !== null ? `, objetivo ${money(item.targetPrice, item.currency)}` : ""}
        </p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <p className="text-sm font-semibold tabular-nums text-ink">
          {item.currentPrice !== null ? money(item.currentPrice, item.currency) : "Sin precio"}
        </p>
        {inTarget ? <Chip tone="good">En tu precio</Chip> : null}
      </div>
    </div>
  );
}

export function GoalRow({ goal }: { goal: GoalCard }) {
  const Icon = GOAL_ICON[goal.category] ?? Target;
  const target = goal.targetAmount;
  return (
    <div className="flex gap-3 px-4 py-4">
      <IconTile icon={Icon} size="sm" />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <p className="truncate text-sm font-semibold text-ink">{goal.title}</p>
          {target ? (
            <p className="shrink-0 text-xs tabular-nums text-muted">
              {money(goal.currentAmount, goal.currency)} de {money(target, goal.currency)}
            </p>
          ) : null}
        </div>
        {target ? (
          <div className="mt-2">
            <Progress value={goal.currentAmount} max={target} label={`Avance de ${goal.title}`} />
          </div>
        ) : null}
        <p className="mt-2 text-xs leading-relaxed text-muted">
          {goal.monthlyContribution
            ? `Aparta ${money(goal.monthlyContribution, goal.currency)} al mes${goal.targetDate ? ` para llegar en ${monthYear(goal.targetDate)}` : ""}.`
            : (goal.description ?? "Sin monto objetivo.")}
        </p>
      </div>
    </div>
  );
}

function EmptyLine({ text, href, cta }: { text: string; href: string; cta: string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-dashed border-line-strong px-4 py-4 text-sm text-muted">
      <span>{text}</span>
      <Link href={href} className="font-semibold text-primary underline-offset-2 hover:underline">
        {cta}
      </Link>
    </div>
  );
}

export function GoalsView({ goals, watching, demo = false }: { goals: GoalCard[]; watching: number; demo?: boolean }) {
  return (
    <PageBody>
      <PageHeader title="Metas" description="Tus planes y lo que Omni vigila para ayudarte a cumplirlos." />

      <Link
        href={demo ? "/preview?screen=compras" : "/compras"}
        className="mb-8 flex items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-3.5 transition-colors hover:bg-surface-2"
      >
        <IconTile icon={Tag} tone="attention" size="sm" />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-ink">
            {watching > 0 ? `Vigilando ${watching === 1 ? "1 precio" : `${watching} precios`}` : "Vigila un precio"}
          </span>
          <span className="block text-xs text-muted">Ofertas, pedidos y límites de compra están en Compras.</span>
        </span>
        <ChevronRight className="size-5 text-muted" aria-hidden />
      </Link>

      <Section
        title={
          <>
            <Dot tone="primary" />
            Metas
          </>
        }
      >
        {goals.length > 0 ? (
          <Panel>
            {goals.map((goal) => (
              <GoalRow key={goal.goalId} goal={goal} />
            ))}
          </Panel>
        ) : (
          <EmptyLine
            text="Todavía no tienes metas activas."
            href={chatHref("Quiero crear una meta de ahorro.")}
            cta="Crear la primera"
          />
        )}
      </Section>

      <Section title="Crear una meta">
        <Panel>
          {GOAL_STARTERS.map((starter) => {
            const Icon = GOAL_ICON[starter.category] ?? Target;
            return (
              <Link
                key={starter.category}
                href={chatHref(starter.prompt)}
                className="flex items-center gap-3 px-4 py-3.5 text-sm text-ink transition-colors hover:bg-surface-2"
              >
                <Icon className="size-5 text-muted" aria-hidden />
                <span className="flex-1">{GOAL_CATEGORY_LABEL[starter.category]}</span>
                <Plus className="size-5 text-muted" aria-hidden />
              </Link>
            );
          })}
        </Panel>
      </Section>
    </PageBody>
  );
}
