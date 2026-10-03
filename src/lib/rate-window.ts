// Ventanas fijas del límite de tasa (puro).

export function windowStart(now: Date, windowSeconds: number): Date {
  const size = windowSeconds * 1000;
  return new Date(Math.floor(now.getTime() / size) * size);
}

/** Segundos hasta que termina la ventana actual (para la cabecera Retry-After). */
export function secondsUntilReset(now: Date, windowSeconds: number): number {
  const end = windowStart(now, windowSeconds).getTime() + windowSeconds * 1000;
  return Math.max(1, Math.ceil((end - now.getTime()) / 1000));
}
