import { z } from "zod";
import { handle, readJson } from "@/lib/http";
import { listBudgets, upsertBudget } from "@/modules/finance/budgets.service";

const bodySchema = z.object({
  category: z.string().trim().min(2).max(60),
  monthlyLimit: z.number().positive().max(1_000_000),
});

export async function GET(request: Request) {
  return handle(request, (auth) => listBudgets(auth.userId));
}

export async function POST(request: Request) {
  return handle(request, async (auth) => {
    const body = await readJson(request, bodySchema);
    return upsertBudget(auth.userId, { ...body, source: "user" });
  });
}
