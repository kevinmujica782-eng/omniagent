import { handle } from "@/lib/http";
import { downloadAttachment } from "@/modules/procedures/mail/mailbox";

export const maxDuration = 30;

type Context = { params: Promise<{ id: string }> };

/** Descarga un adjunto del correo y lo guarda como documento (una sola vez). */
export async function POST(request: Request, { params }: Context) {
  return handle(request, async (auth) => {
    const { id } = await params;
    const doc = await downloadAttachment(auth.userId, id);
    return { documentId: doc.id, fileName: doc.fileName, mimeType: doc.mimeType };
  });
}
