"use client";

import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { LinkAccountDialog, type LinkStep } from "@/components/finance/link-account-dialog";
import { buttonClass, type ButtonSize, type ButtonVariant } from "@/components/ui";
import { cn } from "@/lib/cn";
import type { InsightsCard } from "@/types/cards";

/** Botón que abre el diálogo para conectar bancos y tarjetas. */
export function ConnectBankButton({
  label = "Conectar cuenta",
  variant = "primary",
  size = "md",
  icon = true,
  className,
  connectedInstitutions,
  demo = false,
  demoInsights = null,
  initialStep,
}: {
  label?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: boolean;
  className?: string;
  connectedInstitutions?: string[];
  demo?: boolean;
  demoInsights?: InsightsCard | null;
  /** Vista previa: el diálogo aparece abierto en este paso. */
  initialStep?: LinkStep;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(Boolean(initialStep));
  const [, startTransition] = useTransition();

  function onClose(linked: boolean) {
    setOpen(false);
    if (linked) startTransition(() => router.refresh());
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        className={cn(buttonClass(variant, size), className)}
      >
        {icon ? <Plus className="size-4" aria-hidden /> : null}
        {label}
      </button>
      {open ? (
        <LinkAccountDialog
          onClose={onClose}
          demo={demo}
          demoInsights={demoInsights}
          connectedInstitutions={connectedInstitutions}
          initialStep={initialStep}
        />
      ) : null}
    </>
  );
}
