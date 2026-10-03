// Contrato del panel de Inicio entre el servidor (modules/dashboard), la API /api/v1/dashboard y la vista.
import type { BillingOverview } from "./billing";

/** Cada sección se carga por separado: si una falla, las demás se muestran igual. */
export type SectionState<T> = { status: "ok"; data: T } | { status: "empty" } | { status: "error"; message: string };

export interface FinanceGlance {
  currency: string;
  /** "septiembre" */
  monthLabel: string;
  spentThisMonth: number;
  /** Gasto del mes pasado hasta el mismo día (para comparar peras con peras). */
  spentSamePointLastMonth: number | null;
  changePct: number | null;
  /** Gasto por día del mes en curso (1…hoy). */
  daily: { day: number; amount: number }[];
  /** Gasto por día del mes pasado completo (para la línea de comparación). Vacío si no hay historial. */
  previousDaily: { day: number; amount: number }[];
  /** Días que tiene el mes en curso (el eje llega hasta el último aunque hoy sea día 5). */
  daysInMonth: number;
  topCategory: { name: string; amount: number } | null;
  unusedSubscriptions: { count: number; monthly: number };
  budgets: { over: number; warning: number; total: number };
  accounts: number;
  lastSyncAt: string | null;
}

export interface ProceduresGlance {
  toConfirm: number;
  due: { id: string; title: string; when: string; urgent: boolean; href: string }[];
  nextEvent: { title: string; when: string } | null;
  mailboxConnected: boolean;
  lastSyncAt: string | null;
}

export interface ShoppingGlance {
  currency: string;
  watching: number;
  limit: number;
  newAlerts: number;
  topAlert: { id: string; title: string; price: number; dropPct: number | null; savings: number | null; href: string } | null;
  pendingPurchases: number;
  lastCheckAt: string | null;
  nextCheckAt: string | null;
}

export type AttentionKind = "purchase" | "approval" | "return" | "procedure" | "alert" | "billing";

/** Lo que necesita al usuario ahora, en orden de urgencia. */
export interface AttentionItem {
  id: string;
  kind: AttentionKind;
  title: string;
  detail: string;
  href: string;
  amount: { value: number; currency: string; period: string | null } | null;
}

export type AgentId = "finance" | "mail" | "prices";

export interface AgentStatusView {
  id: AgentId;
  name: string;
  /** active: trabajando en segundo plano; setup: falta conectar algo; paused: sin nada que vigilar o pausado. */
  state: "active" | "setup" | "paused";
  /** "Revisa tu correo cada 3 horas" */
  cadence: string;
  detail: string;
  lastRunAt: string | null;
  nextRunAt: string | null;
  /** En Gratis, qué cambia con Pro ("Con Pro: cada 3 horas"). */
  proHint: string | null;
  href: string;
}

export interface ActivityItem {
  id: string;
  type: "PRICE_DROP" | "ACTION_REQUIRED" | "INSIGHT" | "REMINDER" | "SYSTEM";
  title: string;
  body: string | null;
  href: string | null;
  createdAt: string;
  read: boolean;
}

export interface SavingsGlance {
  currency: string;
  /** Ahorro de compras de este mes frente al precio normal. */
  purchases: number;
  /** Suscripciones dadas de baja con Omni este mes (equivalente mensual). */
  monthly: number;
  /** Reembolsos y saldos a favor que Omni ayudó a recuperar este mes (Devoluciones). */
  refunds: number;
}

export type AttentionCounts = Record<AttentionKind, number>;

export interface DashboardData {
  now: string;
  timeZone: string;
  /** "Buenas noches, Laura" */
  greeting: string;
  /** "Domingo 27 de septiembre" */
  dateLabel: string;
  /** "Vigilando 4 precios y 1 trámite" */
  status: string;
  attention: AttentionItem[];
  attentionTotal: number;
  /** Cuántos hay de cada tipo (el pie de la tarjeta lleva a cada lista). */
  attentionCounts: AttentionCounts;
  finance: SectionState<FinanceGlance>;
  procedures: SectionState<ProceduresGlance>;
  shopping: SectionState<ShoppingGlance>;
  agents: AgentStatusView[];
  savings: SavingsGlance | null;
  activity: ActivityItem[];
  unreadActivity: number;
  billing: BillingOverview;
}
