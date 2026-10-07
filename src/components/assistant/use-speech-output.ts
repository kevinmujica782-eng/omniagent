"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { speakable } from "./assistant-model";

// Omni lee la respuesta en voz alta (speechSynthesis del navegador), con una voz en español si el teléfono la tiene.

const PREFERRED = ["es-US", "es-MX", "es-419", "es-CO", "es-VE", "es-ES"];

function spanishVoice(): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices().filter((voice) => /^es\b/i.test(voice.lang));
  for (const lang of PREFERRED) {
    const match = voices.find((voice) => voice.lang.toLowerCase() === lang.toLowerCase());
    if (match) return match;
  }
  return voices[0] ?? null;
}

export function useSpeechOutput() {
  const [supported, setSupported] = useState(false);
  const current = useRef<SpeechSynthesisUtterance | null>(null);

  useEffect(() => {
    const available = "speechSynthesis" in window;
    setSupported(available);
    if (!available) return;
    // Algunas voces llegan tarde: pedirlas una vez hace que estén listas al hablar.
    window.speechSynthesis.getVoices();
    return () => window.speechSynthesis.cancel();
  }, []);

  const cancel = useCallback(() => {
    if (!("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
  }, []);

  /** Lee el texto. onEnd se llama al terminar, al cancelar o si falla. */
  const speak = useCallback((text: string, events: { onStart?: () => void; onEnd?: () => void } = {}) => {
    if (!("speechSynthesis" in window)) return false;
    const say = speakable(text);
    if (!say) return false;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(say);
    const voice = spanishVoice();
    utterance.lang = voice?.lang ?? "es-US";
    if (voice) utterance.voice = voice;
    utterance.rate = 1.03;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      if (current.current === utterance) current.current = null;
      events.onEnd?.();
    };
    utterance.onstart = () => events.onStart?.();
    utterance.onend = finish;
    utterance.onerror = finish;
    current.current = utterance;
    window.speechSynthesis.speak(utterance);
    return true;
  }, []);

  return { supported, speak, cancel };
}
