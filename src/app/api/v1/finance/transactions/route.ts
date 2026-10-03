import { z } from "zod";
import { handle } from "@/lib/http";
import { searchTransactions } from "@/modules/finance/finance.service";

const querySchema = z.object({
  q: z.string().trim().max(80).optional(),
  category: z.string().max(60).optional(),
  accountId: z.uuid().optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  type: z.enum(["gasto", "ingreso"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  offset: z.coerce.number().int().min(0).default(0),
});

/** GET /api/v1/finance/transactions?q=&category=&accountId=&from=&to=&type=&limit=&offset= */
export async function GET(request: Request) {
  return handle(request, async (auth) => {
    const params = Object.fromEntries(
      [...new URL(request.url).searchParams.entries()].filter(([, value]) => value !== ""),
    );
    const f = querySchema.parse(params);
    return searchTransactions(auth.userId, {
      q: f.q,
      category: f.category,
      accountId: f.accountId,
      from: f.from ? new Date(`${f.from}T00:00:00Z`) : undefined,
      to: f.to ? new Date(`${f.to}T23:59:59Z`) : undefined,
      direction: f.type === "gasto" ? "DEBIT" : f.type === "ingreso" ? "CREDIT" : undefined,
      limit: f.limit,
      offset: f.offset,
    });
  });
}
