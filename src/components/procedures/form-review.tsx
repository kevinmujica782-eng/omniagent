"use client";

import {
  ArrowLeft,
  CircleAlert,
  CircleCheck,
  Download,
  FileText,
  Loader,
  Mail,
  PenLine,
  Send,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { ApprovalSlip } from "@/components/approval-slip";
import { OmniMark } from "@/components/omni-mark";
import { Chip, IconTile, INPUT_CLASS, Progress, buttonClass, type ChipTone } from "@/components/ui";
import { apiFetch, errorMessage, sleep } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { listJoin } from "@/lib/format";
import { dayText, dueText } from "@/lib/procedures-copy";
import type { ApprovalCard, FieldSourceId, FormExtractionView, FormFieldView, ProcedureView } from "@/types/cards";

type Value = string | boolean;
type FillResult = { documentId: string; fileName: string; missingRequired: string[]; signed: boolean };

const SOURCE: Record<FieldSourceId, { label: string; tone: ChipTone }> = {
  mis_datos: { label: "De Mis datos", tone: "good" },
  correo: { label: "Del correo", tone: "good" },
  documento: { label: "Del documento", tone: "neutral" },
  fecha_de_hoy: { label: "Fecha de hoy", tone: "neutral" },
  inferido: { label: "Deducido", tone: "neutral" },
  vacio: { label: "Falta", tone: "attention" },
  usuario: { label: "Editado", tone: "neutral" },
};

function initialValues(extraction: FormExtractionView): Record<string, Value> {
  const values: Record<string, Value> = {};
  for (const field of extraction.fields) {
    if (field.kind === "signature") continue;
    values[field.id] = field.kind === "checkbox" ? field.value === "true" : (field.value ?? "");
  }
  return values;
}

function isFilled(field: FormFieldView, value: Value | undefined): boolean {
  if (field.kind === "checkbox") return value === true;
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Revisión de un formulario: Omni lo lee (con IA si hay cupo), propone cada valor con su origen,
 * el usuario corrige, firma si quiere y genera el PDF. Si llegó por correo, prepara la respuesta
 * con el PDF adjunto, que se envía solo cuando el usuario la aprueba.
 */
export function FormReview({
  documentId,
  initial,
  aiPending,
  aiAvailable,
  timeZone,
  procedure,
  backHref = "/tramites",
  demo = false,
}: {
  documentId: string;
  initial: FormExtractionView | null;
  aiPending: boolean;
  aiAvailable: boolean;
  timeZone: string;
  procedure: ProcedureView | null;
  backHref?: string;
  demo?: boolean;
}) {
  const [extraction, setExtraction] = useState<FormExtractionView | null>(initial);
  const [reading, setReading] = useState(!initial || (aiPending && aiAvailable));
  const [readError, setReadError] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, Value>>(initial ? initialValues(initial) : {});
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [signOptIn, setSignOptIn] = useState(false);
  const [signature, setSignature] = useState("");
  const [saveToProfile, setSaveToProfile] = useState(true);
  const [filling, setFilling] = useState(false);
  const [fillError, setFillError] = useState<string | null>(null);
  const [result, setResult] = useState<FillResult | null>(null);
  const [replying, setReplying] = useState(false);
  const [reply, setReply] = useState<ApprovalCard | null>(null);
  const [replyError, setReplyError] = useState<string | null>(null);
  const started = useRef(false);
  const touchedRef = useRef<Set<string>>(new Set());
  const resultRef = useRef<HTMLElement>(null);

  // Lectura al abrir: con IA si todavía no se intentó (mientras tanto se ve la versión por reglas).
  useEffect(() => {
    if (started.current || !reading) return;
    started.current = true;
    void (async () => {
      try {
        if (demo) {
          await sleep(1800);
          setReading(false);
          return;
        }
        const next = await apiFetch<FormExtractionView>(`/api/v1/procedures/documents/${documentId}/extract`, {
          method: "POST",
          body: { preferAI: aiAvailable },
        });
        setExtraction(next);
        // Lo que el usuario ya editó se respeta; el resto toma la lectura nueva.
        setValues((prev) => {
          const fresh = initialValues(next);
          for (const id of touchedRef.current) if (id in prev) fresh[id] = prev[id];
          return fresh;
        });
      } catch (err) {
        setReadError(errorMessage(err));
      } finally {
        setReading(false);
      }
    })();
  }, [aiAvailable, demo, documentId, reading]);

  function update(field: FormFieldView, value: Value) {
    setValues((prev) => ({ ...prev, [field.id]: value }));
    touchedRef.current.add(field.id);
    setTouched(new Set(touchedRef.current));
    setResult(null);
    setReply(null);
  }

  async function fill() {
    if (!extraction) return;
    setFilling(true);
    setFillError(null);
    setReply(null);
    setReplyError(null);
    const payload: Record<string, string | boolean | null> = {};
    for (const field of extraction.fields) {
      if (field.kind === "signature") {
        if (signOptIn && signature.trim()) payload[field.id] = signature.trim();
        continue;
      }
      const value = values[field.id];
      payload[field.id] = typeof value === "string" ? value.trim() || null : (value ?? null);
    }
    try {
      let next: FillResult;
      if (demo) {
        await sleep(900);
        const missing = extraction.fields
          .filter((f) => f.required && f.kind !== "signature" && !isFilled(f, values[f.id]))
          .map((f) => f.label);
        const signatureId = extraction.fields.find((f) => f.kind === "signature")?.id;
        next = {
          documentId: "demo-filled",
          fileName: extraction.fileName.replace(/\.pdf$/i, "_lleno.pdf"),
          missingRequired: missing,
          signed: Boolean(signatureId && payload[signatureId]),
        };
      } else {
        const response = await apiFetch<FillResult & { extraction: FormExtractionView }>(
          `/api/v1/procedures/documents/${documentId}/fill`,
          { method: "POST", body: { values: payload, saveToProfile } },
        );
        next = response;
        setExtraction(response.extraction);
      }
      setResult(next);
      window.setTimeout(() => resultRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 50);
    } catch (err) {
      setFillError(errorMessage(err));
    } finally {
      setFilling(false);
    }
  }

  async function proposeReply() {
    if (!result) return;
    setReplying(true);
    setReplyError(null);
    try {
      if (demo) {
        await sleep(700);
        setReply({
          kind: "approval",
          actionId: "demo-reply",
          type: "SEND_EMAIL",
          status: "PENDING",
          title: `Re: ${extraction?.mail?.subject ?? extraction?.title ?? "Formulario"}`,
          summary: result.signed ? null : "El PDF va sin firma: fírmalo antes si el remitente la pide.",
          merchant: null,
          amount: null,
          amountPeriod: null,
          currency: null,
          lines: [
            { label: "Para", value: extraction?.mail?.replyTo ?? "" },
            { label: "Adjunto", value: result.fileName },
            {
              label: "Mensaje",
              value: `Hola, ${extraction?.mail?.from.split(/\s+/)[0] ?? ""}:\n\nAdjunto el formulario con los datos completos${result.signed ? " y firmado" : ""}.\n\nSaludos,\nLaura Gómez Rivas`,
            },
          ],
          resultMessage: null,
          createdAt: new Date().toISOString(),
        });
        return;
      }
      setReply(await apiFetch<ApprovalCard>(`/api/v1/procedures/documents/${result.documentId}/reply`, { method: "POST" }));
    } catch (err) {
      setReplyError(errorMessage(err));
    } finally {
      setReplying(false);
    }
  }

  // Primera lectura (sin nada que mostrar todavía).
  if (!extraction) {
    return (
      <div className="mx-auto flex min-h-[60dvh] max-w-md flex-col items-center justify-center px-6 text-center">
        {readError ? (
          <>
            <span className="grid size-14 place-items-center rounded-full bg-danger-soft text-danger">
              <CircleAlert className="size-7" aria-hidden />
            </span>
            <h1 className="mt-4 text-lg font-semibold text-ink">No pude leer este PDF</h1>
            <p role="alert" className="mt-1 text-sm leading-relaxed text-muted">
              {readError}
            </p>
            <Link href={backHref} className={cn(buttonClass("secondary", "md"), "mt-6")}>
              Volver a Trámites
            </Link>
          </>
        ) : (
          <div role="status" aria-live="polite" className="flex flex-col items-center">
            <OmniMark size={56} thinking />
            <h1 className="mt-5 text-lg font-semibold text-ink">Omni está leyendo el formulario…</h1>
            <p className="mt-1 text-sm text-muted">Detecto sus campos y los lleno con tus datos. Toma unos segundos.</p>
          </div>
        )}
      </div>
    );
  }

  const fillable = extraction.fields.filter((f) => f.kind !== "signature");
  const filledCount = fillable.filter((f) => isFilled(f, values[f.id])).length;
  const signatureField = extraction.fields.find((f) => f.kind === "signature") ?? null;
  const due = procedure ? dueText(procedure, timeZone) : null;
  const replyTo = extraction.mail?.replyTo ?? null;
  const downloadHref = (id: string) => `/api/v1/procedures/documents/${id}/file`;

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-10 pt-6 sm:px-6">
      <Link href={backHref} className="inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden />
        Trámites
      </Link>

      <header className="mt-4 rounded-3xl border border-line bg-surface p-5">
        <div className="flex items-start gap-3">
          <IconTile icon={FileText} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs text-muted">
              {extraction.issuer ? `${extraction.issuer} · ` : ""}
              {extraction.fileName}
            </p>
            <h1 className="mt-0.5 text-xl font-semibold leading-snug tracking-tight text-ink">{extraction.title}</h1>
            <div className="mt-2 flex flex-wrap gap-2">
              {reading ? (
                <Chip>
                  <Loader className="size-3 animate-spin" aria-hidden />
                  Leyendo con IA
                </Chip>
              ) : extraction.source === "AI" ? (
                <Chip tone="good">
                  <Sparkles className="size-3" aria-hidden />
                  Leído con IA
                </Chip>
              ) : (
                <Chip>Leído con reglas</Chip>
              )}
              {extraction.requiresSignature ? <Chip>Lleva firma</Chip> : null}
            </div>
          </div>
        </div>
        <p className="mt-3 text-sm leading-relaxed text-muted">{extraction.summary}</p>
        {extraction.mail || due ? (
          <dl className="mt-3 space-y-1 text-sm">
            {extraction.mail ? (
              <div className="flex items-start gap-2">
                <Mail className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
                <dd className="min-w-0 text-muted">
                  Llegó de <span className="text-ink">{extraction.mail.from}</span>: «{extraction.mail.subject}»
                </dd>
              </div>
            ) : null}
            {due ? (
              <div className="flex items-start gap-2">
                <CircleAlert className={cn("mt-0.5 size-4 shrink-0", procedure?.overdue ? "text-danger" : "text-attention")} aria-hidden />
                <dd className="text-muted">
                  Entrégalo antes de <span className="font-medium text-ink">{due}</span>
                </dd>
              </div>
            ) : null}
          </dl>
        ) : null}
        {reading ? (
          <p role="status" className="mt-4 flex items-center gap-2 rounded-xl bg-surface-2 px-3 py-2 text-sm text-muted">
            <OmniMark size={20} thinking />
            Omni está revisando el formulario con IA; puedes ir corrigiendo lo que ves.
          </p>
        ) : null}
        {extraction.note ? (
          <p className="mt-4 rounded-xl bg-attention-soft px-3 py-2 text-sm text-attention">{extraction.note}</p>
        ) : null}
        {readError && !reading ? (
          <p className="mt-4 rounded-xl bg-attention-soft px-3 py-2 text-sm text-attention">
            No pude revisarlo con IA ({readError}). Te muestro lo que llené con reglas.
          </p>
        ) : null}
        <div className="mt-4">
          <div className="mb-1.5 flex items-baseline justify-between text-sm">
            <span className="text-ink">
              <span className="font-semibold tabular-nums">{filledCount}</span> de {fillable.length} campos listos
            </span>
            {extraction.flat ? <span className="text-xs text-muted">PDF sin campos: escribo sobre las líneas</span> : null}
          </div>
          <Progress value={filledCount} max={Math.max(1, fillable.length)} label="Campos listos" />
        </div>
      </header>

      {extraction.filledDocumentId && !result ? (
        <p className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl border border-line bg-surface px-4 py-3 text-sm text-muted">
          <CircleCheck className="size-4 text-primary" aria-hidden />
          Ya generaste este PDF{extraction.filledAt ? ` ${dayText(extraction.filledAt, timeZone)}` : ""}.
          {demo ? null : (
            <a href={downloadHref(extraction.filledDocumentId)} className="font-semibold text-primary underline-offset-2 hover:underline">
              Descargar
            </a>
          )}
        </p>
      ) : null}

      <section aria-label="Campos del formulario" className="mt-6">
        <h2 className="px-1 pb-2 text-sm font-semibold text-ink">Revisa cada dato</h2>
        <ol className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
          {extraction.fields.map((field) => {
            if (field.kind === "signature") return null;
            const value = values[field.id];
            const source: FieldSourceId = touched.has(field.id) ? "usuario" : isFilled(field, value) ? field.source : "vacio";
            const badge = SOURCE[source === "vacio" && !field.required ? "vacio" : source];
            const inputId = `campo-${field.id}`;
            return (
              <li key={field.id} className="px-4 py-3.5">
                {field.kind === "checkbox" ? (
                  <label htmlFor={inputId} className="flex cursor-pointer items-start gap-3">
                    <input
                      id={inputId}
                      type="checkbox"
                      checked={value === true}
                      onChange={(event: ChangeEvent<HTMLInputElement>) => update(field, event.target.checked)}
                      className="mt-0.5 size-5 shrink-0 accent-primary"
                    />
                    <span className="min-w-0 flex-1 text-sm leading-relaxed text-ink">{field.label}</span>
                  </label>
                ) : (
                  <>
                    <div className="mb-1.5 flex items-start justify-between gap-3">
                      <label htmlFor={inputId} className="text-sm font-medium leading-snug text-ink">
                        {field.label}
                        {field.required ? <span className="text-danger"> *</span> : null}
                      </label>
                      <Chip tone={source === "vacio" && !field.required ? "neutral" : badge.tone}>
                        {source === "vacio" && !field.required ? "Opcional" : badge.label}
                      </Chip>
                    </div>
                    {field.kind === "dropdown" || field.kind === "radio" ? (
                      <select
                        id={inputId}
                        value={typeof value === "string" ? value : ""}
                        onChange={(event: ChangeEvent<HTMLSelectElement>) => update(field, event.target.value)}
                        className={INPUT_CLASS}
                      >
                        <option value="">Elige una opción</option>
                        {(field.options ?? []).map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        id={inputId}
                        value={typeof value === "string" ? value : ""}
                        onChange={(event: ChangeEvent<HTMLInputElement>) => update(field, event.target.value)}
                        inputMode={field.kind === "date" ? "numeric" : undefined}
                        placeholder={field.kind === "date" ? "dd/mm/aaaa" : field.required ? "Obligatorio" : "Opcional"}
                        maxLength={500}
                        className={INPUT_CLASS}
                      />
                    )}
                  </>
                )}
                {field.note || (field.confidence > 0 && field.confidence < 0.6 && !touched.has(field.id)) ? (
                  <p className={cn("mt-1.5 text-xs", field.note ? "text-attention" : "text-muted")}>
                    {field.note ?? "Revísalo: Omni no está seguro de este dato."}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ol>
      </section>

      {signatureField ? (
        <section aria-label="Firma" className="mt-4 rounded-2xl border border-line bg-surface px-4 py-4">
          <p className="flex items-center gap-2 text-sm font-semibold text-ink">
            <PenLine className="size-4 text-primary" aria-hidden />
            {signatureField.label || "Firma"}
          </p>
          <p className="mt-1 text-sm leading-relaxed text-muted">
            Omni nunca firma por ti. Si el remitente acepta firma escrita, escribe tu nombre; si pide firma a mano, imprime el
            PDF y fírmalo.
          </p>
          <label className="mt-3 flex items-center gap-3 text-sm text-ink">
            <input type="checkbox" checked={signOptIn} onChange={(event: ChangeEvent<HTMLInputElement>) => setSignOptIn(event.target.checked)} className="size-4 accent-primary" />
            Firmar escribiendo mi nombre
          </label>
          {signOptIn ? (
            <input
              value={signature}
              onChange={(event: ChangeEvent<HTMLInputElement>) => setSignature(event.target.value)}
              placeholder="Tu nombre completo"
              aria-label="Nombre para la firma"
              maxLength={80}
              className={cn(INPUT_CLASS, "mt-2 font-serif italic")}
            />
          ) : null}
        </section>
      ) : null}

      {extraction.steps.length > 0 ? (
        <section className="mt-4 rounded-2xl bg-surface-2 px-4 py-3">
          <p className="text-xs font-semibold text-muted">Después de llenarlo</p>
          <ol className="mt-1.5 list-decimal space-y-1 pl-5 text-sm text-ink">
            {extraction.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </section>
      ) : null}

      <div className="sticky bottom-0 z-10 -mx-4 mt-6 border-t border-line bg-canvas/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-2xl sm:border">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <label className="flex flex-1 items-center gap-2.5 text-sm text-muted">
            <input
              type="checkbox"
              checked={saveToProfile}
              onChange={(event: ChangeEvent<HTMLInputElement>) => setSaveToProfile(event.target.checked)}
              className="size-4 shrink-0 accent-primary"
            />
            Guardar lo nuevo en Mis datos (nunca firmas ni autorizaciones)
          </label>
          <button type="button" onClick={fill} disabled={filling || reading} className={cn(buttonClass("primary", "lg"), "w-full sm:w-auto")}>
            {filling ? <Loader className="size-4 animate-spin" aria-hidden /> : <FileText className="size-4" aria-hidden />}
            {filling ? "Generando PDF…" : result ? "Volver a generar" : "Generar PDF lleno"}
          </button>
        </div>
        {fillError ? (
          <p role="alert" className="mt-2 text-sm text-danger">
            {fillError}
          </p>
        ) : null}
      </div>

      {result ? (
        <section ref={resultRef} className="mt-6 rounded-2xl border border-primary/30 bg-primary-soft p-4">
          <p className="flex items-center gap-2 text-sm font-semibold text-primary">
            <CircleCheck className="size-5" aria-hidden />
            Listo: {result.fileName}
          </p>
          {result.missingRequired.length > 0 ? (
            <p className="mt-2 text-sm leading-relaxed text-ink">
              Aún faltan: <span className="font-medium">{listJoin(result.missingRequired)}</span>. Complétalos y vuelve a
              generarlo, o hazlo a mano en el papel.
            </p>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-2">
            {demo ? (
              <span className={cn(buttonClass("primary", "sm"), "pointer-events-none")}>
                <Download className="size-4" aria-hidden />
                Descargar PDF
              </span>
            ) : (
              <a href={downloadHref(result.documentId)} className={buttonClass("primary", "sm")}>
                <Download className="size-4" aria-hidden />
                Descargar PDF
              </a>
            )}
            {replyTo && !reply ? (
              <button type="button" onClick={proposeReply} disabled={replying} className={buttonClass("secondary", "sm")}>
                {replying ? <Loader className="size-4 animate-spin" aria-hidden /> : <Send className="size-4" aria-hidden />}
                Responder a {replyTo}
              </button>
            ) : null}
          </div>
          {!replyTo ? (
            <p className="mt-2 text-xs text-muted">Este formulario no llegó por correo: descárgalo y entrégalo tú.</p>
          ) : !reply ? (
            <p className="mt-2 text-xs text-muted">Preparo el correo con el PDF adjunto; no se envía hasta que lo apruebes.</p>
          ) : null}
          {replyError ? (
            <p role="alert" className="mt-2 text-sm text-danger">
              {replyError}
            </p>
          ) : null}
        </section>
      ) : null}

      {reply ? (
        <div className="mt-4">
          <ApprovalSlip card={reply} demo={demo} />
        </div>
      ) : null}
    </div>
  );
}
