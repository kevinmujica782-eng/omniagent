import { z } from "zod";
import { ensureProfile } from "@/lib/auth";
import { handle, readJson } from "@/lib/http";
import { connectMailbox, listMailboxes } from "@/modules/procedures/mail/mail.service";

export const maxDuration = 60;

const connectSchema = z.object({
  /** Estilo de la bandeja de prueba. El correo real se conecta en /api/v1/procedures/mailboxes/imap. */
  flavor: z.enum(["gmail", "outlook"]).default("gmail"),
  /** Cargar datos de ejemplo en "Mis datos" (solo si está vacío). */
  withDemoData: z.boolean().default(true),
});

export async function GET(request: Request) {
  return handle(request, (auth) => listMailboxes(auth.userId));
}

/** Conecta la bandeja de prueba, la sincroniza y detecta los trámites. */
export async function POST(request: Request) {
  return handle(request, async (auth) => {
    const body = await readJson(request, connectSchema);
    await ensureProfile(auth);
    return connectMailbox(auth.userId, body);
  });
}
