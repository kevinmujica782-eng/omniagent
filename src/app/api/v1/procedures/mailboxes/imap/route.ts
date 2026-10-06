import { z } from "zod";
import { ensureProfile } from "@/lib/auth";
import { handle, readJson } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { connectRealMailbox } from "@/modules/procedures/mail/mail.service";

export const maxDuration = 60;

const server = z.object({
  host: z.string().trim().min(3).max(253),
  port: z.coerce.number().int().min(1).max(65535),
});

const schema = z.object({
  email: z.string().trim().min(3).max(254),
  /** Contraseña de aplicación: se verifica contra el proveedor y se guarda cifrada. Nunca se devuelve. */
  password: z.string().min(1).max(512),
  service: z.enum(["gmail", "yahoo", "icloud", "aol", "zoho", "custom"]),
  imap: server.optional(),
  smtp: server.optional(),
});

/** Conecta el correo real (IMAP/SMTP), lo revisa por primera vez y detecta los trámites. */
export async function POST(request: Request) {
  return handle(request, async (auth) => {
    const body = await readJson(request, schema);
    // Cada intento entra al servidor de correo con una contraseña: pocos por hora.
    await rateLimit(auth.userId, "mail.connect", { limit: 8, windowSeconds: 3600 });
    await ensureProfile(auth);
    return connectRealMailbox(auth.userId, body);
  });
}
