import { z } from "zod";
import { handle } from "@/lib/http";
import { listMessages } from "@/modules/procedures/mail/mail.service";

const querySchema = z.object({
  q: z.string().max(80).optional(),
  category: z.enum(["FORM", "APPOINTMENT", "REIMBURSEMENT", "BILL", "DEADLINE", "EVENT", "INFO", "PROMO"]).optional(),
  actionOnly: z.enum(["1", "0", "true", "false"]).optional(),
  folder: z.enum(["inbox", "sent"]).default("inbox"),
  take: z.coerce.number().int().min(1).max(100).default(30),
});

/** Correos sincronizados con su clasificación (GET ?q=&category=&actionOnly=1&folder=inbox|sent). */
export async function GET(request: Request) {
  return handle(request, async (auth) => {
    const params = Object.fromEntries(new URL(request.url).searchParams);
    const query = querySchema.parse(params);
    return listMessages(auth.userId, {
      q: query.q,
      category: query.category,
      actionOnly: query.actionOnly === "1" || query.actionOnly === "true",
      folder: query.folder,
      take: query.take,
    });
  });
}
