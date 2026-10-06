"use client";

import { CalendarDays, Check, Copy, Link2, Loader, Smartphone } from "lucide-react";
import { useState, type FocusEvent } from "react";
import { Chip, INPUT_CLASS, buttonClass } from "@/components/ui";
import { apiFetch, errorMessage, sleep } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import type { CalendarSyncView } from "@/types/cards";

const HOW_TO: { app: string; steps: string }[] = [
  { app: "Google Calendar", steps: "En la web: Otros calendarios → + → Desde URL, y pega el enlace." },
  { app: "iPhone", steps: "Ajustes → Calendario → Cuentas → Añadir cuenta → Otra → Añadir calendario suscrito." },
  { app: "Outlook", steps: "Agregar calendario → Suscribirse desde la web, y pega el enlace." },
];

/**
 * Sincronización con calendarios: el calendario de la cuenta conectada (sandbox hoy) y un enlace privado
 * de suscripción (ICS) para ver trámites, citas y fechas límite en el calendario del teléfono.
 */
export function CalendarSyncPanel({ sync: initial, demo = false }: { sync: CalendarSyncView; demo?: boolean }) {
  const [sync, setSync] = useState(initial);
  const [busy, setBusy] = useState<"create" | "rotate" | "revoke" | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState(false);

  async function run(kind: "create" | "rotate" | "revoke") {
    setBusy(kind);
    setError(null);
    setCopied(false);
    try {
      if (demo) {
        await sleep(400);
        const url = "https://app.omniagent.test/api/calendar/demo.privado-ejemplo.ics";
        setSync({ ...sync, feedUrl: kind === "revoke" ? null : url, webcalUrl: kind === "revoke" ? null : url.replace(/^https:/, "webcal:") });
      } else {
        setSync(
          await apiFetch<CalendarSyncView>("/api/v1/procedures/calendar/feed", { method: kind === "revoke" ? "DELETE" : "POST" }),
        );
      }
      setConfirmRevoke(false);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function copy() {
    if (!sync.feedUrl) return;
    try {
      await navigator.clipboard.writeText(sync.feedUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      setError("No pude copiar el enlace. Selecciónalo y cópialo a mano.");
    }
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-surface">
      <div className="px-4 py-4">
        <p className="flex items-center gap-2 text-sm font-semibold text-ink">
          <CalendarDays className="size-4 text-primary" aria-hidden />
          Calendario conectado
        </p>
        {sync.calendars.length > 0 ? (
          <ul className="mt-2 space-y-1.5">
            {sync.calendars.map((calendar) => (
              <li key={calendar.id} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="min-w-0 truncate text-ink">{calendar.address}</span>
                <Chip>Demo</Chip>
                <Chip tone="good">
                  <Check className="size-3" aria-hidden />
                  Sincronizado
                </Chip>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-sm leading-relaxed text-muted">
            Con la bandeja de prueba, Omni lee tus horarios ocupados y agenda ahí lo que confirmes. Para tu calendario real, usa el enlace de abajo.
          </p>
        )}
      </div>

      <div className="border-t border-line px-4 py-4">
        <p className="flex items-center gap-2 text-sm font-semibold text-ink">
          <Smartphone className="size-4 text-primary" aria-hidden />
          En el calendario de tu teléfono
        </p>
        {sync.feedUrl ? (
          <>
            <p className="mt-1 text-sm leading-relaxed text-muted">
              Suscríbete una vez y tus trámites, citas y fechas límite aparecen solos (se actualiza cada hora).
            </p>
            <div className="mt-3 flex gap-2">
              <input
                readOnly
                value={sync.feedUrl}
                aria-label="Enlace privado del calendario"
                onFocus={(event: FocusEvent<HTMLInputElement>) => event.currentTarget.select()}
                className={cn(INPUT_CLASS, "font-mono text-xs")}
              />
              <button type="button" onClick={copy} className={cn(buttonClass("secondary", "sm"), "shrink-0")}>
                {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
                {copied ? "Copiado" : "Copiar"}
              </button>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
              {sync.webcalUrl ? (
                <a href={sync.webcalUrl} className={buttonClass("primary", "sm")}>
                  <Link2 className="size-4" aria-hidden />
                  Abrir en mi calendario
                </a>
              ) : null}
              <button
                type="button"
                onClick={() => run("rotate")}
                disabled={busy !== null}
                className="text-sm font-semibold text-primary underline-offset-2 hover:underline disabled:opacity-50"
              >
                {busy === "rotate" ? "Cambiando…" : "Cambiar enlace"}
              </button>
              {confirmRevoke ? (
                <span className="flex items-center gap-2 text-sm">
                  <button
                    type="button"
                    onClick={() => run("revoke")}
                    disabled={busy !== null}
                    className="font-semibold text-danger underline-offset-2 hover:underline"
                  >
                    {busy === "revoke" ? "Desactivando…" : "Sí, desactivar"}
                  </button>
                  <button type="button" onClick={() => setConfirmRevoke(false)} className="text-muted hover:text-ink">
                    Cancelar
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmRevoke(true)}
                  className="text-sm text-muted underline-offset-2 hover:text-ink hover:underline"
                >
                  Desactivar
                </button>
              )}
            </div>
            <details className="mt-3 text-sm">
              <summary className="cursor-pointer text-xs font-semibold text-muted hover:text-ink">Cómo suscribirte</summary>
              <ul className="mt-2 space-y-1.5">
                {HOW_TO.map((item) => (
                  <li key={item.app} className="text-xs leading-relaxed text-muted">
                    <span className="font-semibold text-ink">{item.app}:</span> {item.steps}
                  </li>
                ))}
              </ul>
            </details>
            <p className="mt-3 text-xs leading-relaxed text-muted">
              El enlace es privado: quien lo tenga puede ver tus trámites. Si lo compartiste por error, cámbialo.
            </p>
          </>
        ) : (
          <>
            <p className="mt-1 text-sm leading-relaxed text-muted">
              Crea un enlace privado y suscríbete desde Google Calendar, Apple Calendar u Outlook. Apple Calendar también
              respeta los avisos de cada trámite.
            </p>
            <button
              type="button"
              onClick={() => run("create")}
              disabled={busy !== null}
              className={cn(buttonClass("secondary", "sm"), "mt-3")}
            >
              {busy === "create" ? <Loader className="size-4 animate-spin" aria-hidden /> : <Link2 className="size-4" aria-hidden />}
              Crear enlace de suscripción
            </button>
          </>
        )}
        {error ? (
          <p role="alert" className="mt-3 rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}
