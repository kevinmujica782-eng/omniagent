import { handle } from "@/lib/http";
import { deletePersonalField, getPersonalDataView } from "@/modules/procedures/documents/personal-data.service";

type Context = { params: Promise<{ id: string }> };

/** Borra un dato guardado. */
export async function DELETE(request: Request, { params }: Context) {
  return handle(request, async (auth) => {
    const { id } = await params;
    await deletePersonalField(auth.userId, id);
    return getPersonalDataView(auth.userId);
  });
}
