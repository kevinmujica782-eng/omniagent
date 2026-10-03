import { ShieldCheck } from "lucide-react";
import { ApprovalSlip } from "@/components/approval-slip";
import { ACTION_ICON } from "@/components/icons";
import { Chip, EmptyState, IconTile, PageBody, PageHeader, Panel, Section, type ChipTone } from "@/components/ui";
import { ACTION_KIND_LABEL } from "@/lib/actions-copy";
import { money, shortDate } from "@/lib/format";
import type { ActionState, ApprovalCard } from "@/types/cards";

const STATUS_CHIP: Record<ActionState, { label: string; tone: ChipTone }> = {
  PENDING: { label: "Pendiente", tone: "attention" },
  APPROVED: { label: "En curso", tone: "neutral" },
  EXECUTED: { label: "Hecha", tone: "good" },
  REJECTED: { label: "Rechazada", tone: "neutral" },
  FAILED: { label: "Falló", tone: "danger" },
  EXPIRED: { label: "Venció", tone: "neutral" },
};

function HistoryRow({ card, timeZone }: { card: ApprovalCard; timeZone?: string }) {
  const Icon = ACTION_ICON[card.type];
  const chip = STATUS_CHIP[card.status];
  return (
    <div className="flex items-center gap-3 px-4 py-3.5">
      <IconTile icon={Icon} tone="neutral" size="sm" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-ink">{card.title}</p>
        <p className="truncate text-xs text-muted">
          {ACTION_KIND_LABEL[card.type]}, {shortDate(card.createdAt, timeZone)}
          {card.amount !== null ? `, ${money(card.amount, card.currency ?? "USD", { cents: true })}` : ""}
        </p>
      </div>
      <Chip tone={chip.tone}>{chip.label}</Chip>
    </div>
  );
}

export function ApprovalsView({
  pending,
  history,
  preview = false,
  timeZone,
}: {
  pending: ApprovalCard[];
  history: ApprovalCard[];
  preview?: boolean;
  timeZone?: string;
}) {
  return (
    <PageBody className="max-w-4xl">
      <PageHeader title="Aprobaciones" description="Nada se paga, se envía ni se cancela sin tu visto bueno." />
      <Section title={pending.length > 0 ? `Por aprobar (${pending.length})` : "Por aprobar"}>
        {pending.length > 0 ? (
          <div className="grid items-start gap-4 md:grid-cols-2">
            {pending.map((card) => (
              <ApprovalSlip key={card.actionId} card={card} demo={preview} />
            ))}
          </div>
        ) : (
          <EmptyState
            icon={ShieldCheck}
            title="Todo al día"
            body="Cuando Omni prepare una compra, un correo o una cancelación, aparecerá aquí para que decidas."
          />
        )}
      </Section>
      {history.length > 0 ? (
        <Section title="Historial">
          <Panel>
            {history.map((card) => (
              <HistoryRow key={card.actionId} card={card} timeZone={timeZone} />
            ))}
          </Panel>
        </Section>
      ) : null}
    </PageBody>
  );
}
