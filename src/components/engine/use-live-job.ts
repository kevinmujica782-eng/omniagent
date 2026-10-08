"use client";

import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { isJobActive, type JobView } from "@/types/engine";

// Un trabajo del motor en vivo: Supabase Realtime avisa cada cambio de la fila (la política owner_select hace que cada
// persona reciba solo los suyos) y la tarjeta vuelve a pedir el trabajo a la API. Por si Realtime no conecta, también
// pregunta cada pocos segundos mientras el trabajo sigue activo. Cuando termina, deja de escuchar.

const POLL_ACTIVE_MS = 4_000;
const POLL_WAITING_MS = 20_000;

export function useLiveJob(initial: JobView, opts: { demo?: boolean } = {}): [JobView, Dispatch<SetStateAction<JobView>>] {
  const [job, setJob] = useState(initial);
  const active = isJobActive(job.status);
  const waiting = job.status === "WAITING";

  useEffect(() => {
    if (!active || opts.demo) return;
    let stopped = false;
    const refresh = async () => {
      try {
        const res = await fetch(`/api/v1/engine/jobs/${job.id}`, { cache: "no-store" });
        if (!res.ok) return;
        const json = (await res.json()) as { data?: { job?: JobView } };
        if (!stopped && json.data?.job) setJob(json.data.job);
      } catch {
        // Sin conexión: el próximo sondeo lo intenta de nuevo.
      }
    };

    let cleanupRealtime: (() => void) | null = null;
    try {
      const supabase = createSupabaseBrowserClient();
      const channel = supabase
        .channel(`engine-job-${job.id}`)
        .on("postgres_changes", { event: "UPDATE", schema: "public", table: "engine_jobs", filter: `id=eq.${job.id}` }, () => void refresh())
        .subscribe();
      cleanupRealtime = () => void supabase.removeChannel(channel);
    } catch {
      // Sin Supabase en el navegador (vista previa): queda el sondeo.
    }

    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, waiting ? POLL_WAITING_MS : POLL_ACTIVE_MS);
    void refresh();

    return () => {
      stopped = true;
      window.clearInterval(interval);
      cleanupRealtime?.();
    };
  }, [job.id, active, waiting, opts.demo]);

  return [job, setJob];
}
