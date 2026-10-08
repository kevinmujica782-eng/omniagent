"use client";

import { MessageCircle, ShieldCheck, Volume2, VolumeX, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useReducer, useRef, useState, type KeyboardEvent } from "react";
import { ApiError, apiFetch, errorMessage } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import type { ChatMessageView } from "@/types/cards";
import {
  INITIAL_ASSISTANT,
  PHASE_LABEL,
  assistantReducer,
  detectIntent,
  phaseDetail,
  speechErrorMessage,
  summarizeReply,
  type AssistantPhase,
  type AssistantReply,
  type AssistantState,
  type InputVia,
} from "./assistant-model";
import { AssistantComposer } from "./assistant-composer";
import { OmniEye } from "./omni-eye";
import { QuickOrders, type LiveCounts, type QuickOrder } from "./quick-orders";
import { useAudioLevel } from "./use-audio-level";
import { useLiveApprovals, type LiveApproval } from "./use-live-approvals";
import { useSpeechInput } from "./use-speech-input";
import { useSpeechOutput } from "./use-speech-output";

// El asistente interactivo de Omni: siempre oscuro, a pantalla completa en el teléfono y como panel en la compu.
// Arriba, el ojo de Omni con su estado en vivo; en el medio, lo que dijiste y lo que respondió; abajo, las órdenes
// rápidas y el campo para hablar o escribir. Las órdenes van al mismo agente que el chat (/api/v1/agent/chat).

export interface AssistantLinks {
  /** El chat de la conversación del asistente (o uno nuevo). */
  chat: (conversationId: string | null) => string;
  approvals: string;
}

/** Vista previa: el asistente abre en un estado fijo, sin micrófono ni API. */
export interface AssistantPreset {
  state: AssistantState;
  draft?: string;
  news?: LiveApproval | null;
}

const VOICE_KEY = "omni-assistant-voice";

const DOT: Record<AssistantPhase, string> = {
  idle: "bg-muted",
  listening: "bg-primary animate-pulse",
  processing: "bg-orbit animate-pulse",
  active: "bg-primary",
  error: "bg-danger",
};

const DEMO_REPLIES: { match: RegExp; reply: string; approvals?: number; suggestions?: string[] }[] = [
  {
    match: /correo|tramite|trámite/i,
    reply: "Encontré 2 trámites en tu correo. El permiso de la excursión vence el viernes: te propuse llenarlo mañana a las 6 p. m.",
    suggestions: ["Llena el permiso con mis datos", "¿Qué vence esta semana?"],
  },
  {
    match: /pendiente|aprobar/i,
    reply: "Tienes 3 cosas por aprobar: la compra de los audífonos, cancelar Cine+ y el correo a la escuela.",
    approvals: 3,
  },
  {
    match: /dinero|gasto|gastos/i,
    reply: "Este mes gastaste $1,284. Lo que más subió fue delivery: $186, un 48% más que el mes pasado.",
    suggestions: ["Ayúdame con un presupuesto para delivery"],
  },
  { match: /precio|vigila/i, reply: "Listo: vigilo ese precio y te aviso cuando baje de verdad, no por un cambio de un día." },
  { match: /pedido/i, reply: "Tu pedido de SonidoMax va 2 días tarde. Te dejé el reclamo listo para que lo apruebes.", approvals: 1 },
  { match: /recuerda/i, reply: "Lo recordaré." },
];

function demoReply(text: string): Promise<AssistantReply> {
  const found = DEMO_REPLIES.find((r) => r.match.test(text));
  return new Promise((resolve) =>
    setTimeout(
      () =>
        resolve({
          text: found?.reply ?? "Esto es una vista previa: con tu cuenta, Omni hace esto de verdad.",
          suggestions: found?.suggestions ?? [],
          approvals: found?.approvals ?? 0,
          cards: found?.approvals ?? 0,
          conversationId: "demo",
        }),
      1400,
    ),
  );
}

async function askOmni(message: string, conversationId: string | null): Promise<AssistantReply> {
  const data = await apiFetch<{ conversationId: string; message: ChatMessageView }>("/api/v1/agent/chat", {
    method: "POST",
    body: { message, conversationId: conversationId ?? undefined, module: conversationId ? undefined : detectIntent(message).module },
  });
  return summarizeReply(data.message, data.conversationId);
}

/** La voz viene encendida: si le hablas a Omni, te responde hablando. Apagada, responde solo con texto. */
function readVoicePreference(): boolean {
  try {
    return window.localStorage.getItem(VOICE_KEY) !== "0";
  } catch {
    return true;
  }
}

export function OmniAssistant({
  onClose,
  status,
  counts,
  userId,
  links,
  demo = false,
  preset,
}: {
  onClose: () => void;
  /** Qué vigila Omni ahora (la misma línea del encabezado). */
  status: string;
  counts: LiveCounts;
  userId: string | null;
  links: AssistantLinks;
  demo?: boolean;
  preset?: AssistantPreset;
}) {
  const router = useRouter();
  const [state, dispatch] = useReducer(assistantReducer, preset?.state ?? INITIAL_ASSISTANT);
  const [draft, setDraft] = useState(preset?.draft ?? "");
  const [news, setNews] = useState<LiveApproval | null>(preset?.news ?? null);
  const [voice, setVoice] = useState(true);
  // La respuesta llega después de enviar: se lee la preferencia de ese momento, no la de cuando se envió.
  const voiceRef = useRef(true);
  const conversationRef = useRef<string | null>(null);
  const lastReplyAt = useRef(0);
  const speechErrored = useRef(false);
  const panelRef = useRef<HTMLElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const demoLevel = useRef(0.55);

  const listening = state.phase === "listening";
  const busy = state.phase === "processing";
  const micLevel = useAudioLevel(listening && !demo);
  const speechOut = useSpeechOutput();
  const speechIn = useSpeechInput({
    onResult: (final, interim) => dispatch({ type: "hear", final, interim }),
    onEnd: (final) => {
      if (speechErrored.current) return;
      if (final) void submit(final, "voice");
      else dispatch({ type: "fail", message: speechErrorMessage("no-speech") ?? "" });
    },
    onError: (code) => {
      const message = speechErrorMessage(code);
      if (!message) return;
      speechErrored.current = true;
      dispatch({ type: "fail", message });
    },
  });

  useLiveApprovals({
    userId,
    enabled: !demo,
    onApproval: (approval) => {
      // Lo que dejó la orden de ahora ya aparece en la respuesta.
      if (busy || Date.now() - lastReplyAt.current < 8000) return;
      setNews(approval);
      router.refresh();
    },
  });

  // Al abrir: en la compu, el foco va directo al campo (Ctrl+K y a escribir); en el teléfono, al panel, porque el
  // teclado taparía el ojo. Al cerrar, el foco vuelve al botón que lo abrió.
  const fixedState = Boolean(preset);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const typeFirst = !fixedState && window.matchMedia("(pointer: fine)").matches;
    (typeFirst ? inputRef.current : panelRef.current)?.focus();
    const preferred = readVoicePreference();
    voiceRef.current = preferred;
    setVoice(preferred);
    return () => previous?.focus();
  }, [fixedState]);

  // Activo mientras responde; después vuelve a esperar (la respuesta sigue a la vista).
  useEffect(() => {
    if (state.phase !== "active" || state.speaking) return;
    const timer = window.setTimeout(() => dispatch({ type: "settle" }), 6000);
    return () => window.clearTimeout(timer);
  }, [state.phase, state.speaking]);

  // El aviso en vivo se va solo.
  useEffect(() => {
    if (!news || preset?.news) return;
    const timer = window.setTimeout(() => setNews(null), 12000);
    return () => window.clearTimeout(timer);
  }, [news, preset?.news]);

  async function submit(raw: string, via: InputVia) {
    const text = raw.trim();
    if (!text || busy) return;
    speechOut.cancel();
    if (via === "text") speechIn.abort();
    dispatch({ type: "submit", text, via });
    setDraft("");
    try {
      const reply = demo ? await demoReply(text) : await askOmni(text, conversationRef.current);
      conversationRef.current = reply.conversationId;
      lastReplyAt.current = Date.now();
      dispatch({ type: "reply", reply });
      if (reply.cards > 0 && !demo) router.refresh();
      if (via === "voice" && voiceRef.current) {
        speechOut.speak(reply.text, {
          onStart: () => dispatch({ type: "speaking", on: true }),
          onEnd: () => dispatch({ type: "speaking", on: false }),
        });
      }
    } catch (error) {
      // Límite del plan Gratis: la app abre la hoja de Omni Pro; el asistente se cierra para no taparla.
      if (error instanceof ApiError && error.code === "plan_limit" && (error.details as { plan?: string } | null)?.plan === "FREE") {
        onClose();
        return;
      }
      dispatch({ type: "fail", message: errorMessage(error) });
    }
  }

  function toggleMic() {
    if (listening) {
      if (demo) void submit(state.heard || "Revisa mi correo y dime qué trámites tengo", "voice");
      else speechIn.stop();
      return;
    }
    speechOut.cancel();
    speechErrored.current = false;
    dispatch({ type: "listen" });
    if (demo) {
      // Vista previa: las palabras van apareciendo como si las dijeras.
      const words = "Revisa mi correo y dime qué trámites tengo".split(" ");
      words.forEach((_, i) =>
        window.setTimeout(() => dispatch({ type: "hear", final: words.slice(0, i + 1).join(" "), interim: "" }), 260 * (i + 1)),
      );
      return;
    }
    speechIn.start();
  }

  function runOrder(order: QuickOrder) {
    if (order.mode === "send") {
      void submit(order.prompt, "text");
      return;
    }
    setDraft(order.prompt);
    requestAnimationFrame(() => {
      const input = inputRef.current;
      if (!input) return;
      input.focus();
      input.setSelectionRange(order.prompt.length, order.prompt.length);
    });
  }

  /** Apagarla mientras Omni habla lo calla en el acto, y sigue apagada para las próximas órdenes. */
  function toggleVoice() {
    const next = !voice;
    voiceRef.current = next;
    setVoice(next);
    if (!next) {
      speechOut.cancel();
      dispatch({ type: "speaking", on: false });
    }
    try {
      window.localStorage.setItem(VOICE_KEY, next ? "1" : "0");
    } catch {
      // Sin almacenamiento: la preferencia dura mientras el asistente está abierto.
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== "Tab" || !panelRef.current) return;
    const focusables = [
      ...panelRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'),
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

  const chatHref = links.chat(conversationRef.current);
  const caption = state.heard || state.interim;
  const live = state.phase === "listening" || state.phase === "processing";

  return (
    <div className="theme-dark fixed inset-0 z-50 flex justify-center text-ink sm:items-center sm:p-6">
      <button
        type="button"
        tabIndex={-1}
        aria-label="Cerrar el asistente"
        onClick={onClose}
        className="absolute inset-0 hidden h-full w-full cursor-default bg-black/60 backdrop-blur-sm sm:block"
      />
      <section
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="omni-assistant-title"
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className="assistant-sky relative flex h-dvh w-full flex-col overflow-hidden outline-none sm:h-[min(52rem,90dvh)] sm:max-w-[34rem] sm:rounded-[2rem] sm:border sm:border-line sm:shadow-float"
      >
        <header className="flex items-center gap-1 px-3 pb-1 pt-[max(env(safe-area-inset-top),0.75rem)]">
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar el asistente"
            className="grid size-11 place-items-center rounded-full text-muted transition-colors hover:bg-surface hover:text-ink"
          >
            <X className="size-5" aria-hidden />
          </button>
          <h2 id="omni-assistant-title" className="flex-1 text-center text-[15px] font-semibold text-ink">
            Omni
          </h2>
          <button
            type="button"
            onClick={toggleVoice}
            aria-pressed={voice}
            aria-label="Responder en voz alta"
            title={state.speaking ? "Callar a Omni" : voice ? "Si le hablas, Omni te responde en voz alta" : "Omni responde solo con texto"}
            className={cn(
              "grid size-11 place-items-center rounded-full transition-colors hover:bg-surface",
              voice ? "text-primary" : "text-muted hover:text-ink",
            )}
          >
            {voice ? <Volume2 className="size-5" aria-hidden /> : <VolumeX className="size-5" aria-hidden />}
          </button>
          <Link
            href={chatHref}
            onClick={onClose}
            aria-label="Abrir el chat"
            title="Abrir el chat"
            className="grid size-11 place-items-center rounded-full text-muted transition-colors hover:bg-surface hover:text-ink"
          >
            <MessageCircle className="size-5" aria-hidden />
          </Link>
        </header>

        <div className="assistant-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-10">
          <div className="flex flex-col items-center pt-1">
            <OmniEye
              phase={state.phase}
              levelRef={demo ? demoLevel : micLevel}
              speaking={state.speaking}
              news={Boolean(news)}
              className="size-40 sm:size-44"
            />
            <p role="status" aria-live="polite" className="mt-2 flex flex-col items-center gap-1.5 text-center">
              <span className="inline-flex items-center gap-2 rounded-full border border-line bg-surface/80 px-3 py-1 text-[13px] font-medium text-ink">
                <span className={cn("size-2 rounded-full", DOT[state.phase])} aria-hidden />
                {PHASE_LABEL[state.phase]}
              </span>
              <span className={cn("max-w-xs text-sm", state.phase === "error" ? "text-danger" : "text-muted")}>{phaseDetail(state, status)}</span>
            </p>
          </div>

          {caption ? (
            <p
              className={cn(
                "mt-7 tracking-tight transition-all",
                live ? "text-[1.75rem] font-light leading-[1.22] text-ink" : "text-base leading-snug text-muted",
              )}
            >
              {state.heard}
              {state.interim ? <span className="text-muted"> {state.interim}</span> : null}
            </p>
          ) : state.phase === "idle" && !state.reply ? (
            <p className="mt-7 text-[1.75rem] font-light leading-[1.22] tracking-tight text-muted">¿Qué hago por ti?</p>
          ) : null}

          {state.reply ? (
            <div className="assistant-reveal mt-3">
              <p className="text-[17px] leading-relaxed text-ink">{state.reply.text}</p>
              {state.reply.approvals > 0 ? (
                <Link
                  href={links.approvals}
                  onClick={onClose}
                  className="mt-4 flex items-center gap-3 rounded-2xl bg-attention-soft px-4 py-3 text-sm font-semibold text-attention"
                >
                  <ShieldCheck className="size-5 shrink-0" aria-hidden />
                  <span className="flex-1">
                    {state.reply.approvals === 1 ? "1 cosa espera tu aprobación" : `${state.reply.approvals} cosas esperan tu aprobación`}
                  </span>
                  <span>Revisar</span>
                </Link>
              ) : null}
              {state.reply.cards > state.reply.approvals ? (
                <Link href={chatHref} onClick={onClose} className="mt-3 inline-flex text-sm font-semibold text-primary underline-offset-4 hover:underline">
                  Ver el detalle en el chat
                </Link>
              ) : null}
              {state.reply.suggestions.length > 0 ? (
                <div className="mt-4 flex flex-wrap gap-2">
                  {state.reply.suggestions.map((suggestion) => (
                    <button
                      key={suggestion}
                      type="button"
                      disabled={busy}
                      onClick={() => void submit(suggestion, "text")}
                      className="rounded-full border border-line-strong px-3.5 py-2 text-left text-sm text-ink transition-colors hover:bg-surface disabled:opacity-50"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          {news ? (
            <Link
              href={links.approvals}
              onClick={onClose}
              className="mt-6 flex items-center gap-3 rounded-2xl border border-line bg-surface/80 px-4 py-3"
            >
              <span className="size-2.5 shrink-0 rounded-full bg-orbit" aria-hidden />
              <span className="min-w-0 flex-1 text-sm text-ink">
                <span className="font-semibold">Nuevo por aprobar:</span> {news.title}
              </span>
              <span className="text-sm font-semibold text-primary">Revisar</span>
            </Link>
          ) : null}

          {/* Mientras escucha o procesa, la pantalla es solo el ojo y tus palabras. */}
          {live ? null : <QuickOrders counts={counts} onOrder={runOrder} />}
        </div>

        <div className="border-t border-line bg-canvas/85 px-4 pb-[max(env(safe-area-inset-bottom),1rem)] pt-3 backdrop-blur">
          <AssistantComposer
            value={draft}
            onChange={setDraft}
            onSubmit={() => void submit(draft, "text")}
            onMic={toggleMic}
            listening={listening}
            busy={busy}
            micSupported={demo || speechIn.supported}
            inputRef={inputRef}
          />
        </div>
      </section>
    </div>
  );
}
