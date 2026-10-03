import { cn } from "@/lib/cn";

/**
 * Marca de Omni: un anillo con una pupila descentrada (mira lo que haces por él) y un punto ámbar en órbita.
 * Con `thinking`, la pupila recorre el anillo y la órbita gira (se desactiva con reduced-motion).
 */
export function OmniMark({
  size = 32,
  thinking = false,
  className,
  title,
}: {
  size?: number;
  thinking?: boolean;
  className?: string;
  title?: string;
}) {
  return (
    <svg
      viewBox="0 0 40 40"
      width={size}
      height={size}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      className={cn("omni-mark shrink-0", thinking && "is-thinking", className)}
    >
      <circle cx="20" cy="20" r="20" fill="var(--primary)" />
      <circle cx="20" cy="20" r="10.5" fill="none" stroke="var(--on-primary)" strokeWidth="2.4" />
      <circle className="omni-pupil" cx="22.6" cy="18.1" r="3.4" fill="var(--on-primary)" />
      <circle className="omni-orbit" cx="28.9" cy="11.7" r="1.9" fill="var(--orbit)" />
    </svg>
  );
}
