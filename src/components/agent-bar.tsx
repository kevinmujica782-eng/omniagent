import { ShieldCheck } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { OmniMark } from "@/components/omni-mark";
import { cn } from "@/lib/cn";

/**
 * Encabezado con la identidad del agente: marca, nombre y qué está vigilando,
 * más el acceso a Aprobaciones con el número de pendientes.
 */
export function AgentBar({
  status,
  pending,
  approvalsHref = "/aprobaciones",
  leading,
  thinking = false,
}: {
  status: string;
  pending: number;
  approvalsHref?: string;
  leading?: ReactNode;
  thinking?: boolean;
}) {
  return (
    <div className="flex h-16 shrink-0 items-center gap-3 border-b border-line bg-canvas px-4">
      {leading}
      <OmniMark size={34} thinking={thinking} />
      <div className="min-w-0 leading-tight">
        <p className="text-[15px] font-semibold text-ink">Omni</p>
        <p className="truncate text-xs text-muted">{status}</p>
      </div>
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
