"use client";

import { ErrorScreen } from "@/components/error-screen";

/** Errores dentro de la app: la navegación sigue en pie y se puede reintentar solo esta pantalla. */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErrorScreen digest={error.digest} reset={reset} homeHref="/inicio" />;
}
