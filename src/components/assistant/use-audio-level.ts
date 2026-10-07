"use client";

import { useEffect, useRef, type RefObject } from "react";

// Volumen de la voz (0 a 1) mientras Omni escucha, para que la pupila y las ondas del ojo sigan a la persona.
// Se guarda en una ref (sin re-render a 60 cuadros por segundo). En iPhone no se abre un segundo micrófono, porque
// Safari corta el dictado: ahí el ojo usa un latido fijo.

function isIOS(): boolean {
  return /iPhone|iPad|iPod/i.test(navigator.userAgent);
}

export function useAudioLevel(active: boolean): RefObject<number> {
  const level = useRef(0);

  useEffect(() => {
    if (!active || isIOS() || !navigator.mediaDevices?.getUserMedia) return;
    let cancelled = false;
    let frame = 0;
    let stream: MediaStream | null = null;
    let context: AudioContext | null = null;

    navigator.mediaDevices
      .getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
      .then((media) => {
        if (cancelled) {
          media.getTracks().forEach((track) => track.stop());
          return;
        }
        stream = media;
        context = new AudioContext();
        const analyser = context.createAnalyser();
        analyser.fftSize = 512;
        context.createMediaStreamSource(media).connect(analyser);
        const samples = new Uint8Array(analyser.fftSize);
        const tick = () => {
          analyser.getByteTimeDomainData(samples);
          let sum = 0;
          for (const value of samples) {
            const x = (value - 128) / 128;
            sum += x * x;
          }
          level.current = Math.min(1, Math.sqrt(sum / samples.length) * 4.5);
          frame = requestAnimationFrame(tick);
        };
        tick();
      })
      .catch(() => {
        // Sin permiso o sin micrófono: el ojo late igual, sin seguir el volumen.
      });

    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      stream?.getTracks().forEach((track) => track.stop());
      void context?.close().catch(() => undefined);
      level.current = 0;
    };
  }, [active]);

  return level;
}
