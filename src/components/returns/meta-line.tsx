import { cn } from "@/lib/cn";

/**
 * "CasaNova Hogar · CNH-51872 · pides: reembolso": cada parte se mantiene entera (un número de pedido no se corta en
 * el guion) y la línea se parte entre partes cuando no cabe.
 *
 * Cada parte lleva su "·" delante y la fila se corre a la izquierda lo que mide ese punto: el de la primera parte de
 * cada renglón queda fuera del recorte, así ningún renglón empieza ni termina con un punto suelto.
 */
export function MetaLine({ parts, className }: { parts: (string | null | undefined | false)[]; className?: string }) {
  const shown = parts.filter((part): part is string => Boolean(part));
  if (shown.length === 0) return null;
  return (
    <div className={cn("overflow-hidden text-xs leading-snug text-muted", className)}>
      <p className="-ml-3 flex flex-wrap">
        {shown.map((part, index) => (
          <span key={`${part}-${index}`} className="flex min-w-0 max-w-full">
            <span aria-hidden className="w-3 shrink-0 text-center">
              ·
            </span>
            {/* Los códigos (números de pedido y de guía) no se parten; el texto con espacios sí. */}
            <span className={/\s/.test(part) ? "min-w-0" : "min-w-0 truncate"}>{part}</span>
          </span>
        ))}
      </p>
    </div>
  );
}
