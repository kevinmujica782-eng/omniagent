"use client";

import { ChevronLeft, X } from "lucide-react";
import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * Diálogo modal: hoja inferior en el teléfono y ventana centrada en pantallas grandes.
 * Atrapa el foco, se cierra con Escape y devuelve el foco al botón que lo abrió.
 */
export function Dialog({
  title,
  onClose,
  onBack,
  closable = true,
  children,
  className,
}: {
  title: string;
  onClose: () => void;
  onBack?: () => void;
  closable?: boolean;
  children: ReactNode;
  className?: string;
}) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panelRef.current?.focus();
    return () => previous?.focus();
  }, []);

  function close() {
    if (closable) onClose();
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.stopPropagation();
      close();
      return;
    }
    if (event.key !== "Tab" || !panelRef.current) return;
    const focusables = [
      ...panelRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), a[href], select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    ];
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6">
      <button
        type="button"
        tabIndex={-1}
        aria-label="Cerrar"
        onClick={close}
        className="absolute inset-0 h-full w-full cursor-default bg-black/40"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className={cn(
          "relative flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-3xl bg-surface text-left shadow-float outline-none sm:max-w-md sm:rounded-3xl",
          className,
        )}
      >
        <header className="flex items-center gap-2 px-3 pt-3">
          {onBack ? (
            <button
              type="button"
              onClick={onBack}
              aria-label="Atrás"
              className="grid size-9 place-items-center rounded-full text-muted transition-colors hover:bg-surface-2 hover:text-ink"
            >
              <ChevronLeft className="size-5" aria-hidden />
            </button>
          ) : (
            <span className="size-9" aria-hidden />
          )}
          <p id={titleId} className="flex-1 text-center text-sm font-semibold text-ink">
            {title}
          </p>
          {closable ? (
            <button
              type="button"
              onClick={close}
              aria-label="Cerrar"
              className="grid size-9 place-items-center rounded-full text-muted transition-colors hover:bg-surface-2 hover:text-ink"
            >
              <X className="size-5" aria-hidden />
            </button>
          ) : (
            <span className="size-9" aria-hidden />
          )}
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6 pt-2">{children}</div>
      </div>
    </div>
  );
}
