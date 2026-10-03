import { prisma } from "@/lib/db";
import { handle } from "@/lib/http";
import { listBudgets } from "@/modules/finance/budgets.service";
import {
  getAntExpenses,
  getFinanceOverview,
  getMonthlyTrend,
  getSubscriptions,
  listCategories,
} from "@/modules/finance/finance.service";
import { getLatestInsights } from "@/modules/finance/insights/analysis.service";
import { listStatementAccounts } from "@/modules/finance/statement-import/statements.service";
import { listBankConnections } from "@/modules/finance/sync.service";

/** Todo lo que muestra la página de Finanzas, en una sola llamada (útil para la app nativa). */
export async function GET(request: Request) {
  return handle(request, async (auth) => {
    const profile = await prisma.profile.findUnique({ where: { id: auth.userId }, select: { timezone: true } });
    const [connections, statementAccounts, summary, trend, subscriptions, ant, budgets, insights, categories] = await Promise.all([
      listBankConnections(auth.userId),
      listStatementAccounts(auth.userId),
      getFinanceOverview(auth.userId, 90),
      getMonthlyTrend(auth.userId, profile?.timezone),
      getSubscriptions(auth.userId, true),
      getAntExpenses(auth.userId, 30, 15),
      listBudgets(auth.userId),
      getLatestInsights(auth.userId),
      listCategories(auth.userId),
    ]);
    return { connections, statementAccounts, summary, trend, subscriptions, ant, budgets, insights, categories };
  });
}
