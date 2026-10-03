import { handle } from "@/lib/http";
import { getMessage } from "@/modules/procedures/mail/mail.service";

type Context = { params: Promise<{ id: string }> };

/** Un correo con su texto completo. */
export async function GET(request: Request, { params }: Context) {
  return handle(request, async (auth) => {
    const { id } = await params;
    return getMessage(auth.userId, id);
  });
}
