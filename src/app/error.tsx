"use client";

import { ErrorScreen } from "@/components/error-screen";

/** Errores en páginas públicas (landing, login): mismo mensaje y "Reintentar". */
export default function RootError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErrorScreen digest={error.digest} reset={reset} homeHref="/" />;
}
