import { ArrowUp, Menu } from "lucide-react";
import type { ReactNode } from "react";
import { AgentBar } from "@/components/agent-bar";

/** Pantalla de teléfono (375 px reales, escalada) para la landing: muestra componentes reales con datos de ejemplo. */
export function PhoneFrame({
  children,
  status,
  pending = 0,
  composer = true,
  label,
}: {
  children: ReactNode;
  status: string;
  pending?: number;
  composer?: boolean;
  label: string;
}) {
  return (
    <div className="phone mx-auto" aria-label={label}>
      <div className="phone-viewport">
        <div className="phone-screen flex flex-col">
          <div className="flex h-9 shrink-0 items-center justify-between px-7 pt-1 text-xs font-semibold text-ink">
            <span className="tabular-nums">9:41</span>
            <span className="flex h-3 w-6 items-center rounded-[4px] border border-ink p-[2px]" aria-hidden>
              <span className="h-full w-3/4 rounded-[2px] bg-ink" />
            </span>
          </div>
          <AgentBar
            status={status}
            pending={pending}
            leading={
              <span className="grid size-10 shrink-0 place-items-center rounded-full border border-line bg-surface text-ink" aria-hidden>
                <Menu className="size-5" />
              </span>
            }
          />
          <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
          {composer ? (
            <div className="shrink-0 border-t border-line bg-canvas px-3 pb-6 pt-3">
              <div className="flex items-center gap-2 rounded-3xl border border-line-strong bg-surface py-1.5 pl-4 pr-1.5">
                <span className="flex-1 text-[15px] text-muted">Escríbele a Omni</span>
                <span className="grid size-10 place-items-center rounded-full bg-line text-muted" aria-hidden>
                  <ArrowUp className="size-5" />
                </span>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
