import { describe, expect, it } from "vitest";
import {
  INITIAL_ASSISTANT,
  PHASE_LABEL,
  assistantReducer,
  detectIntent,
  phaseDetail,
  speakable,
  speechErrorMessage,
  speechLanguage,
  summarizeReply,
  type AssistantAction,
  type AssistantReply,
  type AssistantState,
} from "@/components/assistant/assistant-model";
import type { ChatMessageView } from "@/types/cards";

// Asistente interactivo: estados (en espera, escuchando, procesando, activo, error), textos y respuesta resumida.

const reply: AssistantReply = { text: "Listo.", suggestions: [], approvals: 0, cards: 0, conversationId: "c1" };

function run(...actions: AssistantAction[]): AssistantState {
  return actions.reduce(assistantReducer, INITIAL_ASSISTANT);
}

describe("asistente: estados", () => {
  it("escuchar → orden por voz → procesar → activo → en espera", () => {
    const listening = run({ type: "listen" });
    expect(listening.phase).toBe("listening");

    const hearing = assistantReducer(listening, { type: "hear", final: "Revisa mi", interim: "correo" });
    expect(hearing).toMatchObject({ heard: "Revisa mi", interim: "correo" });

    const processing = assistantReducer(hearing, { type: "submit", text: " Revisa mi correo ", via: "voice" });
    expect(processing).toMatchObject({ phase: "processing", heard: "Revisa mi correo", interim: "", via: "voice" });

    const active = assistantReducer(processing, { type: "reply", reply });
    expect(active).toMatchObject({ phase: "active", reply });

    const speaking = assistantReducer(active, { type: "speaking", on: true });
    expect(assistantReducer(speaking, { type: "settle" }).phase).toBe("active");
    const quiet = assistantReducer(speaking, { type: "speaking", on: false });
    const idle = assistantReducer(quiet, { type: "settle" });
    expect(idle.phase).toBe("idle");
    expect(idle.reply).toBe(reply);
  });

  it("lo que llega fuera de tiempo se ignora", () => {
    expect(run({ type: "hear", final: "hola", interim: "" })).toEqual(INITIAL_ASSISTANT);
    expect(run({ type: "reply", reply })).toEqual(INITIAL_ASSISTANT);
    expect(run({ type: "submit", text: "   ", via: "text" })).toEqual(INITIAL_ASSISTANT);
    expect(run({ type: "speaking", on: true }).speaking).toBe(false);
  });

  it("una orden nueva borra la respuesta anterior; el error se muestra hasta la siguiente", () => {
    const withReply = run({ type: "submit", text: "Hola", via: "text" }, { type: "reply", reply });
    expect(assistantReducer(withReply, { type: "listen" }).reply).toBeNull();
    const failed = run({ type: "listen" }, { type: "fail", message: "No te oí." });
    expect(failed).toMatchObject({ phase: "error", error: "No te oí." });
    expect(assistantReducer(failed, { type: "submit", text: "Otra", via: "text" })).toMatchObject({ phase: "processing", error: null });
  });
});

describe("asistente: textos", () => {
  it("cada estado tiene su nombre", () => {
    expect(PHASE_LABEL).toEqual({ idle: "En espera", listening: "Escuchando", processing: "Procesando", active: "Activo", error: "Error" });
  });

  it("dice qué hace según la orden", () => {
    expect(detectIntent("Revisa mi correo y dime qué trámites tengo")).toEqual({ module: "PROCEDURES", hint: "Revisando tu correo y tus trámites" });
    expect(detectIntent("¿A dónde se fue mi dinero este mes?")).toEqual({ module: "FINANCE", hint: "Mirando tus cuentas" });
    expect(detectIntent("Vigila el precio de unos audífonos")).toEqual({ module: "CONCIERGE", hint: "Buscando precios" });
    expect(detectIntent("¿Dónde están mis pedidos?")).toEqual({ module: "CONCIERGE", hint: "Revisando tus pedidos" });
    expect(detectIntent("Recuerda que cobro el día 30")).toEqual({ hint: "Guardándolo en tu memoria" });
    expect(detectIntent("Hola")).toEqual({ hint: "Pensando en tu orden" });
  });

  it("la frase bajo el ojo", () => {
    expect(phaseDetail(INITIAL_ASSISTANT, "Vigilando 3 precios")).toBe("Vigilando 3 precios.");
    expect(phaseDetail(run({ type: "listen" }), "")).toBe("Te escucho. Di qué necesitas.");
    expect(phaseDetail(run({ type: "submit", text: "Analiza mis gastos", via: "text" }), "")).toBe("Mirando tus cuentas…");
    const active = run({ type: "submit", text: "Hola", via: "voice" }, { type: "reply", reply });
    expect(phaseDetail(active, "")).toBe("Respuesta lista.");
    expect(phaseDetail(assistantReducer(active, { type: "speaking", on: true }), "")).toBe("Te respondo en voz alta.");
  });
});

describe("asistente: respuesta y voz", () => {
  it("resume la respuesta: lo que espera aprobación y lo que se ve en el chat", () => {
    const message: ChatMessageView = {
      id: "m1",
      role: "assistant",
      text: "  Te dejé la compra lista.  ",
      cards: [{ kind: "approval" }, { kind: "checkout" }, { kind: "goal" }, { kind: "upgrade" }] as unknown as ChatMessageView["cards"],
      suggestions: ["a", "b", "c", "d"],
      createdAt: "2026-10-07T00:00:00Z",
    };
    expect(summarizeReply(message, "c9")).toEqual({
      text: "Te dejé la compra lista.",
      suggestions: ["a", "b", "c"],
      approvals: 2,
      cards: 3,
      conversationId: "c9",
    });
  });

  it("lee sin formato ni enlaces y corta en una frase", () => {
    expect(speakable("**Listo**: mira https://tienda.test/x y `aprueba`.")).toBe("Listo: mira el enlace y aprueba.");
    const long = `${"Una frase corta. ".repeat(50)}`;
    const cut = speakable(long, 100);
    expect(cut.length).toBeLessThanOrEqual(100);
    expect(cut.endsWith(".")).toBe(true);
  });

  it("dicta en el español del teléfono o en el latinoamericano", () => {
    expect(speechLanguage("es-VE")).toBe("es-VE");
    expect(speechLanguage("en-US")).toBe("es-US");
    expect(speechLanguage(undefined)).toBe("es-US");
  });

  it("explica cada error del dictado", () => {
    expect(speechErrorMessage("not-allowed")).toMatch(/Permite el micrófono/);
    expect(speechErrorMessage("no-speech")).toMatch(/No te oí/);
    expect(speechErrorMessage("aborted")).toBeNull();
    expect(speechErrorMessage("algo-raro")).toMatch(/No pude entenderte/);
  });
});
