"use client";

import { Moon, Sun, SunMoon, type LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { applyTheme, currentTheme, type ThemePref } from "@/lib/theme";

const OPTIONS: { value: ThemePref; label: string; icon: LucideIcon }[] = [
  { value: "system", label: "Sistema", icon: SunMoon },
  { value: "light", label: "Claro", icon: Sun },
  { value: "dark", label: "Oscuro", icon: Moon },
];

function useTheme(): [ThemePref, (pref: ThemePref) => void] {
  const [theme, setTheme] = useState<ThemePref>("system");
  useEffect(() => setTheme(currentTheme()), []);
  return [
    theme,
    (pref) => {
      applyTheme(pref);
      setTheme(pref);
    },
  ];
}

/** Selector de tres opciones (Cuenta → Apariencia). */
export function ThemeSelector() {
  const [theme, setTheme] = useTheme();
  return (
    <div role="radiogroup" aria-label="Tema" className="grid grid-cols-3 gap-1 rounded-2xl border border-line bg-surface-2 p-1">
      {OPTIONS.map(({ value, label, icon: Icon }) => {
        const active = theme === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => setTheme(value)}
            className={cn(
              "flex items-center justify-center gap-1.5 rounded-xl px-2 py-2 text-sm transition-colors",
              active ? "bg-surface font-semibold text-ink shadow-card" : "text-muted hover:text-ink",
            )}
          >
            <Icon className="size-4" aria-hidden />
            {label}
          </button>
        );
      })}
    </div>
  );
}

/** Botón compacto que alterna Sistema → Claro → Oscuro (encabezado del Inicio). */
export function ThemeCycleButton({ className }: { className?: string }) {
  const [theme, setTheme] = useTheme();
  const index = OPTIONS.findIndex((o) => o.value === theme);
  const current = OPTIONS[index] ?? OPTIONS[0];
  const next = OPTIONS[(index + 1) % OPTIONS.length];
  const Icon = current.icon;
  return (
    <button
      type="button"
      onClick={() => setTheme(next.value)}
      aria-label={`Tema: ${current.label}. Cambiar a ${next.label}`}
      title={`Tema: ${current.label}`}
      className={cn(
        "grid size-10 shrink-0 place-items-center rounded-full border border-line bg-surface text-ink transition-colors hover:bg-surface-2",
        className,
      )}
    >
      <Icon className="size-[18px]" aria-hidden />
    </button>
  );
}
