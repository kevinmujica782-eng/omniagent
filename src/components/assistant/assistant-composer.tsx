"use client";

import { ArrowUp, Mic, Square } from "lucide-react";
import type { FormEvent, RefObject } from "react";
import { cn } from "@/lib/cn";

/**
 * Dónde se da la orden: escribiendo o con la voz. El botón grande es el micrófono; cuando hay texto, pasa a ser
 * «Enviar». Mientras escucha, el mismo botón detiene el dictado y Omni procesa lo que oyó.
 */
export function AssistantComposer({
  value,
  onChange,
  onSubmit,
  onMic,
  listening,
  busy,
  micSupported,
  inputRef,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onMic: () => void;
  listening: boolean;
  /** Omni está procesando: no se puede mandar otra orden todavía. */
  busy: boolean;
  micSupported: boolean;
  inputRef: RefObject<HTMLInputElement | null>;
}) {
  const typed = value.trim().length > 0;
  const showSend = typed || !micSupported;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (typed && !busy) onSubmit();
  }

  return (
    <form onSubmit={submit} className="flex items-center gap-2">
      <label className="sr-only" htmlFor="omni-order">
        Tu orden para Omni
      </label>
      <input
        id="omni-order"
        ref={inputRef}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={listening}
        maxLength={1000}
        autoComplete="off"
        enterKeyHint="send"
        placeholder={listening ? "Te escucho…" : micSupported ? "Dile a Omni qué hacer" : "Escribe tu orden para Omni"}
        className="h-14 min-w-0 flex-1 rounded-full border border-line-strong bg-surface px-5 text-base text-ink placeholder:text-muted focus:border-primary focus:outline-none disabled:opacity-60"
      />
      {showSend ? (
        <button
          type="submit"
          disabled={!typed || busy}
          aria-label="Enviar orden"
          className="grid size-14 shrink-0 place-items-center rounded-full bg-primary text-on-primary transition-transform active:scale-95 disabled:opacity-40"
        >
          <ArrowUp className="size-6" aria-hidden />
        </button>
      ) : (
        <button
          type="button"
          onClick={onMic}
          disabled={busy}
          aria-pressed={listening}
          aria-label={listening ? "Dejar de escuchar" : "Hablarle a Omni"}
          className={cn(
            "relative grid size-14 shrink-0 place-items-center rounded-full transition-transform active:scale-95 disabled:opacity-40",
            listening ? "bg-ink text-canvas" : "bg-primary text-on-primary",
          )}
        >
          {listening ? (
            <>
              <span className="absolute inset-0 animate-ping rounded-full bg-primary/30 motion-reduce:hidden" aria-hidden />
              <Square className="relative size-5 fill-current" aria-hidden />
            </>
          ) : (
            <Mic className="size-6" aria-hidden />
          )}
        </button>
      )}
    </form>
  );
}
