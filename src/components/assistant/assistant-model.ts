// Modelo del asistente interactivo de Omni: estados, transiciones y textos. Sin React ni navegador
// (se prueba en tests/unit/assistant.test.ts).
import type { ChatMessageView, ModuleKind } from "@/types/cards";

/** En espera, escuchando, procesando, activo (respondiendo) o con un error. */
export type AssistantPhase = "idle" | "listening" | "processing" | "active" | "error";
export type InputVia = "voice" | "text";

export interface AssistantReply {
  text: string;
  /** Preguntas de seguimiento que propone Omni (como respuestas rápidas). */
  suggestions: string[];
  /** Lo que quedó esperando su visto bueno (aprobaciones y hojas de pago). */
  approvals: number;
  /** Tarjetas con detalle, que se ven completas en el chat. */
  cards: number;
  conversationId: string;
}

export interface AssistantState {
  phase: AssistantPhase;
  /** La orden en curso: lo que dijo (ya reconocido) o lo que escribió. */
  heard: string;
  /** Lo que se va reconociendo mientras habla. */
  interim: string;
  via: InputVia | null;
  reply: AssistantReply | null;
  error: string | null;
  /** Omni está leyendo la respuesta en voz alta. */
  speaking: boolean;
}

export type AssistantAction =
  | { type: "listen" }
  | { type: "hear"; final: string; interim: string }
  | { type: "submit"; text: string; via: InputVia }
  | { type: "reply"; reply: AssistantReply }
  | { type: "speaking"; on: boolean }
  | { type: "settle" }
  | { type: "fail"; message: string }
  | { type: "reset" };

export const INITIAL_ASSISTANT: AssistantState = {
  phase: "idle",
  heard: "",
  interim: "",
  via: null,
  reply: null,
  error: null,
  speaking: false,
};

/**
 * Transiciones: escuchar → (orden) → procesar → responder (activo) → en espera. Una respuesta que llega cuando ya
 * no se estaba procesando (se canceló o empezó otra orden) se ignora.
 */
export function assistantReducer(state: AssistantState, action: AssistantAction): AssistantState {
  switch (action.type) {
    case "listen":
      return { ...state, phase: "listening", heard: "", interim: "", via: "voice", reply: null, error: null, speaking: false };
    case "hear":
      return state.phase === "listening" ? { ...state, heard: action.final, interim: action.interim } : state;
    case "submit": {
      const text = action.text.trim();
      if (!text) return state;
      return { ...state, phase: "processing", heard: text, interim: "", via: action.via, reply: null, error: null, speaking: false };
    }
    case "reply":
      return state.phase === "processing" ? { ...state, phase: "active", reply: action.reply } : state;
    case "speaking":
      if (action.on) return state.reply ? { ...state, phase: "active", speaking: true } : state;
      return { ...state, speaking: false };
    case "settle":
      return state.phase === "active" && !state.speaking ? { ...state, phase: "idle" } : state;
    case "fail":
      return { ...state, phase: "error", error: action.message, interim: "", speaking: false };
    case "reset":
      return INITIAL_ASSISTANT;
  }
}

// ── Qué está haciendo, en palabras ───────────────────────────────────────────

export const PHASE_LABEL: Record<AssistantPhase, string> = {
  idle: "En espera",
  listening: "Escuchando",
  processing: "Procesando",
  active: "Activo",
  error: "Error",
};

function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

interface Intent {
  module?: ModuleKind;
  /** Qué está haciendo Omni mientras procesa esta orden. */
  hint: string;
}

const INTENTS: { pattern: RegExp; intent: Intent }[] = [
  { pattern: /\b(recuerda|acuerdate|no olvides|olvida)\b/, intent: { hint: "Guardándolo en tu memoria" } },
  { pattern: /\b(pedido|paquete|envio|devolucion|devolver|reclam\w*|llego|reembolso)/, intent: { module: "CONCIERGE", hint: "Revisando tus pedidos" } },
  { pattern: /\b(correo|tramite|formulario|permiso|cita|vence|vencen|pendiente)/, intent: { module: "PROCEDURES", hint: "Revisando tu correo y tus trámites" } },
  { pattern: /\b(precio|vigila|compra|comprar|oferta|vuelo|boleto|entrada|hotel)/, intent: { module: "CONCIERGE", hint: "Buscando precios" } },
  { pattern: /\b(gasto|gaste|gastos|dinero|ahorr\w*|presupuesto|suscripci\w*|banco|finanza\w*|cuenta)/, intent: { module: "FINANCE", hint: "Mirando tus cuentas" } },
  { pattern: /\b(meta|metas)\b/, intent: { module: "GOALS", hint: "Revisando tus metas" } },
];

/** De qué trata la orden: el módulo de la conversación nueva y qué decir mientras se procesa. */
export function detectIntent(text: string): Intent {
  const clean = normalize(text);
  return INTENTS.find(({ pattern }) => pattern.test(clean))?.intent ?? { hint: "Pensando en tu orden" };
}

/** La frase bajo el ojo: qué está pasando ahora y qué puede hacer la persona. */
export function phaseDetail(state: AssistantState, status: string): string {
  switch (state.phase) {
    case "idle":
      return state.reply ? "Listo para tu próxima orden." : `${status}.`;
    case "listening":
      return state.heard || state.interim ? "Te escucho. Haz una pausa cuando termines." : "Te escucho. Di qué necesitas.";
    case "processing":
      return `${detectIntent(state.heard).hint}…`;
    case "active":
      return state.speaking ? "Te respondo en voz alta." : "Respuesta lista.";
    case "error":
      return state.error ?? "Algo falló. Inténtalo de nuevo.";
  }
}

// ── Respuesta ────────────────────────────────────────────────────────────────

const NEEDS_APPROVAL = new Set(["approval", "checkout"]);

/** La respuesta de Omni resumida para el asistente (el detalle completo queda en el chat). */
export function summarizeReply(message: ChatMessageView, conversationId: string): AssistantReply {
  const cards = message.cards.filter((card) => card.kind !== "upgrade");
  return {
    text: message.text.trim(),
    suggestions: (message.suggestions ?? []).slice(0, 3),
    approvals: cards.filter((card) => NEEDS_APPROVAL.has(card.kind)).length,
    cards: cards.length,
    conversationId,
  };
}

/** Texto para leer en voz alta: sin formato, sin enlaces largos y con un tope razonable. */
export function speakable(text: string, max = 600): string {
  const clean = text
    .replace(/https?:\/\/\S+/g, "el enlace")
    .replace(/[*_`#>]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("? "), cut.lastIndexOf("! "));
  return end > max / 2 ? cut.slice(0, end + 1) : `${cut.trimEnd()}…`;
}

/** Idioma del dictado: el del teléfono si es español; si no, español latinoamericano. */
export function speechLanguage(navigatorLanguage: string | undefined): string {
  return navigatorLanguage && /^es\b/i.test(navigatorLanguage) ? navigatorLanguage : "es-US";
}

/** Mensaje claro para cada error del dictado del navegador. */
export function speechErrorMessage(code: string): string | null {
  switch (code) {
    case "not-allowed":
    case "service-not-allowed":
      return "Permite el micrófono para hablarle a Omni, o escribe tu orden.";
    case "no-speech":
      return "No te oí. Toca el micrófono y habla cuando diga «Escuchando».";
    case "audio-capture":
      return "No encuentro un micrófono. Escribe tu orden.";
    case "network":
      return "El dictado necesita internet. Revisa tu conexión o escribe tu orden.";
    case "aborted":
      return null;
    default:
      return "No pude entenderte. Inténtalo de nuevo o escribe tu orden.";
  }
}
