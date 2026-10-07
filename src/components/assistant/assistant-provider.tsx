"use client";

import { usePathname } from "next/navigation";
import { createContext, useContext, useEffect, useMemo, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { OmniAssistant, type AssistantLinks, type AssistantPreset } from "./omni-assistant";
import type { LiveCounts } from "./quick-orders";

// El asistente se abre desde cualquier pantalla: la pestaña Omni del teléfono, la identidad de Omni en el encabezado
// o Ctrl+K / ⌘K en la compu. Se cierra con Escape, con la X o al ir a otra pantalla.

interface AssistantContextValue {
  openAssistant: () => void;
}

const AssistantContext = createContext<AssistantContextValue>({ openAssistant: () => undefined });

export function useAssistant(): AssistantContextValue {
  return useContext(AssistantContext);
}

export function AssistantProvider({
  children,
  status,
  counts,
  userId,
  links,
  demo = false,
  preset = null,
}: {
  children: ReactNode;
  status: string;
  counts: LiveCounts;
  userId: string | null;
  links: AssistantLinks;
  demo?: boolean;
  /** Vista previa: abre el asistente en un estado fijo. */
  preset?: AssistantPreset | null;
}) {
  const [open, setOpen] = useState(Boolean(preset));
  const pathname = usePathname();

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((current) => !current);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Al cambiar de pantalla, el asistente se cierra (en la vista previa, la pantalla es siempre /preview).
  useEffect(() => {
    if (!demo) setOpen(false);
  }, [pathname, demo]);

  const value = useMemo<AssistantContextValue>(() => ({ openAssistant: () => setOpen(true) }), []);

  return (
    <AssistantContext.Provider value={value}>
      {children}
      {open ? (
        <OmniAssistant
          onClose={() => setOpen(false)}
          status={status}
          counts={counts}
          userId={userId}
          links={links}
          demo={demo}
          preset={preset ?? undefined}
        />
      ) : null}
    </AssistantContext.Provider>
  );
}

/** Botón que abre el asistente (sin estilo propio: lo pone quien lo usa). */
export function AssistantTrigger({ children, onClick, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode }) {
  const { openAssistant } = useAssistant();
  return (
    <button
      type="button"
      aria-haspopup="dialog"
      {...props}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) openAssistant();
      }}
    >
      {children}
    </button>
  );
}
