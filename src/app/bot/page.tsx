import type { Metadata } from "next";
import Link from "next/link";
import { OmniMark } from "@/components/omni-mark";

export const metadata: Metadata = {
  title: "OmniAgentBot",
  description: "El rastreador de precios de OmniAgent: qué visita, cómo se identifica y cómo bloquearlo.",
};

// Página pública que enlaza el User-Agent del rastreador ("OmniAgentBot/1.0 (+https://…/bot)").
export default function BotPage() {
  return (
    <main className="mx-auto min-h-dvh w-full max-w-2xl bg-canvas px-5 py-12 text-ink">
      <OmniMark size={44} />
      <h1 className="mt-6 text-3xl font-semibold tracking-tight">OmniAgentBot</h1>
      <p className="mt-3 text-base leading-relaxed text-muted">
        Es el rastreador de precios de OmniAgent. Visita páginas públicas de productos, boletos, vuelos u hoteles solo cuando una
        persona le pidió vigilar ese precio en su cuenta.
      </p>
      <h2 className="mt-8 text-lg font-semibold">Cómo se comporta</h2>
      <ul className="mt-3 flex list-disc flex-col gap-2 pl-5 text-sm leading-relaxed text-muted">
        <li>Se identifica siempre como <code className="rounded bg-surface-2 px-1">OmniAgentBot/1.0</code> con un enlace a esta página.</li>
        <li>Lee y respeta el archivo robots.txt de cada sitio, incluido Crawl-delay.</li>
        <li>Visita un sitio a la vez, con pausas entre visitas, y como mucho unas pocas veces al día por producto.</li>
        <li>Solo lee el HTML de la página (los datos de producto que el sitio publica); no ejecuta scripts ni descarga imágenes.</li>
        <li>No evade bloqueos, captchas ni límites: si el sitio responde 403 o 429, deja de intentarlo y se lo dice a la persona.</li>
        <li>No inicia sesión, no agrega al carrito ni compra en el sitio.</li>
      </ul>
      <h2 className="mt-8 text-lg font-semibold">Cómo bloquearlo</h2>
      <p className="mt-3 text-sm leading-relaxed text-muted">Agrega esto a tu robots.txt:</p>
      <pre className="mt-3 overflow-x-auto rounded-2xl bg-surface-2 px-4 py-3 text-sm">
        {"User-agent: OmniAgentBot\nDisallow: /"}
      </pre>
      <p className="mt-8 text-sm text-muted">
        <Link href="/" className="font-semibold text-primary underline-offset-2 hover:underline">
          Volver a OmniAgent
        </Link>
      </p>
    </main>
  );
}
