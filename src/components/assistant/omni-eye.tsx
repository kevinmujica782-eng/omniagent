"use client";

import { useEffect, useId, useRef, useState, type RefObject } from "react";
import { cn } from "@/lib/cn";
import type { AssistantPhase } from "./assistant-model";

/**
 * Omni en grande: el anillo de su marca es un ojo, la pupila mira y la luna ámbar (su actividad) orbita.
 * Cada estado es un gesto de la marca, no un color:
 * - En espera: la luna da una vuelta lenta, como la órbita de un día de trabajo.
 * - Escuchando: la luna se detiene arriba; la pupila se centra y late con tu voz, y salen ondas del anillo.
 * - Procesando: la pupila busca y la luna corre en órbita con su estela.
 * - Activo: la luna se posa donde la lleva la marca, el anillo se aviva y la pupila mira la respuesta.
 * Con reduced-motion no hay animación: cada estado queda en su pose. El texto del estado lo lleva el asistente.
 */
export function OmniEye({
  phase,
  levelRef,
  speaking = false,
  news = false,
  size = 176,
  className,
}: {
  phase: AssistantPhase;
  /** Volumen de la voz (0 a 1) mientras escucha. */
  levelRef?: RefObject<number>;
  speaking?: boolean;
  /** Algo nuevo llegó en vivo: la luna destella. */
  news?: boolean;
  size?: number;
  className?: string;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  // El id va en url(#…): solo letras, números y guiones.
  const glowId = `omni-eye-glow-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const [entering, setEntering] = useState(true);

  // Al abrir, la luna da una vuelta completa y se posa: el único gesto que no responde a una acción.
  useEffect(() => {
    const timer = window.setTimeout(() => setEntering(false), 1300);
    return () => window.clearTimeout(timer);
  }, []);

  // El volumen llega por ref y se aplica como variable CSS en cada cuadro (sin re-render).
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    if (phase !== "listening") {
      svg.style.setProperty("--level", "0");
      return;
    }
    let frame = 0;
    let smooth = 0;
    const tick = () => {
      const target = levelRef?.current ?? 0;
      smooth += (target - smooth) * 0.22;
      svg.style.setProperty("--level", smooth.toFixed(3));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [phase, levelRef]);

  return (
    <svg
      ref={svgRef}
      viewBox="0 0 200 200"
      width={size}
      height={size}
      aria-hidden
      className={cn("omni-eye", `is-${phase}`, entering && phase === "idle" && "is-entering", speaking && "is-speaking", news && "has-news", className)}
    >
      <defs>
        <radialGradient id={glowId}>
          <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.28" />
          <stop offset="55%" stopColor="var(--primary)" stopOpacity="0.08" />
          <stop offset="100%" stopColor="var(--primary)" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle className="eye-halo" cx="100" cy="100" r="98" fill={`url(#${glowId})`} />
      <g className="eye-waves">
        <circle cx="100" cy="100" r="54" />
        <circle cx="100" cy="100" r="54" />
        <circle cx="100" cy="100" r="54" />
      </g>
      <circle className="eye-ring" cx="100" cy="100" r="54" />
      <circle className="eye-scan" cx="100" cy="100" r="54" />
      <circle className="eye-ripple" cx="100" cy="100" r="54" />
      <circle className="eye-pupil" cx="100" cy="100" r="17" />
      <g className="eye-orbit">
        <circle className="eye-trail" cx="100" cy="100" r="62" />
        <circle className="eye-moon" cx="100" cy="38" r="9" />
      </g>
    </svg>
  );
}
