"use client";

import { Download } from "lucide-react";
import { useEffect, useState } from "react";
import { buttonClass } from "@/components/ui";
import { cn } from "@/lib/cn";

type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

/** «Instalar» de Chrome (sin descargar archivos). Solo aparece cuando el navegador lo ofrece. */
export function InstallPwaButton({ className }: { className?: string }) {
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    function onPrompt(event: Event) {
      event.preventDefault();
      setPrompt(event as InstallPrompt);
    }
    function onInstalled() {
      setInstalled(true);
      setPrompt(null);
    }
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (installed) return <p className={cn("text-sm font-medium text-primary", className)}>Listo: OmniAgent quedó instalada.</p>;
  if (!prompt) return null;
  return (
    <button
      type="button"
      onClick={async () => {
        await prompt.prompt();
        const choice = await prompt.userChoice.catch(() => null);
        if (choice?.outcome === "accepted") setInstalled(true);
        setPrompt(null);
      }}
      className={cn(buttonClass("secondary", "lg"), className)}
    >
      <Download className="size-4" aria-hidden />
      Instalar desde el navegador
    </button>
  );
}
