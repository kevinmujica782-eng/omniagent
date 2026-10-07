"use client";

import { useEffect, useRef } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

// En vivo (Supabase Realtime): cuando Omni deja algo nuevo por aprobar, el asistente lo muestra al instante.
// La política RLS owner_select de agent_actions hace que cada persona reciba solo sus filas.

export interface LiveApproval {
  id: string;
  title: string;
}

export function useLiveApprovals(opts: { userId: string | null; enabled: boolean; onApproval: (approval: LiveApproval) => void }) {
  const handler = useRef(opts.onApproval);

  useEffect(() => {
    handler.current = opts.onApproval;
  });

  useEffect(() => {
    if (!opts.enabled || !opts.userId) return;
    let supabase: ReturnType<typeof createSupabaseBrowserClient>;
    try {
      supabase = createSupabaseBrowserClient();
    } catch {
      return;
    }
    const channel = supabase
      .channel(`omni-assistant-${opts.userId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "agent_actions", filter: `user_id=eq.${opts.userId}` },
        (payload) => {
          const row = payload.new as { id?: string; title?: string; status?: string };
          if (row.status === "PENDING" && row.id) handler.current({ id: row.id, title: row.title ?? "Una acción nueva" });
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [opts.enabled, opts.userId]);
}
