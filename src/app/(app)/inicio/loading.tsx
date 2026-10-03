// Esqueleto del Inicio: misma geometría que el panel, así nada salta cuando llegan los datos.
function Block({ className }: { className: string }) {
  return <div className={`animate-pulse rounded-3xl bg-surface-2 motion-reduce:animate-none ${className}`} />;
}

export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 pb-10 pt-5 sm:px-6 lg:pt-8" role="status" aria-label="Cargando tu Inicio">
      <div className="h-4 w-44 animate-pulse rounded-full bg-surface-2 motion-reduce:animate-none" />
      <div className="mt-2 h-8 w-64 animate-pulse rounded-full bg-surface-2 motion-reduce:animate-none" />
      <div className="mt-5 grid gap-5 lg:grid-cols-12">
        <Block className="h-56 lg:col-span-8" />
        <Block className="hidden h-56 lg:col-span-4 lg:block" />
      </div>
      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Block className="h-48" />
        <Block className="h-48" />
        <Block className="h-48" />
      </div>
    </div>
  );
}
