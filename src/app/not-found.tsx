import type { Metadata } from "next";
import Link from "next/link";
import { OmniMark } from "@/components/omni-mark";
import { buttonClass } from "@/components/ui";

export const metadata: Metadata = { title: "No encontrado" };

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center px-4 text-center">
      <OmniMark size={48} />
      <p className="mt-5 text-lg font-semibold text-ink">No encontramos esta página</p>
      <p className="mt-2 text-sm leading-relaxed text-muted">Puede que el enlace esté incompleto o que lo que buscabas ya no exista.</p>
      <Link href="/" className={`${buttonClass("primary")} mt-6`}>
        Volver al inicio
      </Link>
    </main>
  );
}
