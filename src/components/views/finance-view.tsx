import { Coffee, Lock, MessageCircle, PiggyBank, Repeat } from "lucide-react";
import { AntExpensesView, FinanceSummaryView, MonthlyTrendView } from "@/components/chat/cards";
import { AccountsPanel } from "@/components/finance/accounts-panel";
import { AnalyzeButton } from "@/components/finance/analyze-button";
import { BudgetsPanel } from "@/components/finance/budgets-panel";
import { ConnectBankButton } from "@/components/finance/connect-bank-button";
import { DemoDataButton } from "@/components/finance/demo-data-button";
import { ImportStatementButton } from "@/components/finance/import-statement-button";
import { InsightsCardView } from "@/components/finance/insights-card";
import type { LinkStep } from "@/components/finance/link-account-dialog";
import { StatementAccountsPanel } from "@/components/finance/statement-accounts-panel";
import { SubscriptionsPanel } from "@/components/finance/subscriptions-panel";
import { TransactionsExplorer } from "@/components/finance/transactions-explorer";
import { OmniMark } from "@/components/omni-mark";
import { ButtonLink, IconTile, PageBody, PageHeader, Section } from "@/components/ui";
import { listJoin, relativeDays } from "@/lib/format";
import type {
  AntExpensesCard,
  BankConnectionView,
  BudgetView,
  FinanceSummaryCard,
  InsightsCard,
  MonthlyTrendCard,
  StatementAccountView,
  SubscriptionsCard,
  TransactionsPageView,
} from "@/types/cards";

export type FinanceViewProps = {
  connections: BankConnectionView[];
  /** Cuentas cargadas con estados de cuenta (PDF o CSV), para bancos sin conexión directa. */
  statementAccounts?: StatementAccountView[];
  /** Moneda del perfil: la de una cuenta nueva al importar un estado de cuenta. */
  defaultCurrency?: string;
  summary: FinanceSummaryCard | null;
  trend: MonthlyTrendCard | null;
  subscriptions: SubscriptionsCard | null;
  ant: AntExpensesCard | null;
  budgets: BudgetView[];
  insights: InsightsCard | null;
  transactions: TransactionsPageView;
  categories: string[];
  timeZone?: string;
  /** Vista previa (/preview): sin llamadas a la API; `linkStep` abre el diálogo de conexión en ese paso. */
  preview?: { insights: InsightsCard; linkStep?: LinkStep };
};

const FEATURES = [
  { icon: Coffee, title: "Gastos hormiga", body: "Las compras pequeñas que, juntas, suman cientos al mes." },
  { icon: Repeat, title: "Suscripciones sin uso", body: "Las detecto y preparo la baja para que tú la apruebes." },
  { icon: PiggyBank, title: "Plan de ahorro", body: "Recomendaciones concretas con el ahorro de cada una." },
];

function FinanceWelcome({ preview, defaultCurrency }: { preview?: FinanceViewProps["preview"]; defaultCurrency?: string }) {
  const demo = Boolean(preview);
  return (
    <>
      <section className="overflow-hidden rounded-3xl border border-line bg-surface">
        <div className="px-6 pb-7 pt-9 text-center sm:px-10">
          <OmniMark size={52} className="mx-auto" />
          <h2 className="mt-5 text-2xl font-semibold tracking-tight text-balance text-ink">
            Descubre a dónde se va tu dinero
          </h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted">
            Conecta tus cuentas y tarjetas. Omni analiza tus últimos 3 meses y te dice, en palabras simples, cómo
            ahorrar.
          </p>
          <div className="mx-auto mt-6 flex max-w-xs flex-col gap-3 sm:max-w-none sm:flex-row sm:items-start sm:justify-center">
            <ConnectBankButton
              size="lg"
              className="w-full sm:w-auto"
              demo={demo}
              demoInsights={preview?.insights ?? null}
              initialStep={preview?.linkStep}
            />
            <DemoDataButton size="lg" className="w-full sm:w-auto" wrapperClassName="w-full sm:w-auto" demo={demo} />
          </div>
          <p className="mt-5 text-sm text-muted">¿Tu banco no aparece? Sube su estado de cuenta en PDF o CSV.</p>
          <ImportStatementButton
            label="Subir estado de cuenta"
            variant="ghost"
            size="sm"
            className="mt-1"
            defaultCurrency={defaultCurrency}
            demo={demo}
          />
        </div>
        <ul className="grid gap-px border-t border-line bg-line sm:grid-cols-3">
          {FEATURES.map((feature) => (
            <li key={feature.title} className="flex items-start gap-3 bg-surface-2 px-5 py-4 sm:flex-col sm:gap-2.5">
              <IconTile icon={feature.icon} size="sm" />
              <div>
                <p className="text-sm font-semibold text-ink">{feature.title}</p>
                <p className="mt-0.5 text-xs leading-relaxed text-muted">{feature.body}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>
      <p className="mt-4 flex items-center justify-center gap-1.5 px-4 text-center text-xs text-muted">
        <Lock className="size-3.5 shrink-0" aria-hidden />
        Solo lectura: Omni nunca mueve tu dinero sin tu aprobación.
      </p>
    </>
  );
}

function AnalysisInvite({ demo }: { demo: boolean }) {
  return (
    <section className="flex flex-col items-start gap-4 rounded-3xl border border-line bg-surface p-5 sm:flex-row sm:items-center">
      <OmniMark size={44} />
      <div className="min-w-0 flex-1">
        <p className="text-base font-semibold text-ink">Pídele a Omni el análisis de tus últimos 3 meses</p>
        <p className="mt-0.5 text-sm leading-relaxed text-muted">
          Encuentra gastos hormiga, suscripciones sin uso y cuánto puedes ahorrar cada mes.
        </p>
      </div>
      <AnalyzeButton demo={demo} />
    </section>
  );
}

export function FinanceView({
  connections,
  statementAccounts = [],
  defaultCurrency,
  summary,
  trend,
  subscriptions,
  ant,
  budgets,
  insights,
  transactions,
  categories,
  timeZone,
  preview,
}: FinanceViewProps) {
  const demo = Boolean(preview);

  if (connections.length === 0 && statementAccounts.length === 0) {
    return (
      <PageBody>
        <PageHeader title="Finanzas" description="Tu asistente de ahorro: ingresos, gastos, suscripciones y gastos hormiga." />
        <FinanceWelcome preview={preview} defaultCurrency={defaultCurrency} />
      </PageBody>
    );
  }

  const importedAccounts = statementAccounts.map((item) => item.account);
  const accounts = [...connections.flatMap((connection) => connection.accounts), ...importedAccounts];
  const currency = summary?.currency ?? accounts[0]?.currency ?? defaultCurrency ?? "USD";
  const lastSynced = [
    ...connections.map((connection) => connection.lastSyncedAt),
    ...statementAccounts.map((item) => item.imports[0]?.createdAt ?? null),
  ]
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1);
  const description = [
    listJoin([...new Set([...connections.map((c) => c.institutionName), ...importedAccounts.map((a) => a.institutionName)])]),
    lastSynced ? `actualizado ${relativeDays(lastSynced)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const institutions = connections.map((connection) => connection.institutionName);

  return (
    <PageBody className="max-w-4xl">
      <PageHeader
        title="Finanzas"
        description={description}
        action={
          <ButtonLink href={demo ? "/preview?screen=chat-finanzas" : "/chat?modulo=finanzas"} size="sm">
            <MessageCircle className="size-4" aria-hidden />
            Hablar con Omni
          </ButtonLink>
        }
      />

      {insights ? (
        <InsightsCardView
          key={insights.analysisId}
          card={insights}
          demo={demo}
          actions={<AnalyzeButton label="Actualizar" variant="ghost" size="sm" demo={demo} />}
        />
      ) : (
        <AnalysisInvite demo={demo} />
      )}

      <div className="mt-4 grid items-start gap-4 md:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-4">
          {summary ? <FinanceSummaryView card={summary} /> : null}
          {subscriptions ? <SubscriptionsPanel card={subscriptions} demo={demo} /> : null}
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          {trend ? <MonthlyTrendView card={trend} /> : null}
          {ant && ant.items.length > 0 ? <AntExpensesView card={ant} /> : null}
          <BudgetsPanel budgets={budgets} categories={categories} currency={currency} demo={demo} />
        </div>
      </div>

      <Section
        title="Cuentas"
        className="mt-10"
        action={
          <ConnectBankButton
            label="Conectar"
            variant="secondary"
            size="sm"
            connectedInstitutions={institutions}
            demo={demo}
            demoInsights={preview?.insights ?? null}
          />
        }
      >
        <div className="flex flex-col gap-3">
          {connections.length > 0 ? <AccountsPanel connections={connections} demo={demo} /> : null}
          {statementAccounts.length > 0 ? (
            <StatementAccountsPanel items={statementAccounts} defaultCurrency={defaultCurrency ?? currency} demo={demo} />
          ) : null}
          {/* Para bancos que no se pueden conectar: el estado de cuenta en PDF o CSV. */}
          <div className="flex flex-col items-start gap-2.5 rounded-2xl border border-dashed border-line-strong px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted">¿Algún banco no se puede conectar? Sube su estado de cuenta en PDF o CSV.</p>
            <ImportStatementButton
              label="Subir estado de cuenta"
              size="sm"
              className="shrink-0"
              accounts={importedAccounts}
              defaultCurrency={defaultCurrency ?? currency}
              demo={demo}
            />
          </div>
        </div>
      </Section>

      <Section title="Movimientos" className="mt-10">
        <TransactionsExplorer
          initial={transactions}
          categories={categories}
          accounts={accounts}
          timeZone={timeZone}
          demo={demo}
        />
      </Section>
    </PageBody>
  );
}
