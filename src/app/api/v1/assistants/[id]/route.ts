import { handle, readJson } from "@/lib/http";
import { archiveAssistant, updateAssistant } from "@/modules/assistants/assistants.service";
import { assistantUpdateSchema } from "@/modules/assistants/assistants.types";

type Context = { params: Promise<{ id: string }> };

/** Edita un Dot, lo marca por defecto o lo archiva/restaura. */
export async function PATCH(request: Request, { params }: Context) {
  return handle(request, async (auth) => {
    const { id } = await params;
    const body = await readJson(request, assistantUpdateSchema);
    const assistant = await updateAssistant(auth.userId, id, body);
    return { assistant };
  });
}

/** Archiva un Dot (no lo borra: una conversación anterior pudo usarlo). */
export async function DELETE(request: Request, { params }: Context) {
  return handle(request, async (auth) => {
    const { id } = await params;
    return archiveAssistant(auth.userId, id);
  });
}
