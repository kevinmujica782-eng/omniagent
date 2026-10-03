import type { ReactNode } from "react";
import { AppShell, type NavKey } from "@/components/app-shell";
import { ChatView } from "@/components/chat/chat-view";
import { demoConcierge } from "@/components/preview/demo-concierge";
import { demoDashboard, type DemoDashboardVariant } from "@/components/preview/demo-dashboard";
import { DEMO_TIME_ZONE, demoData } from "@/components/preview/demo-data";
import { demoProcedures } from "@/components/preview/demo-procedures";
import { demoReturns } from "@/components/preview/demo-returns";
import { FormReview } from "@/components/procedures/form-review";
import { AccountView } from "@/components/views/account-view";
import { ApprovalsView } from "@/components/views/approvals-view";
import { ConciergeView } from "@/components/views/concierge-view";
import { ConnectionsView } from "@/components/views/connections-view";
import { DashboardView } from "@/components/views/dashboard-view";
import { FinanceView } from "@/components/views/finance-view";
import { GoalsView } from "@/components/views/goals-view";
import { IdeasView } from "@/components/views/ideas-view";
import { ProceduresView } from "@/components/views/procedures-view";
import { ReturnsView } from "@/components/views/returns-view";
import { agentStatusLine } from "@/lib/format";
import { CHAT_STARTERS, CONCIERGE_STARTERS, FINANCE_STARTERS, PROCEDURES_STARTERS, RETURNS_STARTERS } from "@/lib/starters";

// Galería /preview: las pantallas reales de la app con datos de ejemplo, sin Supabase ni base de datos.

export const PREVIEW_SCREENS = [
  // Panel de Inicio (Pro, Gratis y cuenta nueva) y la hoja para pasarse a Pro.
  "inicio",
  "inicio-gratis",
  "inicio-nuevo",
  "mejorar",
  "pro",
  "cuenta-gratis",
  "eliminar-cuenta",
  "chat",
  "ideas",
  "metas",
  "finanzas",
  "aprobaciones",
  "conexiones",
  "cuenta",
  // Módulo financiero: bienvenida, conexión de cuentas y el chat del análisis.
  "finanzas-vacia",
  "conectar",
  "conectar-cuentas",
  "conectar-listo",
  "analisis",
  "chat-finanzas",
  // Módulo de trámites: tablero, bienvenida, conexión del correo, revisión de un formulario y el chat.
  "tramites",
  "tramites-vacia",
  "conectar-correo",
  "correo-conectado",
  "formulario",
  "chat-tramites",
  // Módulo de compras: tablero, bienvenida, seguir un precio, hoja de pago (antes y después) y el chat.
  "compras",
  "compras-vacia",
  "seguir-precio",
  "pago",
  "pago-listo",
  "chat-compras",
  // Pedidos y devoluciones: el tablero, la primera vez, la hoja del reclamo y el chat.
  "devoluciones",
  "devoluciones-vacia",
  "reclamo",
  "chat-devoluciones",
] as const;
export type PreviewScreenKey = (typeof PREVIEW_SCREENS)[number];

const NAV_FOR: Record<PreviewScreenKey, NavKey> = {
  inicio: "inicio",
  "inicio-gratis": "inicio",
  "inicio-nuevo": "inicio",
  mejorar: "inicio",
  pro: "inicio",
  "cuenta-gratis": "cuenta",
  "eliminar-cuenta": "cuenta",
  chat: "chat",
  ideas: "ideas",
  metas: "metas",
  finanzas: "finanzas",
  aprobaciones: "aprobaciones",
  conexiones: "conexiones",
  cuenta: "cuenta",
  "finanzas-vacia": "finanzas",
  conectar: "finanzas",
  "conectar-cuentas": "finanzas",
  "conectar-listo": "finanzas",
  analisis: "chat",
  "chat-finanzas": "chat",
  tramites: "tramites",
  "tramites-vacia": "tramites",
  "conectar-correo": "tramites",
  "correo-conectado": "tramites",
  formulario: "tramites",
  "chat-tramites": "chat",
  compras: "compras",
  "compras-vacia": "compras",
  "seguir-precio": "compras",
  pago: "compras",
  "pago-listo": "compras",
  "chat-compras": "chat",
  devoluciones: "devoluciones",
  "devoluciones-vacia": "devoluciones",
  reclamo: "devoluciones",
  "chat-devoluciones": "chat",
};

export function isPreviewScreen(value: unknown): value is PreviewScreenKey {
  return typeof value === "string" && (PREVIEW_SCREENS as readonly string[]).includes(value);
}

export function PreviewScreen({ screen, emptyChat = false }: { screen: PreviewScreenKey; emptyChat?: boolean }) {
  const demo = demoData();
  const procedures = demoProcedures(new Date(), DEMO_TIME_ZONE);
  const shopping = demoConcierge(new Date(), DEMO_TIME_ZONE);
  const returns = demoReturns(new Date(), DEMO_TIME_ZONE);
  const variant: DemoDashboardVariant =
    screen === "inicio-nuevo" ? "new" : screen === "inicio-gratis" || screen === "mejorar" || screen === "pro" || screen === "cuenta-gratis" ? "free" : "pro";
  const dashboard = demoDashboard(new Date(), DEMO_TIME_ZONE, variant);
  let body: ReactNode;

  const conciergeView = (empty: boolean, extra: { track?: boolean; sheet?: "pending" | "done" } = {}) => (
    <ConciergeView
      items={empty ? [] : shopping.items}
      alerts={empty ? [] : shopping.alerts}
      checkouts={empty ? [] : shopping.checkouts}
      orders={empty ? [] : shopping.orders}
      settings={empty ? { ...shopping.settings, spentThisMonth: 0 } : shopping.settings}
      timeZone={DEMO_TIME_ZONE}
      preview={{
        catalog: shopping.catalog,
        checkout: shopping.checkout,
        points: shopping.points,
        track: extra.track ? shopping.track : undefined,
        sheet: extra.sheet === "pending" ? shopping.checkout : extra.sheet === "done" ? shopping.receipt : undefined,
      }}
    />
  );

  const proceduresView = (empty: boolean, connectStep?: "intro" | "connecting" | "done") => (
    <ProceduresView
      mailboxes={empty ? [] : [procedures.mailbox]}
      suggested={empty ? [] : procedures.suggested}
      active={empty ? [] : procedures.active}
      done={empty ? [] : procedures.done}
      agenda={empty ? [] : procedures.agenda}
      calendar={empty ? { calendars: [], feedUrl: null, webcalUrl: null } : procedures.calendarSync}
      forms={empty ? [] : procedures.forms}
      personal={empty ? { persons: [] } : procedures.personal}
      timeZone={DEMO_TIME_ZONE}
      preview={{ connectStep }}
    />
  );

  const emptyFinance = (linkStep?: "intro" | "institution" | "accounts" | "done") => (
    <FinanceView
      connections={[]}
      summary={null}
      trend={null}
      subscriptions={null}
      ant={null}
      budgets={[]}
      insights={null}
      transactions={{ items: [], nextOffset: null, totalSpent: 0, totalIncome: 0, count: 0 }}
      categories={[]}
      timeZone={DEMO_TIME_ZONE}
      preview={{ insights: demo.insights, linkStep }}
    />
  );

  switch (screen) {
    case "chat":
      body = (
        <ChatView
          conversationId={emptyChat ? null : "demo"}
          initialMessages={emptyChat ? [] : demo.conversation}
          starters={CHAT_STARTERS}
          userName="Laura"
          timeZone={DEMO_TIME_ZONE}
          demo
        />
      );
      break;
    case "chat-finanzas":
      body = (
        <ChatView
          conversationId={null}
          initialMessages={[]}
          starters={FINANCE_STARTERS}
          userName="Laura"
          timeZone={DEMO_TIME_ZONE}
          module="FINANCE"
          demo
        />
      );
      break;
    case "analisis":
      body = (
        <ChatView
          conversationId="demo-analysis"
          initialMessages={demo.analysisConversation}
          starters={FINANCE_STARTERS}
          userName="Laura"
          timeZone={DEMO_TIME_ZONE}
          module="FINANCE"
          demo
        />
      );
      break;
    case "ideas":
      body = <IdeasView ideas={demo.ideas} hasData preview />;
      break;
    case "metas":
      body = <GoalsView goals={demo.goals} watching={shopping.items.filter((i) => i.status === "ACTIVE").length} demo />;
      break;
    case "compras":
      body = conciergeView(false);
      break;
    case "compras-vacia":
      body = conciergeView(true);
      break;
    case "seguir-precio":
      body = conciergeView(false, { track: true });
      break;
    case "pago":
      body = conciergeView(false, { sheet: "pending" });
      break;
    case "pago-listo":
      body = conciergeView(false, { sheet: "done" });
      break;
    case "devoluciones":
    case "reclamo":
      body = (
        <ReturnsView
          data={returns.overview}
          timeZone={DEMO_TIME_ZONE}
          currency="USD"
          preview={{ problemOrderId: screen === "reclamo" ? returns.problemOrderId : undefined }}
        />
      );
      break;
    case "devoluciones-vacia":
      body = <ReturnsView data={returns.empty} timeZone={DEMO_TIME_ZONE} currency="USD" preview={{}} />;
      break;
    case "chat-devoluciones":
      body = (
        <ChatView
          conversationId="demo-returns"
          initialMessages={returns.conversation}
          starters={RETURNS_STARTERS}
          userName="Laura"
          timeZone={DEMO_TIME_ZONE}
          module="CONCIERGE"
          variant="returns"
          demo
        />
      );
      break;
    case "chat-compras":
      body = (
        <ChatView
          conversationId="demo-shopping"
          initialMessages={shopping.conversation}
          starters={CONCIERGE_STARTERS}
          userName="Laura"
          timeZone={DEMO_TIME_ZONE}
          module="CONCIERGE"
          demo
        />
      );
      break;
    case "finanzas":
      body = (
        <FinanceView
          connections={demo.bankConnections}
          summary={demo.financeSummary}
          trend={demo.trend}
          subscriptions={demo.subscriptions}
          ant={demo.ant}
          budgets={demo.budgets}
          insights={demo.insights}
          transactions={demo.transactionsPage}
          categories={demo.categories}
          timeZone={DEMO_TIME_ZONE}
          preview={{ insights: demo.insights }}
        />
      );
      break;
    case "finanzas-vacia":
      body = emptyFinance();
      break;
    case "conectar":
      body = emptyFinance("institution");
      break;
    case "conectar-cuentas":
      body = emptyFinance("accounts");
      break;
    case "conectar-listo":
      body = emptyFinance("done");
      break;
    case "tramites":
      body = proceduresView(false);
      break;
    case "tramites-vacia":
      body = proceduresView(true);
      break;
    case "conectar-correo":
      body = proceduresView(true, "intro");
      break;
    case "correo-conectado":
      body = proceduresView(true, "done");
      break;
    case "formulario":
      body = (
        <FormReview
          documentId="demo-form-permiso"
          initial={procedures.formExtraction}
          aiPending={false}
          aiAvailable
          timeZone={DEMO_TIME_ZONE}
          procedure={procedures.suggested.find((p) => p.taskId === "demo-sbx_msg_permiso_acuario") ?? null}
          backHref="/preview?screen=tramites"
          demo
        />
      );
      break;
    case "chat-tramites":
      body = (
        <ChatView
          conversationId="demo-procedures"
          initialMessages={procedures.conversation}
          starters={PROCEDURES_STARTERS}
          userName="Laura"
          timeZone={DEMO_TIME_ZONE}
          module="PROCEDURES"
          demo
        />
      );
      break;
    case "aprobaciones":
      body = (
        <ApprovalsView
          pending={[demo.purchase, demo.cancelCine, demo.email]}
          history={demo.history}
          timeZone={DEMO_TIME_ZONE}
          preview
        />
      );
      break;
    case "conexiones":
      body = <ConnectionsView connected={demo.connections.connected} available={demo.connections.available} preview />;
      break;
    case "inicio":
    case "inicio-gratis":
    case "inicio-nuevo":
    case "mejorar":
    case "pro":
      body = <DashboardView data={dashboard} preview />;
      break;
    case "cuenta":
    case "cuenta-gratis":
    case "eliminar-cuenta":
      body = (
        <AccountView
          profile={{ name: demo.user.name, email: demo.user.email, timezone: DEMO_TIME_ZONE, currency: "USD" }}
          billing={dashboard.billing}
          deleteOpen={screen === "eliminar-cuenta"}
          preview
        />
      );
      break;
  }

  return (
    <AppShell
      user={demo.user}
      timeZone={DEMO_TIME_ZONE}
      pendingApprovals={screen === "inicio-nuevo" ? 0 : screen === "compras-vacia" ? 2 : 3}
      proceduresBadge={screen === "inicio-nuevo" ? 0 : procedures.suggested.length}
      conciergeBadge={screen === "compras-vacia" || screen === "inicio-nuevo" ? 0 : shopping.alerts.filter((a) => a.status === "NEW").length}
      returnsBadge={screen === "devoluciones-vacia" || screen === "inicio-nuevo" ? 0 : returns.badge}
      status={
        screen.startsWith("inicio") || screen === "mejorar" || screen === "pro"
          ? dashboard.status
          : agentStatusLine(screen === "compras-vacia" ? 0 : shopping.items.filter((i) => i.status === "ACTIVE").length, 1)
      }
      recent={screen === "inicio-nuevo" ? [] : demo.recent}
      preview={{
        active: NAV_FOR[screen],
        // "mejorar": chocó con el límite de precios (la fila queda marcada); "pro": abrió Pro desde un botón.
        upgrade:
          screen === "mejorar"
            ? { reason: "Tu plan permite seguir 3 precios a la vez. Pausa uno o pásate a Pro.", feature: null, limit: "watchlist" }
            : screen === "pro"
              ? { reason: null, feature: null }
              : null,
      }}
    >
      {body}
    </AppShell>
  );
}
