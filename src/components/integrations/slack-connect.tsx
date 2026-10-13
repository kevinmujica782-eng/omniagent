"use client";

import { Check, Copy, Send } from "lucide-react";
import { useState } from "react";
import { Panel, buttonClass } from "@/components/ui";
import { apiFetch, errorMessage } from "@/lib/api-client";

// «Conectar Slack» (Conexiones): genera un código para escribir en Slack con «/omni vincular CÓDIGO». No pide tokens
// de Slack; Omni responde por el response_url de cada comando. La app de Slack se crea una vez, en un clic, con el
// manifiesto de /api/v1/slack/setup, y su Signing Secret va en SLACK_SIGNING_SECRET (ver README).

export function SlackConnect({ demo = false, configured = true }: { demo?: boolean; configured?: boolean }) {
  const [code, setCode] = useState<string | null>(demo ? "K7M9Q2" : null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      if (demo) {
        setCode("K7M9Q2");
      } else {
        const result = await apiFetch<{ code: string; expiresAt: string }>("/api/v1/slack/link", { method: "POST" });
        setCode(result.code);
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function copy() {
    if (!code) return;
    void navigator.clipboard?.writeText(`/omni vincular ${code}`).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      },
      () => undefined,
    );
  }

  return (
    <Panel className="p-4">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 grid size-10 shrink-0 place-items-center rounded-xl bg-surface-2 text-ink">
          <Send className="size-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-ink">Slack</p>
          <p className="mt-0.5 text-sm leading-relaxed text-muted">
            Escríbele a Omni desde Slack con <code className="rounded bg-surface-2 px-1">/omni</code>. Genera un código y
            pégalo en Slack para conectar tu cuenta.
          </p>

          {!configured && !demo ? (
            <div className="mt-3 rounded-xl bg-surface-2 px-3 py-2.5 text-sm leading-relaxed text-muted">
              <p>Slack todavía no está activo en esta instalación de Omni.</p>
              <p className="mt-1">
                ¿Administras Omni?{" "}
                <a href="/api/v1/slack/setup" target="_blank" rel="noopener noreferrer" className="font-semibold text-primary hover:underline">
                  Crea la app de Slack en un clic
                </a>{" "}
                y pon su Signing Secret en <code className="rounded bg-surface px-1">SLACK_SIGNING_SECRET</code>.
              </p>
            </div>
          ) : code ? (
            <div className="mt-3">
              <p className="text-sm text-muted">En Slack escribe:</p>
              <div className="mt-1 flex items-center gap-2">
                <code className="rounded-lg bg-surface-2 px-3 py-2 text-sm font-semibold tracking-wide text-ink">
                  /omni vincular {code}
                </code>
                <button
                  type="button"
                  onClick={copy}
                  className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
                >
                  {copied ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
                  {copied ? "Copiado" : "Copiar"}
                </button>
              </div>
              <p className="mt-2 text-xs text-muted">El código vence en 15 minutos. Genera otro si se vence.</p>
              <button type="button" onClick={generate} disabled={busy} className="mt-2 text-sm font-medium text-muted hover:underline">
                {busy ? "Generando…" : "Generar otro código"}
              </button>
            </div>
          ) : (
            <button type="button" onClick={generate} disabled={busy} className={`${buttonClass("secondary")} mt-3`}>
              {busy ? "Generando…" : "Generar código"}
            </button>
          )}

          {error ? <p className="mt-2 text-sm text-danger">{error}</p> : null}
        </div>
      </div>
    </Panel>
  );
}
