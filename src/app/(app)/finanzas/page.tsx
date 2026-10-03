import type { Metadata } from "next";
import { FinanceView } from "@/components/views/finance-view";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { listBudgets } from "@/modules/finance/budgets.service";
import {
  getAntExpenses,
  getFinanceOverview,
  getMonthlyTrend,
  getSubscriptions,
  listCategories,
  searchTransactions,
} from "@/modules/finance/finance.service";
import { getLatestInsights } from "@/modules/finance/insights/analysis.service";
import { listStatementAccounts } from "@/modules/finance/statement-import/statements.service";
import { listBankConnections } from "@/modules/finance/sync.service";

export const metadata: Metadata = { title: "Finanzas" };

const EMPTY_PAGE = { items: [], nextOffset: null, totalSpent: 0, totalIncome: 0, count: 0 };

export default async function FinancePage() {
  const user = await requireUser();
  const [connections, statementAccounts, profile] = await Promise.all([
    listBankConnections(user.userId),
    listStatementAccounts(user.userId),
    prisma.profile.findUnique({ where: { id: user.userId }, select: { timezone: true, currency: true } }),
  ]);
  const defaultCurrency = profile?.currency ?? "USD";

  // Sin bancos conectados ni estados de cuenta importados: la bienvenida.
  if (connections.length === 0 && statementAccounts.length === 0) {
    return (
      <FinanceView
        connections={[]}
        defaultCurrency={defaultCurrency}
        summary={null}
        trend={null}
        subscriptions={null}
        ant={null}
        budgets={[]}
        insights={null}
        transactions={EMPTY_PAGE}
        categories={[]}
      />
    );
  }

  const timeZone = profile?.timezone ?? undefined;
  const [summary, trend, subscriptions, ant, budgets, insights, transactions, categories] = await Promise.all([
    getFinanceOverview(user.userId, 90),
    getMonthlyTrend(user.userId, timeZone),
    getSubscriptions(user.userId, true),
    getAntExpenses(user.userId, 30, 15),
    listBudgets(user.userId),
    getLatestInsights(user.userId),
    searchTransactions(user.userId, { limit: 20 }),
    listCategories(user.userId),
  ]);

  return (
    <FinanceView
      connections={connections}
      statementAccounts={statementAccounts}
      defaultCurrency={defaultCurrency}
      summary={summary}
      trend={trend}
      subscriptions={subscriptions}
      ant={ant}
      budgets={budgets}
      insights={insights}
      transactions={transactions}
      categories={categories}
      timeZone={timeZone}
    />
  );
}
