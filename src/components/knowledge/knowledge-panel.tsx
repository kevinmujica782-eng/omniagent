"use client";

import { Loader, Plus, X } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { INPUT_CLASS, Notice, Panel, buttonClass } from "@/components/ui";
import { apiFetch, errorMessage } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { KNOWLEDGE_CATEGORIES, KNOWLEDGE_HINT, KNOWLEDGE_LABEL, KNOWLEDGE_LIMITS, type KnowledgeCategory, type KnowledgeView } from "@/modules/knowledge/knowledge.types";

// «Lo que Omni debe saber» (Cuenta): la persona escribe, por categoría, lo que quiere que Omni tenga siempre
// presente. A diferencia de la Memoria (lo que Omni deduce), esto lo escribe la persona a propósito.

function demoKnowledge(): KnowledgeView[] {
  const seed: Partial<Record<KnowledgeCategory, string[]>> = {
    GOALS: ["Juntar $2,500 para una moto antes de marzo"],
    RULES: ["Nunca compres nada sin preguntarme primero"],
    FINANCES: ["Cobro el día 30, en USDT por Binance"],
  };
  return KNOWLEDGE_CATEGORIES.map((category) => ({
    category,
    label: KNOWLEDGE_LABEL[category],
    hint: KNOWLEDGE_HINT[category],
    items: seed[category] ?? [],
    version: 0,
  }));
}

export function KnowledgePanel({ demo = false }: { demo?: boolean }) {
  const [groups, setGroups] = useState<KnowledgeView[] | null>(demo ? demoKnowledge() : null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<KnowledgeCategory | null>(null);
  const [drafts, setDrafts] = useState<Partial<Record<KnowledgeCategory, string>>>({});

  useEffect(() => {
    if (demo) return;
    let alive = true;
    apiFetch<{ knowledge: KnowledgeView[] }>("/api/v1/knowledge")
      .then((result) => alive && setGroups(result.knowledge))
      .catch((err) => alive && setError(errorMessage(err)));
    return () => {
      alive = false;
    };
  }, [demo]);

  async function save(category: KnowledgeCategory, items: string[]) {
    setBusy(category);
    setError(null);
    try {
      if (!demo) await apiFetch(`/api/v1/knowledge/${category}`, { method: "PUT", body: { items } });
      setGroups((list) => (list ?? []).map((g) => (g.category === category ? { ...g, items } : g)));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  function add(category: KnowledgeCategory, event: FormEvent) {
    event.preventDefault();
    const text = (drafts[category] ?? "").trim();
    if (!text) return;
    const current = groups?.find((g) => g.category === category)?.items ?? [];
    if (current.length >= KNOWLEDGE_LIMITS.itemsPerCategory) {
      setError(`Máximo ${KNOWLEDGE_LIMITS.itemsPerCategory} por categoría.`);
      return;
    }
    void save(category, [...current, text.slice(0, KNOWLEDGE_LIMITS.item)]);
    setDrafts((d) => ({ ...d, [category]: "" }));
  }

  function remove(category: KnowledgeCategory, index: number) {
    const current = groups?.find((g) => g.category === category)?.items ?? [];
    void save(category, current.filter((_, i) => i !== index));
  }

  if (groups === null && !error) {
    return (
      <Panel className="flex items-center gap-2 p-4 text-sm text-muted">
        <Loader className="size-4 animate-spin" aria-hidden />
        Cargando…
      </Panel>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="px-1 text-sm leading-relaxed text-muted">
        Escribe aquí lo que quieres que Omni tenga siempre presente. Lo usa en cada conversación. Nunca pongas
        contraseñas, tarjetas ni códigos.
      </p>

      {error ? <Notice tone="danger">{error}</Notice> : null}

      {(groups ?? []).map((group) => (
        <Panel key={group.category} className="p-4">
          <p className="text-sm font-semibold text-ink">{group.label}</p>
          <p className="mt-0.5 text-xs text-muted">{group.hint}</p>

          {group.items.length > 0 ? (
            <ul className="mt-3 flex flex-col gap-1.5">
              {group.items.map((item, index) => (
                <li key={`${group.category}-${index}`} className="flex items-start gap-2 rounded-lg bg-surface-2 px-3 py-2 text-sm text-ink">
                  <span className="min-w-0 flex-1 break-words">{item}</span>
                  <button
                    type="button"
                    onClick={() => remove(group.category, index)}
                    disabled={busy === group.category}
                    aria-label="Quitar"
                    className="shrink-0 text-muted hover:text-danger"
                  >
                    <X className="size-4" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}

          <form onSubmit={(e) => add(group.category, e)} className="mt-3 flex items-center gap-2">
            <input
              className={INPUT_CLASS}
              value={drafts[group.category] ?? ""}
              onChange={(e) => setDrafts((d) => ({ ...d, [group.category]: e.target.value }))}
              maxLength={KNOWLEDGE_LIMITS.item}
              placeholder="Agregar una línea…"
            />
            <button type="submit" className={cn(buttonClass("secondary"), "shrink-0")} disabled={busy === group.category}>
              {busy === group.category ? <Loader className="size-4 animate-spin" aria-hidden /> : <Plus className="size-4" aria-hidden />}
              Agregar
            </button>
          </form>
        </Panel>
      ))}
    </div>
  );
}
