import { z } from "zod";
import { ensureProfile } from "@/lib/auth";
import { Errors } from "@/lib/errors";
import { handle } from "@/lib/http";
import { startCheckout } from "@/modules/concierge/checkout.service";

type Context = { params: Promise<{ id: string }> };

const schema = z.object({
  quantity: z.number().int().min(1).max(10).optional(),
  alertId: z.string().uuid().nullable().optional(),
});

/** Prepara la compra (no cobra): devuelve la hoja de pago para Permitir o Denegar. */
export async function POST(request: Request, { params }: Context) {
  return handle(request, async (auth) => {
    const { id } = await params;
    const text = await request.text().catch(() => "");
    let body: unknown = {};
    if (text.trim()) {
      try {
        body = JSON.parse(text);
      } catch {
        throw Errors.badRequest("El cuerpo de la solicitud debe ser JSON válido.");
      }
    }
    const input = schema.parse(body);
    await ensureProfile(auth);
    return startCheckout(auth.userId, { itemId: id, quantity: input.quantity, alertId: input.alertId ?? null, actor: "user" });
  });
}
