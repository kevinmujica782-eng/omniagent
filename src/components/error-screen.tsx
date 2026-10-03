"use client";

import { CircleAlert, House, RefreshCw } from "lucide-react";
import Link from "next/link";
import { buttonClass } from "@/components/ui";

/**
 * Pantalla de error amable: qué pasó, "Reintentar" y volver al inicio. El código (digest) es el mismo que queda
 * en los logs del servidor (next.request_error), así soporte encuentra el error exacto sin ver datos del usuario.
 */
export function ErrorScreen({ digest, reset, homeHref }: { digest?: string; reset: () => void; homeHref: string }) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center px-4 py-16 text-center">
      <span className="grid size-12 place-items-center rounded-2xl bg-attention-soft text-attention">
        <CircleAlert className="size-6" aria-hidden />
      </span>
      <p className="mt-4 text-lg font-semibold text-ink">Algo salió mal</p>
      <p className="mt-2 text-sm leading-relaxed text-muted">
        No pudimos cargar esta pantalla. Tus datos están a salvo: vuelve a intentarlo en unos segundos.
      </p>
      {digest ? <p className="mt-2 text-xs text-muted">Código para soporte: {digest}</p> : null}
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        <button type="button" onClick={reset} className={buttonClass("primary")}>
          <RefreshCw className="size-4" aria-hidden />
          Reintentar
        </button>
        <Link href={homeHref} className={buttonClass("secondary")}>
          <House className="size-4" aria-hidden />
          Ir al inicio
        </Link>
      </div>
    </div>
  );
}
