import { ShieldCheck } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { AssistantTrigger } from "@/components/assistant/assistant-provider";
import { OmniMark } from "@/components/omni-mark";
import { cn } from "@/lib/cn";

/**
 * Encabezado con la identidad del agente: marca, nombre y qué está vigilando,
 * más el acceso a Aprobaciones con el número de pendientes. Con `summon`, tocar a Omni abre el asistente.
 */
export function AgentBar({
  status,
  pending,
  approvalsHref = "/aprobaciones",
  leading,
  thinking = false,
  summon = false,
}: {
  status: string;
  pending: number;
  approvalsHref?: string;
  leading?: ReactNode;
  thinking?: boolean;
  summon?: boolean;
}) {
  const identity = (
    <>
      <OmniMark size={34} thinking={thinking} />
      <span className="min-w-0 text-left leading-tight">
        <span className="block text-[15px] font-semibold text-ink">Omni</span>
        <span className="block truncate text-xs text-muted">{status}</span>
      </span>
    </>
  );
  return (
    <div className="flex h-16 shrink-0 items-center gap-3 border-b border-line bg-canvas px-4">
      {leading}
      {summon ? (
        <AssistantTrigger
          aria-label={`Hablar con Omni. ${status}`}
          className="group -mx-2 flex min-w-0 items-center gap-3 rounded-2xl px-2 py-1.5 transition-colors hover:bg-surface"
        >
          {identity}
          <kbd className="ml-1 hidden rounded-md border border-line px-1.5 py-0.5 font-sans text-[11px] text-muted group-hover:text-ink lg:inline">Ctrl K</kbd>
        </AssistantTrigger>
      ) : (
        <div className="flex min-w-0 items-center gap-3">{identity}</div>
      )}
      <Link
        href={approvalsHref}
        aria-label={pending > 0 ? `${pending} aprobaciones pendientes` : "Aprobaciones"}
        className={cn(
          "ml-auto inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3 text-sm font-semibold",
          pending > 0 ? "bg-attention-soft text-attention" : "border border-line bg-surface text-muted",
        )}
      >
        <ShieldCheck className="size-4" aria-hidden />
        {pending > 0 ? <span className="tabular-nums">{pending}</span> : null}
      </Link>
    </div>
  );
}
