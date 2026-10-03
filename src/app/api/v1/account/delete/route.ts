import { z } from "zod";
import { handle, readJson } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { deleteAccount } from "@/modules/account/delete-account";

export const maxDuration = 30;

// La confirmación escrita evita borrados por un toque accidental o por una petición armada por otro sitio.
const schema = z.object({ confirm: z.literal("ELIMINAR") });

/** Elimina la cuenta y todos sus datos (ver delete-account.ts). Responde qué se hizo; la sesión queda cerrada. */
export async function POST(request: Request) {
  return handle(request, async (auth) => {
    await readJson(request, schema);
    await rateLimit(auth.userId, "account.delete", { limit: 3, windowSeconds: 3600 });
    const result = await deleteAccount(auth.userId);
    // Navegador: borra las cookies de sesión. La app nativa (Bearer) descarta su token al recibir la respuesta.
    if (!request.headers.get("authorization")) {
      const supabase = await createSupabaseServerClient().catch(() => null);
      await supabase?.auth.signOut().catch(() => undefined);
    }
    return result;
  });
}
