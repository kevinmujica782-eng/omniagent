"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { speechLanguage } from "./assistant-model";

// Dictado con la Web Speech API del navegador (Chrome en Android y en la compu, Safari en iPhone). Entrega lo que se
// va reconociendo y, al terminar la frase, el texto final. Si el navegador no la tiene, `supported` es false.

interface RecognitionAlternative {
  transcript: string;
}
interface RecognitionResult {
  readonly isFinal: boolean;
  readonly length: number;
  [index: number]: RecognitionAlternative;
}
interface RecognitionEvent {
  readonly results: { readonly length: number; [index: number]: RecognitionResult };
}
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type RecognitionConstructor = new () => Recognition;

function recognitionConstructor(): RecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionConstructor; webkitSpeechRecognition?: RecognitionConstructor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export interface SpeechInputHandlers {
  /** Mientras habla: lo ya reconocido y lo provisional. */
  onResult(final: string, interim: string): void;
  /** Terminó (pausa, «Dejar de escuchar» o fin de la frase) con el texto final, que puede venir vacío. */
  onEnd(final: string): void;
  /** Código de error del navegador (not-allowed, no-speech, network…). */
  onError(code: string): void;
}

export function useSpeechInput(handlers: SpeechInputHandlers) {
  const [supported, setSupported] = useState(false);
  const handlersRef = useRef(handlers);
  const recognitionRef = useRef<Recognition | null>(null);
  const finalRef = useRef("");
  const abortedRef = useRef(false);

  useEffect(() => {
    handlersRef.current = handlers;
  });

  useEffect(() => {
    setSupported(recognitionConstructor() !== null);
    return () => {
      abortedRef.current = true;
      recognitionRef.current?.abort();
      recognitionRef.current = null;
    };
  }, []);

  const start = useCallback(() => {
    const Ctor = recognitionConstructor();
    if (!Ctor || recognitionRef.current) return;
    const recognition = new Ctor();
    recognition.lang = speechLanguage(navigator.language);
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    finalRef.current = "";
    abortedRef.current = false;

    recognition.onresult = (event) => {
      let final = "";
      let interim = "";
      for (let i = 0; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) final += result[0].transcript;
        else interim += result[0].transcript;
      }
      finalRef.current = final.trim();
      handlersRef.current.onResult(finalRef.current, interim.trim());
    };
    recognition.onerror = (event) => handlersRef.current.onError(event.error);
    recognition.onend = () => {
      recognitionRef.current = null;
      if (!abortedRef.current) handlersRef.current.onEnd(finalRef.current);
    };
    recognitionRef.current = recognition;
    try {
      recognition.start();
    } catch {
      recognitionRef.current = null;
      handlersRef.current.onError("start-failed");
    }
  }, []);

  /** Termina de escuchar y entrega lo dicho (onEnd). */
  const stop = useCallback(() => recognitionRef.current?.stop(), []);

  /** Cancela sin entregar nada (al cerrar el asistente o al escribir). */
  const abort = useCallback(() => {
    abortedRef.current = true;
    recognitionRef.current?.abort();
    recognitionRef.current = null;
  }, []);

  return { supported, start, stop, abort };
}
