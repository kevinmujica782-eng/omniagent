"use client";

import { Loader, Pin, PinOff, Trash2 } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { Chip, INPUT_CLASS, Panel, buttonClass } from "@/components/ui";
import { apiFetch, errorMessage } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { MEMORY_KINDS, MEMORY_KIND_LABEL, type MemoryKind, type MemoryView } from "@/modules/memory/memory.types";

// «Lo que Omni recuerda»: la persona ve todo lo que Omni guardó de ella, lo fija, lo borra o agrega algo.

type QuickKind = Extract<MemoryKind, "PREFERENCE" | "NOTE">;

const DEMO_MEMORIES: MemoryView[] = [
  {
    id: "demo-1",
    ref: "a1b2c3d4",
    kind: "PREFERENCE",
    title: "Respuestas cortas",
    summary: "Prefiere respuestas cortas y sin tecnicismos.",
    importance: 3,
    pinned: true,
    source: "AGENT",
    updatedAt: new Date().toISOString(),
  },
  {
    id: "demo-2",
    ref: "b2c3d4e5",
    kind: "FINANCE",
    title: "Sueldo",
    summary: "Ingreso: Sueldo, $1,200 al mes, el día 30. Cobra en USDT por Binance.",
    importance: 2,
    pinned: false,
    source: "AGENT",
    updatedAt: new Date().toISOString(),
  },
  {
    id: "demo-3",
    ref: "c3d4e5f6",
    kind: "WEBSITE",
    title: "Mi tienda",
    summary: "Mi tienda (https://mitienda.example, Netlify), publicada: tienda de accesorios para celulares.",
    importance: 2,
    pinned: false,
    source: "USER",
    updatedAt: new Date().toISOString(),
  },
  {
    id: "demo-4",
    ref: "d4e5f6a7",
    kind: "GOAL",
    title: "Comprar una moto",
    summary: "Comprar una moto: $2,500 para 2027-03-01. Por qué: para hacer entregas.",
    importance: 2,
    pinned: false,
    source: "AGENT",
    updatedAt: new Date().toISOString(),
  },
];

/** Título corto a partir del texto: las primeras palabras. */
function titleFrom(text: string): string {
  const words = text.trim().replace(/\s+/g, " ").split(" ").slice(0, 6).join(" ");
  return words.length > 60 ? `${words.slice(0, 59)}…` : words;
}

export function MemoryPanel({ demo = false }: { demo?: boolean }) {
  const [memories, setMemories] = useState<MemoryView[] | null>(demo ? DEMO_MEMORIES : null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const [quickKind, setQuickKind] = useState<QuickKind>("PREFERENCE");
  const [quickText, setQuickText] = useState("");

  useEffect(() => {
    if (demo) return;
    let alive = true;
    apiFetch<{ memories: MemoryView[] }>("/api/v1/memory")
      .then((result) => alive && setMemories(result.memories))
      .catch((err) => alive && setError(errorMessage(err)));
    return () => {
      alive = false;
    };
  }, [demo]);

  async function run(id: string, task: () => Promise<void>) {
    setBusy(id);
    setError(null);
    try {
      await task();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  function togglePin(memory: MemoryView) {
    void run(memory.id, async () => {
      const next = { ...memory, pinned: !memory.pinned };
      if (!demo) {
        const result = await apiFetch<{ memory: MemoryView }>(`/api/v1/memory/${memory.id}`, { method: "PATCH", body: { pinned: next.pinned } });
        Object.assign(next, result.memory);
      }
      setMemories((list) => (list ?? []).map((m) => (m.id === memory.id ? next : m)));
    });
  }

  function forget(memory: MemoryView) {
    void run(memory.id, async () => {
      if (!demo) await apiFetch(`/api/v1/memory/${memory.id}`, { method: "DELETE" });
      setMemories((list) => (list ?? []).filter((m) => m.id !== memory.id));
      setConfirmId(null);
    });
  }

  function forgetAll() {
    void run("all", async () => {
      if (!demo) await apiFetch("/api/v1/memory", { method: "DELETE", body: { confirm: "BORRAR" } });
      setMemories([]);
      setConfirmAll(false);
    });
  }

  function add(event: FormEvent) {
    event.preventDefault();
    const text = quickText.trim();
    if (text.length < 3) return;
    void run("add", async () => {
      const body =
        quickKind === "PREFERENCE"
          ? { kind: "PREFERENCE", title: titleFrom(text), data: { statement: text, topic: "otro", strength: "firme" } }
          : { kind: "NOTE", title: titleFrom(text), data: { text, about: "otro" } };
      const view: MemoryView = demo
        ? {
            id: `demo-${Date.now()}`,
            ref: "demo0000",
            kind: quickKind,
            title: body.title,
            summary: /[.!?]$/.test(text) ? text : `${text}.`,
            importance: 2,
            pinned: false,
            source: "USER",
            updatedAt: new Date().toISOString(),
          }
        : (await apiFetch<{ memory: MemoryView }>("/api/v1/memory", { method: "POST", body })).memory;
      setMemories((list) => [view, ...(list ?? []).filter((m) => m.id !== view.id)]);
      setQuickText("");
    });
  }

  const groups = MEMORY_KINDS.map((kind) => ({ kind, items: (memories ?? []).filter((m) => m.kind === kind) })).filter((g) => g.items.length > 0);

  return (
    <div className="flex flex-col gap-3">
      <p className="px-1 text-sm leading-relaxed text-muted">
        Omni guarda aquí lo que le cuentas (tus preferencias, datos de dinero, páginas web y metas) para recordarlo en cada
        conversación. Nunca guarda claves, tarjetas ni datos de salud.
      </p>

      {memories === null && !error ? (
        <Panel className="flex items-center gap-2 p-4 text-sm text-muted">
          <Loader className="size-4 animate-spin" aria-hidden />
          Cargando…
        </Panel>
      ) : null}

      {memories !== null && memories.length === 0 ? (
        <Panel className="p-4 text-sm leading-relaxed text-muted">
          Todavía no recuerda nada. Cuéntale en el chat, por ejemplo: «Recuerda que cobro el día 30» o «Mi tienda está en
          mitienda.com».
        </Panel>
      ) : null}

      {groups.map((group) => (
        <div key={group.kind}>
          <h3 className="mb-1.5 px-1 text-xs font-semibold uppercase tracking-wide text-muted">{MEMORY_KIND_LABEL[group.kind]}</h3>
          <Panel>
            {group.items.map((memory) => (
              <div key={memory.id} className="flex items-start gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-ink">
                    <span className="min-w-0 break-words">{memory.title}</span>
                    {memory.pinned ? <Chip tone="good">Siempre presente</Chip> : null}
                  </p>
                  <p className="mt-0.5 text-sm leading-relaxed text-muted">
                    {confirmId === memory.id ? "Omni lo va a olvidar. ¿Seguro?" : memory.summary}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {confirmId === memory.id ? (
                    <>
                      <button
                        type="button"
                        onClick={() => forget(memory)}
                        disabled={busy !== null}
                        className="text-sm font-semibold text-danger hover:underline"
                      >
                        {busy === memory.id ? "Borrando…" : "Olvidar"}
                      </button>
                      <button type="button" onClick={() => setConfirmId(null)} className="px-2 text-sm text-muted hover:text-ink">
                        Cancelar
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => togglePin(memory)}
                        disabled={busy !== null}
                        aria-label={memory.pinned ? `Dejar de fijar «${memory.title}»` : `Fijar «${memory.title}»`}
                        title={memory.pinned ? "Dejar de fijar" : "Fijar: Omni lo tendrá siempre presente"}
                        className="grid size-9 place-items-center rounded-xl text-muted hover:bg-surface-2 hover:text-ink"
                      >
                        {memory.pinned ? <PinOff className="size-4" aria-hidden /> : <Pin className="size-4" aria-hidden />}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmId(memory.id)}
                        disabled={busy !== null}
                        aria-label={`Olvidar «${memory.title}»`}
                        title="Olvidar"
                        className="grid size-9 place-items-center rounded-xl text-muted hover:bg-surface-2 hover:text-danger"
                      >
                        <Trash2 className="size-4" aria-hidden />
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </Panel>
        </div>
      ))}

      <form onSubmit={add} className="rounded-2xl border border-line bg-surface p-4">
        <p className="text-sm font-medium text-ink">Dile algo para que lo recuerde</p>
        <div className="mt-2 flex flex-col gap-2 sm:flex-row">
          <select
            value={quickKind}
            onChange={(e) => setQuickKind(e.target.value as QuickKind)}
            aria-label="Tipo"
            className={cn(INPUT_CLASS, "sm:w-40")}
          >
            <option value="PREFERENCE">Preferencia</option>
            <option value="NOTE">Otro dato</option>
          </select>
          <input
            value={quickText}
            onChange={(e) => setQuickText(e.target.value)}
            maxLength={quickKind === "PREFERENCE" ? 280 : 500}
            placeholder={quickKind === "PREFERENCE" ? "Prefiero que me avises solo lo urgente" : "Tengo una tienda de accesorios"}
            className={INPUT_CLASS}
          />
          <button type="submit" disabled={busy !== null || quickText.trim().length < 3} className={buttonClass("secondary")}>
            {busy === "add" ? "Guardando…" : "Guardar"}
          </button>
        </div>
      </form>

      {error ? (
        <p role="alert" className="px-1 text-sm text-danger">
          {error}
        </p>
      ) : null}

      {memories !== null && memories.length > 0 ? (
        <div className="px-1 text-sm">
          {confirmAll ? (
            <span className="flex flex-wrap items-center gap-3">
              <span className="text-muted">Omni olvidará todo lo que recuerda de ti.</span>
              <button type="button" onClick={forgetAll} disabled={busy !== null} className="font-semibold text-danger hover:underline">
                {busy === "all" ? "Borrando…" : "Sí, borrar todo"}
              </button>
              <button type="button" onClick={() => setConfirmAll(false)} className="text-muted hover:text-ink">
                Cancelar
              </button>
            </span>
          ) : (
            <button type="button" onClick={() => setConfirmAll(true)} className="text-muted underline-offset-2 hover:text-danger hover:underline">
              Borrar toda la memoria
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}
