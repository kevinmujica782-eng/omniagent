"use client";

import { Check, LoaderCircle } from "lucide-react";
import { useState } from "react";
import { autoProviderOf, modelLabel, planModelOf } from "@/lib/ai-copy";
import { apiFetch, errorMessage } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { AI_PROVIDER_LABEL, type AIModelsView, type AIProviderId } from "@/types/ai";

// Cuenta → Modelo de IA: con qué modelo responde Omni en el chat y el asistente. Automático usa el orden del router
// y cambia de modelo si uno no responde; con un modelo elegido, se usa ese primero (y otro si no responde).

type Choice = "auto" | AIProviderId;

interface Row {
  id: Choice;
  title: string;
  detail: string;
  /** A la derecha del título: Recomendado, Sin respuesta ahora... */
  note: string | null;
  disabled: boolean;
}

/** En el orden en que los prueba el automático (los que no están en el orden, al final). */
function byRouterOrder(view: AIModelsView): AIModelsView["providers"] {
  const rank = (id: AIProviderId) => {
    const index = view.order.indexOf(id);
    return index === -1 ? view.order.length : index;
  };
  return [...view.providers].sort((a, b) => rank(a.id) - rank(b.id));
}

function rowsOf(view: AIModelsView): Row[] {
  const auto = autoProviderOf(view);
  return [
    {
      id: "auto",
      title: "Automático",
      detail: auto
        ? `Omni usa ${AI_PROVIDER_LABEL[auto].assistant} y cambia a otro si no responde.`
        : "Todavía no hay modelos de IA configurados en Omni.",
      note: "Recomendado",
      disabled: false,
    },
    ...byRouterOrder(view).map((provider) => {
      const model = planModelOf(provider);
      return {
        id: provider.id,
        title: provider.assistant,
        detail: provider.configured
          ? `De ${provider.company}. Usa ${model ? modelLabel(model) : "su modelo rápido"}.`
          : `De ${provider.company}. Todavía no está disponible en Omni.`,
        note: provider.configured && !provider.available ? "Sin respuesta ahora" : null,
        disabled: !provider.configured,
      };
    }),
  ];
}

export function ModelPicker({ initial, demo = false }: { initial: AIModelsView; demo?: boolean }) {
  const [view, setView] = useState(initial);
  const [saving, setSaving] = useState<Choice | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Si el modelo elegido ya no tiene llave en Omni, responde el automático (y vuelve a usarse si regresa).
  const preferred = view.providers.find((provider) => provider.id === view.preference && provider.configured);
  const selected: Choice = preferred?.id ?? "auto";

  async function choose(choice: Choice) {
    if (choice === selected || saving) return;
    setError(null);
    if (demo) {
      setView({ ...view, preference: choice === "auto" ? null : choice });
      return;
    }
    setSaving(choice);
    try {
      setView(await apiFetch<AIModelsView>("/api/v1/ai/preference", { method: "PUT", body: { provider: choice } }));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(null);
    }
  }

  return (
    <div>
      <div role="radiogroup" aria-label="Modelo de IA" className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
        {rowsOf(view).map((row) => {
          const active = selected === row.id;
          return (
            <button
              key={row.id}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={row.disabled || saving !== null}
              onClick={() => void choose(row.id)}
              className={cn(
                "flex w-full items-start gap-3 px-4 py-3 text-left transition-colors",
                row.disabled ? "cursor-not-allowed" : "hover:bg-surface-2",
              )}
            >
              <span
                className={cn(
                  "mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border",
                  active ? "border-primary bg-primary text-on-primary" : "border-line-strong",
                  row.disabled && "opacity-50",
                )}
              >
                {saving === row.id ? (
                  <LoaderCircle className="size-3.5 animate-spin text-muted motion-reduce:animate-none" aria-hidden />
                ) : active ? (
                  <Check className="size-3.5" aria-hidden />
                ) : null}
              </span>
              <span className="min-w-0 flex-1 text-sm">
                <span className="flex items-baseline justify-between gap-3">
                  <span className={cn("font-semibold", row.disabled ? "text-muted" : "text-ink")}>{row.title}</span>
                  {row.note ? (
                    <span className={cn("shrink-0 text-xs", row.id === "auto" ? "font-medium text-primary" : "text-attention")}>{row.note}</span>
                  ) : null}
                </span>
                <span className="mt-0.5 block leading-relaxed text-muted">{row.detail}</span>
              </span>
            </button>
          );
        })}
      </div>
      {error ? (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      ) : null}
      <p className="mt-3 text-sm leading-relaxed text-muted">
        {view.plan === "PRO" ? "Con Pro, cada uno usa su modelo más capaz." : "En el plan Gratis, cada uno usa su modelo rápido; con Pro, el más capaz."} Si el
        que elegiste no responde, contesta otro para que no te quedes sin respuesta.
      </p>
    </div>
  );
}
