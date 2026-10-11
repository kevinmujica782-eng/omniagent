"use client";

import { Check, Loader, Pencil, Plus, Sparkles, Star, Trash2, X } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { Chip, INPUT_CLASS, Notice, Panel, buttonClass } from "@/components/ui";
import { apiFetch, errorMessage } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { DOT_LIMITS, DOT_MODULES, DOT_MODULE_LABEL, type AssistantView, type DotModule } from "@/modules/assistants/assistants.types";

// «Tus Dots» (Cuenta): la persona crea asistentes con su nombre, rol, personalidad e instrucciones, marca uno por
// defecto (el que usa el chat) y archiva los que no usa. En la vista previa todo es local, sin API.

const DEMO_DOTS: AssistantView[] = [
  {
    id: "demo-dot-1",
    name: "Ahorrista",
    role: "Me cuida el bolsillo",
    personality: "Directo y sin rodeos. Me dice las cosas claras cuando estoy gastando de más.",
    instructions: "Avísame apenas un gasto hormiga pase de $50 en el mes. Prioriza pagar deudas antes que ahorrar.",
    modules: ["FINANCE", "GOALS"],
    isDefault: true,
    createdAt: new Date().toISOString(),
  },
  {
    id: "demo-dot-2",
    name: "Cazador",
    role: "Busca ofertas y compra por mí",
    personality: "Entusiasta pero paciente. No me deja comprar por impulso.",
    instructions: "Avísame solo si el precio baja más del 20%. Nunca compres sin preguntarme primero.",
    modules: ["CONCIERGE"],
    isDefault: false,
    createdAt: new Date().toISOString(),
  },
];

type Draft = {
  name: string;
  role: string;
  personality: string;
  instructions: string;
  modules: DotModule[];
};

const EMPTY: Draft = { name: "", role: "", personality: "", instructions: "", modules: [] };

function draftOf(dot: AssistantView): Draft {
  return { name: dot.name, role: dot.role, personality: dot.personality, instructions: dot.instructions, modules: dot.modules };
}

export function DotsPanel({ demo = false }: { demo?: boolean }) {
  const [dots, setDots] = useState<AssistantView[] | null>(demo ? DEMO_DOTS : null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // null = sin formulario; "new" = creando; un id = editando ese Dot.
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [confirmArchive, setConfirmArchive] = useState<string | null>(null);

  useEffect(() => {
    if (demo) return;
    let alive = true;
    apiFetch<{ assistants: AssistantView[] }>("/api/v1/assistants")
      .then((result) => alive && setDots(result.assistants))
      .catch((err) => alive && setError(errorMessage(err)));
    return () => {
      alive = false;
    };
  }, [demo]);

  async function run(key: string, task: () => Promise<void>) {
    setBusy(key);
    setError(null);
    try {
      await task();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  function openCreate() {
    setDraft(EMPTY);
    setEditing("new");
    setError(null);
  }

  function openEdit(dot: AssistantView) {
    setDraft(draftOf(dot));
    setEditing(dot.id);
    setError(null);
  }

  function toggleModule(module: DotModule) {
    setDraft((d) => ({
      ...d,
      modules: d.modules.includes(module) ? d.modules.filter((m) => m !== module) : [...d.modules, module],
    }));
  }

  function save(event: FormEvent) {
    event.preventDefault();
    const name = draft.name.trim();
    const role = draft.role.trim();
    if (!name || !role) {
      setError("Ponle un nombre y di qué hace.");
      return;
    }
    const body = {
      name,
      role,
      personality: draft.personality.trim(),
      instructions: draft.instructions.trim(),
      modules: draft.modules,
    };
    void run("form", async () => {
      if (editing === "new") {
        const first = (dots ?? []).length === 0;
        const created: AssistantView = demo
          ? { id: `demo-${Date.now()}`, ...body, isDefault: first, createdAt: new Date().toISOString() }
          : (await apiFetch<{ assistant: AssistantView }>("/api/v1/assistants", { method: "POST", body })).assistant;
        setDots((list) => withOneDefault([...(list ?? []), created], created.isDefault ? created.id : null));
      } else if (editing) {
        const updated: AssistantView = demo
          ? { ...(dots ?? []).find((d) => d.id === editing)!, ...body }
          : (await apiFetch<{ assistant: AssistantView }>(`/api/v1/assistants/${editing}`, { method: "PATCH", body })).assistant;
        setDots((list) => (list ?? []).map((d) => (d.id === updated.id ? updated : d)));
      }
      setEditing(null);
      setDraft(EMPTY);
    });
  }

  function makeDefault(dot: AssistantView) {
    if (dot.isDefault) return;
    void run(dot.id, async () => {
      if (!demo) await apiFetch(`/api/v1/assistants/${dot.id}`, { method: "PATCH", body: { isDefault: true } });
      setDots((list) => withOneDefault(list ?? [], dot.id));
    });
  }

  function archive(dot: AssistantView) {
    void run(dot.id, async () => {
      if (!demo) await apiFetch(`/api/v1/assistants/${dot.id}`, { method: "DELETE" });
      setDots((list) => (list ?? []).filter((d) => d.id !== dot.id));
      setConfirmArchive(null);
    });
  }

  if (dots === null && !error) {
    return (
      <Panel className="flex items-center gap-2 p-4 text-sm text-muted">
        <Loader className="size-4 animate-spin" aria-hidden />
        Cargando…
      </Panel>
    );
  }

  const list = dots ?? [];

  return (
    <div className="flex flex-col gap-3">
      <p className="px-1 text-sm leading-relaxed text-muted">
        Un Dot es un asistente a tu medida: le das un nombre, un rol y le dices cómo quieres que te hable y qué priorice.
        El Dot <span className="font-medium text-ink">por defecto</span> es el que te responde en el chat.
      </p>

      {error ? <Notice tone="danger">{error}</Notice> : null}

      {list.map((dot) => (
        <Panel key={dot.id} className="p-4">
          {editing === dot.id ? (
            <DotForm
              draft={draft}
              setDraft={setDraft}
              toggleModule={toggleModule}
              onSave={save}
              onCancel={() => setEditing(null)}
              busy={busy === "form"}
            />
          ) : (
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink">
                  <Sparkles className="size-4 text-orbit" aria-hidden />
                  <span className="break-words">{dot.name}</span>
                  {dot.isDefault ? <Chip tone="good">Por defecto</Chip> : null}
                </p>
                <p className="mt-0.5 text-sm text-muted">{dot.role}</p>
                {dot.personality ? <p className="mt-2 text-sm leading-relaxed text-ink">{dot.personality}</p> : null}
                {dot.instructions ? (
                  <p className="mt-1.5 text-sm leading-relaxed text-muted">
                    <span className="font-medium text-ink">Instrucciones:</span> {dot.instructions}
                  </p>
                ) : null}
                {dot.modules.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {dot.modules.map((m) => (
                      <Chip key={m}>{DOT_MODULE_LABEL[m]}</Chip>
                    ))}
                  </div>
                ) : null}

                {confirmArchive === dot.id ? (
                  <div className="mt-3 flex items-center gap-3">
                    <span className="text-sm text-muted">¿Archivar este Dot?</span>
                    <button
                      type="button"
                      onClick={() => archive(dot)}
                      disabled={busy !== null}
                      className="text-sm font-semibold text-danger hover:underline"
                    >
                      {busy === dot.id ? "Archivando…" : "Sí, archivar"}
                    </button>
                    <button type="button" onClick={() => setConfirmArchive(null)} className="text-sm text-muted hover:underline">
                      No
                    </button>
                  </div>
                ) : (
                  <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
                    {!dot.isDefault ? (
                      <button
                        type="button"
                        onClick={() => makeDefault(dot)}
                        disabled={busy !== null}
                        className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
                      >
                        <Star className="size-3.5" aria-hidden />
                        {busy === dot.id ? "Guardando…" : "Usar por defecto"}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => openEdit(dot)}
                      className="inline-flex items-center gap-1.5 text-sm font-medium text-ink hover:underline"
                    >
                      <Pencil className="size-3.5" aria-hidden />
                      Editar
                    </button>
                    {!dot.isDefault ? (
                      <button
                        type="button"
                        onClick={() => setConfirmArchive(dot.id)}
                        className="inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-danger"
                      >
                        <Trash2 className="size-3.5" aria-hidden />
                        Archivar
                      </button>
                    ) : null}
                  </div>
                )}
              </div>
            </div>
          )}
        </Panel>
      ))}

      {list.length === 0 && editing !== "new" ? (
        <Panel className="p-4 text-sm leading-relaxed text-muted">
          Todavía no tienes Dots. Crea el primero y será el que te responda en el chat.
        </Panel>
      ) : null}

      {editing === "new" ? (
        <Panel className="p-4">
          <DotForm
            draft={draft}
            setDraft={setDraft}
            toggleModule={toggleModule}
            onSave={save}
            onCancel={() => setEditing(null)}
            busy={busy === "form"}
          />
        </Panel>
      ) : (
        <button
          type="button"
          onClick={openCreate}
          className={cn(buttonClass("secondary"), "self-start")}
          disabled={list.length >= DOT_LIMITS.perUser}
        >
          <Plus className="size-4" aria-hidden />
          Crear un Dot
        </button>
      )}
    </div>
  );
}

function DotForm({
  draft,
  setDraft,
  toggleModule,
  onSave,
  onCancel,
  busy,
}: {
  draft: Draft;
  setDraft: (fn: (d: Draft) => Draft) => void;
  toggleModule: (m: DotModule) => void;
  onSave: (event: FormEvent) => void;
  onCancel: () => void;
  busy: boolean;
}) {
  return (
    <form onSubmit={onSave} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <label className="px-1 text-xs font-medium text-muted">Nombre</label>
        <input
          className={INPUT_CLASS}
          value={draft.name}
          onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
          maxLength={DOT_LIMITS.name}
          placeholder="Ahorrista"
          autoFocus
        />
      </div>
      <div className="flex flex-col gap-1">
        <label className="px-1 text-xs font-medium text-muted">¿Qué hace?</label>
        <input
          className={INPUT_CLASS}
          value={draft.role}
          onChange={(e) => setDraft((d) => ({ ...d, role: e.target.value }))}
          maxLength={DOT_LIMITS.role}
          placeholder="Me cuida el bolsillo"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label className="px-1 text-xs font-medium text-muted">Personalidad (opcional)</label>
        <textarea
          className={cn(INPUT_CLASS, "min-h-16 resize-y")}
          value={draft.personality}
          onChange={(e) => setDraft((d) => ({ ...d, personality: e.target.value }))}
          maxLength={DOT_LIMITS.personality}
          placeholder="Directo y sin rodeos. Me dice las cosas claras."
        />
      </div>
      <div className="flex flex-col gap-1">
        <label className="px-1 text-xs font-medium text-muted">Instrucciones (opcional)</label>
        <textarea
          className={cn(INPUT_CLASS, "min-h-20 resize-y")}
          value={draft.instructions}
          onChange={(e) => setDraft((d) => ({ ...d, instructions: e.target.value }))}
          maxLength={DOT_LIMITS.instructions}
          placeholder="Avísame si un gasto hormiga pasa de $50 al mes. Nunca compres sin preguntarme."
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="px-1 text-xs font-medium text-muted">En qué se enfoca (opcional)</label>
        <div className="flex flex-wrap gap-2">
          {DOT_MODULES.map((m) => {
            const on = draft.modules.includes(m);
            return (
              <button
                key={m}
                type="button"
                onClick={() => toggleModule(m)}
                className={cn(
                  "inline-flex items-center gap-1 rounded-full border px-3 py-1 text-sm font-medium transition-colors",
                  on ? "border-primary bg-primary-soft text-primary" : "border-line bg-surface text-muted hover:border-line-strong",
                )}
              >
                {on ? <Check className="size-3.5" aria-hidden /> : null}
                {DOT_MODULE_LABEL[m]}
              </button>
            );
          })}
        </div>
      </div>
      <div className="mt-1 flex items-center gap-2">
        <button type="submit" className={buttonClass("primary")} disabled={busy}>
          {busy ? "Guardando…" : "Guardar"}
        </button>
        <button type="button" onClick={onCancel} className={buttonClass("ghost")} disabled={busy}>
          <X className="size-4" aria-hidden />
          Cancelar
        </button>
      </div>
    </form>
  );
}

/** Deja un solo Dot por defecto en la lista (espejo del trigger de la base), o ninguno si defaultId es null. */
function withOneDefault(list: AssistantView[], defaultId: string | null): AssistantView[] {
  if (defaultId === null) return list;
  return list.map((d) => ({ ...d, isDefault: d.id === defaultId }));
}
