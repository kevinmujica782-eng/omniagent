"use client";

import { ArrowUp, FileText, PiggyBank, ShoppingBag, Undo2, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent } from "react";
import { MessageBubble } from "@/components/chat/message-bubble";
import { CONCIERGE_STARTER_ICONS, FINANCE_STARTER_ICONS, PROCEDURES_STARTER_ICONS, RETURNS_STARTER_ICONS, STARTER_ICONS } from "@/components/icons";
import { OmniMark } from "@/components/omni-mark";
import type { ChatMessageView, ModuleKind } from "@/types/cards";

type ChatError = { message: string; retry: string | null; upgrade: boolean };

/** Textos del chat vacío según el módulo (finanzas, trámites y compras tienen su propia bienvenida). */
const WELCOME: Partial<Record<ModuleKind, { chip: string; icon: LucideIcon; title: string; body: string; starterIcons: LucideIcon[] }>> = {
  FINANCE: {
    chip: "Asistente financiero",
    icon: PiggyBank,
    title: "Hablemos de tu dinero.",
    body: "Analizo tus últimos 3 meses, encuentro gastos hormiga y suscripciones que no usas, y te digo cómo ahorrar. Nada se cancela ni se paga sin tu aprobación.",
    starterIcons: FINANCE_STARTER_ICONS,
  },
  PROCEDURES: {
    chip: "Trámites",
    icon: FileText,
    title: "Dejemos tus pendientes en orden.",
    body: "Reviso tu correo, encuentro permisos, citas y fechas límite, lleno los formularios con tus datos y te propongo cuándo hacerlo. Nada se envía sin tu aprobación.",
    starterIcons: PROCEDURES_STARTER_ICONS,
  },
  CONCIERGE: {
    chip: "Compras",
    icon: ShoppingBag,
    title: "Compremos en el mejor momento.",
    body: "Vigilo precios de productos, boletos, vuelos y hoteles, te aviso cuando bajan de verdad y preparo la compra. Nada se paga sin que pulses Permitir.",
    starterIcons: CONCIERGE_STARTER_ICONS,
  },
};

/** Bienvenida del chat de pedidos y devoluciones (conversa con el módulo de compras). */
const RETURNS_WELCOME = {
  chip: "Pedidos y devoluciones",
  icon: Undo2,
  title: "Que tus pedidos lleguen bien.",
  body: "Sigo tus pedidos, te aviso si se atrasan y preparo el reclamo cuando algo llega mal. Nada se envía a la tienda sin tu aprobación.",
  starterIcons: RETURNS_STARTER_ICONS,
};

/** Tarjetas que cambian contadores del encabezado (aprobaciones, trámites por confirmar, devoluciones). */
const REFRESHING_CARDS = new Set(["approval", "inbox_digest", "procedures", "tracked_item", "price_alert", "checkout", "return_case", "tracked_orders"]);

export function ChatView({
  conversationId: initialConversationId,
  initialMessages,
  starters,
  autoPrompt = null,
  ideaId = null,
  userName = null,
  timeZone,
  module,
  variant,
  demo = false,
}: {
  conversationId: string | null;
  initialMessages: ChatMessageView[];
  starters: string[];
  autoPrompt?: string | null;
  ideaId?: string | null;
  userName?: string | null;
  timeZone?: string;
  /** Módulo de la conversación (FINANCE abre el asistente financiero). */
  module?: ModuleKind;
  /** Chat de pedidos y devoluciones: su propia bienvenida (el módulo sigue siendo el de compras). */
  variant?: "returns";
  /** Vista previa: no llama a la API. */
  demo?: boolean;
}) {
  const router = useRouter();
  const [messages, setMessages] = useState(initialMessages);
  const [conversationId, setConversationId] = useState(initialConversationId);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ChatError | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const autoSent = useRef(false);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length, pending]);

  // Prompt que llega desde Ideas o Metas (?prompt=...): se envía una sola vez.
  useEffect(() => {
    if (autoPrompt && !autoSent.current) {
      autoSent.current = true;
      void send(autoPrompt, ideaId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function resizeTextarea() {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }

  async function send(raw: string, fromIdea: string | null = null) {
    const text = raw.trim();
    if (!text || pending) return;
    setError(null);
    setInput("");
    requestAnimationFrame(resizeTextarea);

    const optimistic: ChatMessageView = {
      id: `local-${Date.now()}`,
      role: "user",
      text,
      cards: [],
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimistic]);
    setPending(true);

    try {
      if (demo) {
        await new Promise((resolve) => setTimeout(resolve, 900));
        setMessages((prev) => [
          ...prev,
          {
            id: `demo-${Date.now()}`,
            role: "assistant",
            text: "Esto es una vista previa. Configura Supabase y tu clave de Anthropic para hablar con Omni de verdad.",
            cards: [],
            createdAt: new Date().toISOString(),
          },
        ]);
        return;
      }

      const res = await fetch("/api/v1/agent/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          conversationId: conversationId ?? undefined,
          module: conversationId ? undefined : module,
          ideaId: fromIdea ?? undefined,
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
        setInput(text);
        setError({
          message: json?.error?.message ?? "Omni no pudo responder. Inténtalo de nuevo.",
          retry: res.status === 402 ? null : text,
          upgrade: res.status === 402,
        });
        return;
      }

      const data = json.data as { conversationId: string; message: ChatMessageView };
      setMessages((prev) => [...prev, data.message]);
      if (!conversationId) {
        setConversationId(data.conversationId);
        const url = new URL(window.location.href);
        url.searchParams.set("c", data.conversationId);
        url.searchParams.delete("prompt");
        url.searchParams.delete("idea");
        url.searchParams.delete("modulo");
        window.history.replaceState(null, "", `${url.pathname}${url.search}`);
      }
      // Hay algo nuevo por aprobar o por confirmar: refresca los contadores del encabezado.
      if (data.message.cards.some((card) => REFRESHING_CARDS.has(card.kind))) router.refresh();
    } catch {
      setMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
      setInput(text);
      setError({ message: "Sin conexión. Revisa tu internet e inténtalo de nuevo.", retry: text, upgrade: false });
    } finally {
      setPending(false);
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void send(input);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void send(input);
    }
  }

  const empty = messages.length === 0 && !pending;
  const welcome = variant === "returns" ? RETURNS_WELCOME : module ? WELCOME[module] : undefined;
  const starterIcons = welcome?.starterIcons ?? STARTER_ICONS;
  const WelcomeIcon = welcome?.icon;
  const last = messages[messages.length - 1];
  const suggestions = !pending && last?.role === "assistant" ? (last.suggestions ?? []) : [];

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        {empty ? (
          <div className="mx-auto flex min-h-full max-w-xl flex-col items-center justify-center px-5 py-10 text-center">
            <OmniMark size={56} />
            {welcome && WelcomeIcon ? (
              <span className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-primary-soft px-3 py-1 text-xs font-semibold text-primary">
                <WelcomeIcon className="size-3.5" aria-hidden />
                {welcome.chip}
              </span>
            ) : null}
            <h1 className="mt-5 text-2xl font-semibold tracking-tight text-balance text-ink">
              Hola{userName ? `, ${userName}` : ""}. {welcome ? welcome.title : "¿Qué dejamos resuelto hoy?"}
            </h1>
            <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted">
              {welcome
                ? welcome.body
                : "Pregúntame por tus gastos, un trámite o algo que quieras comprar. Antes de pagar, enviar o cancelar algo, te pido permiso."}
            </p>
            <div className="mt-7 grid w-full gap-2 sm:grid-cols-2">
              {starters.map((starter, index) => {
                const Icon = starterIcons[index % starterIcons.length];
                return (
                  <button
                    key={starter}
                    type="button"
                    onClick={() => send(starter)}
                    className="flex items-start gap-3 rounded-2xl border border-line bg-surface px-4 py-3 text-left text-sm leading-snug text-ink transition-colors hover:border-line-strong hover:bg-surface-2"
                  >
                    <Icon className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                    <span>{starter}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="mx-auto flex max-w-2xl flex-col gap-4 px-4 py-6">
            {messages.map((message) => (
              <MessageBubble key={message.id} message={message} timeZone={timeZone} demo={demo || message.id.startsWith("demo-")} reportable />
            ))}
            {suggestions.length > 0 ? (
              <div className="flex flex-wrap gap-2" aria-label="Preguntas sugeridas">
                {suggestions.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => send(suggestion)}
                    className="rounded-full border border-line-strong bg-surface px-3.5 py-1.5 text-left text-sm text-ink transition-colors hover:border-primary hover:bg-primary-soft hover:text-primary"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            ) : null}
            {pending ? (
              <div className="flex items-center gap-2.5 text-sm text-muted" role="status">
                <OmniMark size={28} thinking />
                <span>Omni está revisando…</span>
              </div>
            ) : null}
            {error ? (
              <div role="alert" className="rounded-2xl bg-danger-soft px-4 py-3 text-sm text-danger">
                <p>{error.message}</p>
                <div className="mt-2 flex gap-3 font-semibold">
                  {error.upgrade ? (
                    <Link href="/cuenta" className="underline underline-offset-2">
                      Ver planes
                    </Link>
                  ) : null}
                  {error.retry ? (
                    <button type="button" onClick={() => send(error.retry ?? "")} className="underline underline-offset-2">
                      Reintentar
                    </button>
                  ) : null}
                </div>
              </div>
            ) : null}
            <div ref={endRef} />
          </div>
        )}
      </div>

      <form
        onSubmit={onSubmit}
        className="shrink-0 border-t border-line bg-canvas px-3 pb-[max(env(safe-area-inset-bottom),0.75rem)] pt-3"
      >
        <div className="mx-auto flex max-w-2xl items-end gap-2 rounded-3xl border border-line-strong bg-surface py-1.5 pl-4 pr-1.5">
          <label htmlFor="omni-input" className="sr-only">
            Mensaje para Omni
          </label>
          <textarea
            id="omni-input"
            ref={textareaRef}
            value={input}
            onChange={(event: ChangeEvent<HTMLTextAreaElement>) => {
              setInput(event.target.value);
              resizeTextarea();
            }}
            onKeyDown={onKeyDown}
            rows={1}
            maxLength={4000}
            enterKeyHint="send"
            placeholder="Escríbele a Omni"
            className="max-h-40 min-h-10 flex-1 resize-none bg-transparent py-2 text-[15px] leading-6 text-ink outline-none placeholder:text-muted"
          />
          <button
            type="submit"
            disabled={!input.trim() || pending}
            aria-label="Enviar"
            className="grid size-10 shrink-0 place-items-center rounded-full bg-primary text-on-primary transition-colors hover:bg-primary-hover disabled:bg-line disabled:text-muted"
          >
            <ArrowUp className="size-5" aria-hidden />
          </button>
        </div>
      </form>
    </div>
  );
}
