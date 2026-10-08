import { handle } from "@/lib/http";
import { archiveSite } from "@/modules/sites/sites.service";

type Context = { params: Promise<{ id: string }> };

/** Retira una página: su enlace deja de abrir (los datos quedan para la memoria y la auditoría). */
export async function DELETE(request: Request, { params }: Context) {
  return handle(request, async (auth) => {
    const { id } = await params;
    return { site: await archiveSite(auth.userId, id) };
  });
}
