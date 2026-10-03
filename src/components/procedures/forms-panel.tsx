"use client";

import { Download, FileText, Loader, Mail, Sparkles, Upload } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, type ChangeEvent } from "react";
import { formHref } from "@/components/procedures/procedure-card";
import { Chip, buttonClass } from "@/components/ui";
import { ApiError, errorMessage } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { plural } from "@/lib/format";
import { dayText } from "@/lib/procedures-copy";
import type { FormDocumentView } from "@/types/cards";

const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

/** Botón para subir un formulario PDF: lo guarda y abre la revisión (donde Omni lo lee con IA). */
export function UploadFormButton({
  demo = false,
  variant = "secondary",
  size = "sm",
  label = "Subir PDF",
  className,
}: {
  demo?: boolean;
  variant?: "primary" | "secondary";
  size?: "sm" | "lg";
  label?: string;
  className?: string;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setError(null);
    if (file.type && file.type !== "application/pdf") {
      setError("Elige un archivo PDF.");
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setError("El PDF supera los 4 MB.");
      return;
    }
    if (demo) {
      router.push("/preview?screen=formulario");
      return;
    }
    setBusy(true);
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch("/api/v1/procedures/documents", { method: "POST", body });
      const json = (await res.json().catch(() => null)) as { data?: { documentId: string }; error?: { message?: string } } | null;
      if (!res.ok || !json?.data) throw new ApiError(res.status, null, json?.error?.message ?? "No se pudo subir el PDF.");
      router.push(`/tramites/formularios/${json.data.documentId}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <span className={cn("relative inline-flex flex-col items-start gap-1", className)}>
      <input ref={inputRef} type="file" accept="application/pdf,.pdf" className="sr-only" onChange={onFile} tabIndex={-1} aria-hidden />
      <button type="button" onClick={() => inputRef.current?.click()} disabled={busy} className={cn(buttonClass(variant, size), className)}>
        {busy ? <Loader className="size-4 animate-spin" aria-hidden /> : <Upload className="size-4" aria-hidden />}
        {busy ? "Subiendo…" : label}
      </button>
      {error ? (
        <span role="alert" className="max-w-xs text-xs text-danger">
          {error}
        </span>
      ) : null}
    </span>
  );
}

/** Formularios (adjuntos del correo o subidos) con su estado: leídos, por completar, llenos. */
export function FormsPanel({ forms, timeZone, demo = false }: { forms: FormDocumentView[]; timeZone: string; demo?: boolean }) {
  if (forms.length === 0) {
    return (
      <div className="flex flex-col items-start gap-3 rounded-2xl border border-dashed border-line-strong px-4 py-5 sm:flex-row sm:items-center">
        <p className="flex-1 text-sm leading-relaxed text-muted">
          Los formularios que lleguen a tu correo aparecen aquí. También puedes subir un PDF: Omni detecta sus campos y lo
          llena con tus datos.
        </p>
        <UploadFormButton demo={demo} />
      </div>
    );
  }
  const now = new Date();
  return (
    <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
      {forms.map((form) => {
        const ready = form.totalFields !== null && form.missingCount !== null ? form.totalFields - form.missingCount : null;
        return (
          <li key={form.id} className="flex flex-wrap items-center gap-3 px-4 py-3.5">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-surface-2 text-muted">
              <FileText className="size-5" aria-hidden />
            </span>
            <div className="min-w-0 flex-1 basis-44">
              <p className="truncate text-sm font-semibold text-ink">{form.title ?? form.fileName}</p>
              <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted">
                {form.source === "email" ? <Mail className="size-3.5" aria-hidden /> : <Upload className="size-3.5" aria-hidden />}
                <span>{form.source === "email" ? "Del correo" : "Subido"}</span>
                <span aria-hidden>·</span>
                <span>{dayText(form.createdAt, timeZone, now)}</span>
                {ready !== null && form.totalFields ? (
                  <>
                    <span aria-hidden>·</span>
                    <span>
                      {ready} de {plural(form.totalFields, "campo", "campos")}
                    </span>
                  </>
                ) : null}
              </p>
            </div>
            <span className="ml-auto flex shrink-0 flex-wrap items-center gap-2">
              {form.readWithAI ? (
                <Chip tone="good">
                  <Sparkles className="size-3" aria-hidden />
                  Leído con IA
                </Chip>
              ) : null}
              {form.filledDocumentId ? (
                demo ? (
                  <Chip tone="good">Lleno</Chip>
                ) : (
                  <a href={`/api/v1/procedures/documents/${form.filledDocumentId}/file`} className={buttonClass("ghost", "sm")}>
                    <Download className="size-4" aria-hidden />
                    PDF lleno
                  </a>
                )
              ) : null}
              <Link href={formHref(form.id, demo)} className={buttonClass("secondary", "sm")}>
                {form.filledDocumentId ? "Revisar" : "Llenar"}
              </Link>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
