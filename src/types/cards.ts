/**
 * Contrato entre el agente y la UI: tarjetas que acompañan las respuestas del chat
 * y modelos de vista de las páginas. Se guardan en messages.content ({ text, cards }) y las
 * renderiza src/components/chat/cards.tsx. Sin dependencias de servidor: lo importan cliente y servidor.
 */

export type Cadence = "WEEKLY" | "MONTHLY" | "QUARTERLY" | "YEARLY";

export type ActionKind = "CANCEL_SUBSCRIPTION" | "SEND_EMAIL" | "CREATE_CALENDAR_EVENT" | "SUBMIT_FORM" | "PURCHASE";

export type ActionState = "PENDING" | "APPROVED" | "REJECTED" | "EXECUTED" | "FAILED" | "EXPIRED";

export type ModuleKind = "GENERAL" | "FINANCE" | "PROCEDURES" | "CONCIERGE" | "GOALS";

export type FinanceSummaryCard = {
  kind: "finance_summary";
  sources: string[];
  periodDays: number;
  transactionCount: number;
  currency: string;
  monthlyIncome: number;
  monthlySpending: number;
  monthlySaved: number;
  savingsRate: number;
  topCategories: { name: string; monthly: number; changePct: number | null }[];
};

export type SubscriptionItem = {
  id: string;
  merchant: string;
  amount: number;
  cadence: Cadence;
  status: string;
  subcategory: string | null;
  lastUsedDaysAgo: number | null;
  /** De dónde sale el dato de uso: señal de la app (signal) o lo que dijo el usuario (user). */
  usageSource: "signal" | "user" | null;
  nextExpectedAt: string | null;
};

export type SubscriptionsCard = {
  kind: "subscriptions";
  currency: string;
  monthlyTotal: number;
  unusedMonthlyTotal: number;
  items: SubscriptionItem[];
};

export type AntExpensesCard = {
  kind: "ant_expenses";
  currency: string;
  periodDays: number;
  maxAmount: number;
  monthlyProjection: number;
  items: { merchant: string; count: number; total: number; averageTicket?: number; monthlyProjection: number }[];
};

export type MonthlyTrendCard = {
  kind: "monthly_trend";
  currency: string;
  months: { label: string; income: number; spending: number; net: number }[];
};

export type TransactionsCard = {
  kind: "transactions";
  title: string;
  currency: string;
  count: number;
  totalSpent: number;
  totalIncome: number;
  items: TransactionView[];
};

export type BudgetView = {
  id: string;
  category: string;
  currency: string;
  monthlyLimit: number;
  spent: number;
  pct: number;
  state: "ok" | "alerta" | "excedido";
};

export type BudgetsCard = {
  kind: "budgets";
  currency: string;
  items: BudgetView[];
};

export type RecommendationKindId =
  | "CANCEL_SUBSCRIPTION"
  | "REDUCE_ANT_EXPENSES"
  | "CATEGORY_BUDGET"
  | "AVOID_FEES"
  | "NEGOTIATE_BILL"
  | "SAVINGS_GOAL"
  | "OTHER";

export type RecommendationStatusId = "NEW" | "ACCEPTED" | "DISMISSED" | "DONE" | "EXPIRED";

export type RecommendationView = {
  id: string;
  kind: RecommendationKindId;
  status: RecommendationStatusId;
  difficulty: "EASY" | "MEDIUM" | "HARD";
  title: string;
  detail: string;
  estimatedMonthlySavings: number;
  targetLabel: string | null;
  resultMessage: string | null;
};

export type InsightsCard = {
  kind: "insights";
  analysisId: string;
  source: "AI" | "RULES";
  health: "buena" | "estable" | "en_riesgo";
  headline: string;
  summary: string;
  keyPoints: string[];
  currency: string;
  totalMonthlySavings: number;
  periodLabel: string;
  createdAt: string;
  recommendations: RecommendationView[];
};

export type ApprovalCard = {
  kind: "approval";
  actionId: string;
  type: ActionKind;
  status: ActionState;
  title: string;
  summary: string | null;
  merchant: string | null;
  amount: number | null;
  /** "al mes", "al año"... cuando el monto es recurrente (cancelaciones). */
  amountPeriod: string | null;
  currency: string | null;
  lines: { label: string; value: string }[];
  resultMessage: string | null;
  createdAt: string;
};

export type TrackingCard = {
  kind: "tracking";
  itemId: string;
  title: string;
  merchant: string | null;
  url: string | null;
  currency: string;
  currentPrice: number | null;
  targetPrice: number | null;
  lowestPrice: number | null;
  dropAlertPct: number;
};

export type TaskCard = {
  kind: "task";
  taskId: string;
  title: string;
  type: string;
  notes: string | null;
  dueAt: string | null;
  remindAt: string | null;
};

export type GoalCard = {
  kind: "goal";
  goalId: string;
  title: string;
  description: string | null;
  category: string;
  currency: string;
  targetAmount: number | null;
  currentAmount: number;
  monthlyContribution: number | null;
  targetDate: string | null;
};

// ───────────────────── Trámites y productividad ─────────────────────

export type MailCategoryKind = "FORM" | "APPOINTMENT" | "REIMBURSEMENT" | "BILL" | "DEADLINE" | "EVENT" | "INFO" | "PROMO";
export type TaskStatusId = "SUGGESTED" | "PENDING" | "IN_PROGRESS" | "WAITING_USER" | "DONE" | "CANCELED";

export type ProcedureDocumentView = {
  id: string;
  fileName: string;
  /** Ya se leyó con IA (hay campos detectados). */
  extracted: boolean;
  missingCount: number | null;
  filledDocumentId: string | null;
  filledFileName: string | null;
};

/** Trámite detectado (sugerido) o activo, con su plan: fechas, evento, recordatorio y documentos. */
export type ProcedureView = {
  taskId: string;
  status: TaskStatusId;
  type: string;
  category: MailCategoryKind | null;
  title: string;
  summary: string | null;
  from: { name: string | null; email: string } | null;
  mailSubject: string | null;
  receivedAt: string | null;
  dueAt: string | null;
  dueHasTime: boolean;
  plannedAt: string | null;
  remindAt: string | null;
  /** Por qué esas fechas ("Un día antes de que venza; a las 8:00 p. m. tienes libre"). */
  reason: string | null;
  urgent: boolean;
  overdue: boolean;
  event: { title: string; startsAt: string; endsAt: string | null; allDay: boolean; location: string | null } | null;
  amount: number | null;
  currency: string;
  reference: string | null;
  replyTo: string | null;
  steps: string[];
  documents: ProcedureDocumentView[];
  calendarSynced: boolean;
  confirmedAt: string | null;
  completedAt: string | null;
};

export type InboxDigestCard = {
  kind: "inbox_digest";
  scanned: number;
  newCount: number;
  source: "AI" | "RULES" | null;
  items: ProcedureView[];
};

/** Lista de trámites en el chat (uno recién creado, los pendientes de confirmar o los activos). */
export type ProceduresCard = {
  kind: "procedures";
  title: string;
  items: ProcedureView[];
};

export type FormCard = {
  kind: "form";
  documentId: string;
  fileName: string;
  title: string;
  summary: string | null;
  totalFields: number;
  filledFields: number;
  missingFields: string[];
  requiresSignature: boolean;
  filledDocumentId: string | null;
  dueAt: string | null;
};

export type AgendaItemView = {
  id: string;
  kind: "EVENT" | "DEADLINE" | "FOCUS" | "DUE" | "BUSY";
  title: string;
  startsAt: string;
  endsAt: string | null;
  allDay: boolean;
  location: string | null;
  taskId: string | null;
  synced: boolean;
};

export type AgendaCard = {
  kind: "agenda";
  title: string;
  items: AgendaItemView[];
};

export type MailMessageView = {
  id: string;
  folder: "inbox" | "sent";
  fromName: string | null;
  fromEmail: string;
  toEmails: string[];
  subject: string;
  snippet: string;
  receivedAt: string;
  category: MailCategoryKind | null;
  importance: number;
  summary: string | null;
  actionRequired: boolean;
  attachments: { id: string; fileName: string; mimeType: string; documentId: string | null }[];
  taskId: string | null;
};

export type MailboxView = {
  id: string;
  address: string;
  displayName: string;
  flavor: "gmail" | "outlook";
  /** sandbox: bandeja de prueba. imap: correo real (IMAP/SMTP). */
  provider: "sandbox" | "imap";
  status: "ACTIVE" | "EXPIRED" | "REVOKED" | "ERROR";
  lastSyncedAt: string | null;
  messageCount: number;
};

export type FieldSourceId = "mis_datos" | "correo" | "documento" | "fecha_de_hoy" | "inferido" | "vacio" | "usuario";

export type FormFieldView = {
  id: string;
  label: string;
  kind: "text" | "checkbox" | "radio" | "dropdown" | "signature" | "date";
  value: string | null;
  source: FieldSourceId;
  confidence: number;
  required: boolean;
  note: string | null;
  options?: string[];
  page: number;
  /** Dato de "Mis datos" que corresponde al campo (para guardarlo si el usuario lo escribe). */
  profileKey: { key: string; person: string } | null;
};

export type FormExtractionView = {
  documentId: string;
  fileName: string;
  title: string;
  docType: string;
  issuer: string | null;
  summary: string;
  dueDate: string | null;
  person: string | null;
  requiresSignature: boolean;
  steps: string[];
  source: "AI" | "RULES";
  flat: boolean;
  pageCount: number;
  fields: FormFieldView[];
  filledDocumentId: string | null;
  filledAt: string | null;
  taskId: string | null;
  mail: { subject: string; from: string; replyTo: string | null } | null;
  /** Aviso sobre la lectura ("Usaste tus lecturas con IA de este mes; lo llené con reglas."). */
  note?: string | null;
};

/** Formulario guardado (adjunto o subido) con su estado, para la lista de Trámites. */
export type FormDocumentView = {
  id: string;
  fileName: string;
  source: "email" | "upload" | "generated";
  createdAt: string;
  taskId: string | null;
  taskTitle: string | null;
  title: string | null;
  extracted: boolean;
  readWithAI: boolean;
  totalFields: number | null;
  missingCount: number | null;
  filledDocumentId: string | null;
  filledFileName: string | null;
  filledAt: string | null;
};

export type PersonalDataView = {
  persons: {
    person: string;
    relation: string | null;
    isSelf: boolean;
    fields: { id: string; key: string; label: string; value: string; source: string }[];
  }[];
};

export type CalendarSyncView = {
  calendars: { id: string; name: string; address: string }[];
  feedUrl: string | null;
  webcalUrl: string | null;
};

// ───────────────────── Compras y ofertas (concierge) ─────────────────────

export type WatchKindId = "PRODUCT" | "FLIGHT" | "EVENT_TICKET" | "HOTEL" | "OTHER";
export type WatchStatusId = "ACTIVE" | "PAUSED" | "PURCHASED" | "ARCHIVED";
/** Cómo se leyó el precio: datos estructurados de la página, IA, tienda de prueba o a mano. */
export type PriceMethodId = "jsonld" | "microdata" | "meta" | "ai" | "manual";
export type PriceAlertReasonId = "DROP" | "TARGET" | "LOWEST";
export type PriceAlertStatusId = "NEW" | "SEEN" | "ACTED" | "DISMISSED" | "EXPIRED";

/** Producto, boleto, vuelo u hotel que Omni vigila. */
export type TrackedItemView = {
  id: string;
  kind: WatchKindId;
  status: WatchStatusId;
  title: string;
  merchant: string | null;
  url: string | null;
  host: string | null;
  source: "sandbox" | "web" | "manual";
  method: PriceMethodId | null;
  currency: string;
  currentPrice: number | null;
  /** Mediana de los últimos 30 días (o el primer precio visto). */
  referencePrice: number | null;
  /** Cambio frente a la referencia, en % (negativo = bajó). */
  changePct: number | null;
  lowestPrice: number | null;
  highestPrice: number | null;
  targetPrice: number | null;
  dropAlertPct: number;
  quantity: number;
  inStock: boolean | null;
  stockCount: number | null;
  detail: string | null;
  eventDate: string | null;
  lastCheckedAt: string | null;
  nextCheckAt: string | null;
  checkEveryMinutes: number;
  /** ok, reintentando tras un error, sin poder leer la página, bloqueada por la tienda o pausada por errores. */
  health: "ok" | "retrying" | "failing" | "blocked" | "paused";
  lastError: string | null;
  /** Precios de los últimos 30 días (uno por día) para la minigráfica. */
  spark: number[];
  createdAt: string;
};

export type PriceAlertView = {
  id: string;
  itemId: string;
  status: PriceAlertStatusId;
  kind: WatchKindId;
  title: string;
  merchant: string | null;
  detail: string | null;
  headline: string;
  summary: string;
  verdict: "buy" | "wait" | null;
  source: "AI" | "RULES";
  reasons: PriceAlertReasonId[];
  currency: string;
  price: number;
  previousPrice: number | null;
  referencePrice: number | null;
  lowestPrice: number | null;
  targetPrice: number | null;
  dropPct: number | null;
  /** Lo que se ahorra frente a la referencia, por unidad. */
  savings: number | null;
  inStock: boolean | null;
  stockCount: number | null;
  spark: number[];
  createdAt: string;
  expiresAt: string | null;
  /** Compra preparada desde la alerta y su estado. */
  actionId: string | null;
  actionStatus: ActionState | null;
};

export type PaymentMethodView = {
  id: string;
  brand: "visa" | "mastercard";
  label: string;
  last4: string;
  sandbox: boolean;
  /** Tarjeta de prueba que siempre rechaza (para probar ese camino). */
  declines: boolean;
};

export type OrderView = {
  id: string;
  status: "PLACED" | "FAILED" | "CANCELED";
  orderNumber: string | null;
  kind: WatchKindId;
  title: string;
  merchant: string | null;
  quantity: number;
  total: number;
  currency: string;
  paymentLabel: string;
  delivery: { label: string; detail: string | null } | null;
  failureReason: string | null;
  sandbox: boolean;
  createdAt: string;
};

/** Hoja de pago: lo que el usuario autoriza (Permitir) o rechaza (Denegar). */
export type CheckoutView = {
  actionId: string;
  status: ActionState;
  itemId: string | null;
  kind: WatchKindId;
  title: string;
  merchant: string | null;
  detail: string | null;
  quantity: number;
  unitPrice: number;
  currency: string;
  lines: { label: string; amount: number; note?: string | null }[];
  total: number;
  /** Huella de la cotización: Permitir solo vale para exactamente este total. */
  quoteId: string;
  /** Hasta cuándo se respeta el precio sin volver a autorizar. */
  lockedUntil: string;
  expiresAt: string | null;
  methods: PaymentMethodView[];
  defaultMethodId: string;
  delivery: { label: string; detail: string | null } | null;
  /** "Solo se cobra si el total sigue en $248.00 o menos." */
  guard: string;
  notes: string[];
  sandbox: boolean;
  limits: { perOrder: number; monthlyRemaining: number };
  order: OrderView | null;
  resultMessage: string | null;
  /** El precio cambió desde que se preparó: hay que volver a autorizar. */
  priceChanged: { from: number; to: number } | null;
};

/** Vista previa de un enlace o de un resultado de las tiendas de prueba, antes de seguirlo. */
export type ProductPreviewView = {
  url: string;
  host: string;
  source: "sandbox" | "web";
  title: string | null;
  merchant: string | null;
  kind: WatchKindId;
  price: number | null;
  currency: string | null;
  inStock: boolean | null;
  stockCount: number | null;
  method: PriceMethodId | null;
  detail: string | null;
  eventDate: string | null;
  /** Precios de la tienda en los últimos 30 días (solo tiendas de prueba). */
  spark: number[];
  warnings: string[];
  /** No se puede seguir automáticamente, y por qué. */
  blocked: { reason: string; message: string } | null;
  /** Hay datos para intentar la lectura con IA (la página no publica el precio en datos estructurados). */
  canReadWithAI: boolean;
};

export type ConciergeSettingsView = {
  currency: string;
  perOrderLimit: number;
  monthlyLimit: number;
  spentThisMonth: number;
  methods: PaymentMethodView[];
  webChecks: boolean;
  plan: "FREE" | "PRO";
  maxItems: number;
  checkEveryMinutes: number;
};

// ───────────────────── Pedidos y devoluciones ─────────────────────

export type ShipmentStatusId = "ORDERED" | "SHIPPED" | "DELIVERED" | "CANCELED";
export type OrderSourceId = "OMNIAGENT" | "EMAIL" | "MANUAL" | "EXAMPLE";
export type ReturnReasonId = "LATE" | "NOT_RECEIVED" | "DAMAGED" | "WRONG_ITEM" | "NOT_AS_DESCRIBED" | "CHANGED_MIND";
export type ReturnCaseStatusId = "DRAFT" | "SENT" | "ANSWERED" | "RESOLVED" | "REJECTED" | "CLOSED";
export type ReturnOutcomeId = "REFUND" | "REPLACEMENT" | "STORE_CREDIT" | "ARRIVED";
export type ReturnChannelId = "EMAIL" | "MANUAL";
/** en camino, llega hoy, retrasado, entregado o cancelado (según la fecha prometida y la hora local). */
export type DeliveryKindId = "on_the_way" | "due_today" | "late" | "delivered" | "canceled";

export type ReturnEventKind =
  | "drafted"
  | "proposed"
  | "sent"
  | "follow_up_proposed"
  | "follow_up_sent"
  | "reminder"
  | "escalated"
  | "reply"
  | "package_sent"
  | "info_sent"
  | "refund_received"
  | "closed"
  | "reopened";

export type ReturnEventView = { at: string; kind: ReturnEventKind; text: string };

/** Reclamo o devolución de un pedido, con el mensaje para la tienda y lo que falta. */
export type ReturnCaseView = {
  id: string;
  orderId: string;
  merchant: string;
  orderTitle: string;
  orderNumber: string | null;
  reason: ReturnReasonId;
  status: ReturnCaseStatusId;
  channel: ReturnChannelId;
  desired: ReturnOutcomeId;
  details: string | null;
  subject: string;
  body: string;
  sendTo: string | null;
  /** Propuesta de envío vigente (el reclamo o un seguimiento) para aprobarla ahí mismo. */
  approval: ApprovalCard | null;
  sentAt: string | null;
  followUps: number;
  followUpAt: string | null;
  repliedAt: string | null;
  nextStep: string | null;
  nextStepBy: string | null;
  /** Qué le toca al usuario cuando la tienda respondió: devolver el paquete o mandarle lo que pidió. */
  awaiting: "package" | "info" | null;
  outcome: ReturnOutcomeId | null;
  amount: number | null;
  refundAmount: number | null;
  currency: string;
  refundReceivedAt: string | null;
  resolvedAt: string | null;
  /** Cómo reclamar en el portal de la tienda (canal manual). */
  howToClaim: string | null;
  /** Qué hacer si la tienda no responde o lo rechaza (plataforma, banco). */
  escalation: string[];
  escalated: boolean;
  /** Resumen del caso para copiar en la disputa con el banco o la plataforma (cuando toca escalar). */
  disputeSummary: string | null;
  /** Tienda de prueba (.test): se puede simular su respuesta. */
  sandbox: boolean;
  events: ReturnEventView[];
  createdAt: string;
};

/** Pedido que Omni sigue hasta que llega (y después, mientras se puede devolver). */
export type TrackedOrderView = {
  id: string;
  source: OrderSourceId;
  sandbox: boolean;
  merchant: string;
  title: string;
  orderNumber: string | null;
  total: number | null;
  currency: string;
  status: ShipmentStatusId;
  orderedAt: string;
  expectedBy: string | null;
  /** Última fecha que dio la paquetería o la tienda, si cambió la prometida. */
  latestEstimate: string | null;
  deliveredAt: string | null;
  carrier: string | null;
  trackingNumber: string | null;
  delivery: DeliveryKindId;
  daysLate: number | null;
  daysLeft: number | null;
  /** Ya conviene reclamar el retraso. */
  claimable: boolean;
  likelyLost: boolean;
  returnBy: string | null;
  returnDaysLeft: number | null;
  supportEmail: string | null;
  dismissed: boolean;
  openCase: ReturnCaseView | null;
  closedCases: number;
  /** Resultado del último reclamo resuelto (REFUND o STORE_CREDIT: el producto se devolvió). */
  lastOutcome: ReturnOutcomeId | null;
};

export type ReturnsStatsView = {
  currency: string;
  /** Pedidos en camino (sin contar los descartados). */
  onTheWay: number;
  late: number;
  openCases: number;
  /** Reembolsos y saldos a favor confirmados este mes y en total. */
  recoveredThisMonth: number;
  recoveredTotal: number;
};

export type ReturnsOverviewView = {
  orders: TrackedOrderView[];
  cases: ReturnCaseView[];
  stats: ReturnsStatsView;
  mailbox: { connected: boolean; address: string | null };
};

export type TrackedOrdersCard = { kind: "tracked_orders"; title: string; items: TrackedOrderView[] };
export type ReturnCaseCard = { kind: "return_case"; returnCase: ReturnCaseView };

export type TrackedItemCard = { kind: "tracked_item"; item: TrackedItemView };
export type PriceAlertCard = { kind: "price_alert"; alert: PriceAlertView };
export type OffersCard = { kind: "offers"; query: string; results: ProductPreviewView[]; currency?: string; checkEveryMinutes?: number };
export type PriceHistoryCard = {
  kind: "price_history";
  item: TrackedItemView;
  points: { at: string; price: number }[];
  stats: { min: number; max: number; median: number; days: number };
};
export type CheckoutCard = { kind: "checkout"; checkout: CheckoutView };
export type OrdersCard = { kind: "orders"; items: OrderView[] };

// ─── Plan ────────────────────────────────────────────────────────────────

/** Un límite del plan Gratis en el chat: el motivo y qué desbloquea Pro, con el botón para pasarse. */
export interface UpgradeCard {
  kind: "upgrade";
  reason: string;
  /** Función avanzada que pidió el usuario (ver AgentFeatureId), si la hubo. */
  feature: string | null;
  highlights: string[];
  priceLabel: string;
}

export type AgentCard =
  | FinanceSummaryCard
  | SubscriptionsCard
  | AntExpensesCard
  | MonthlyTrendCard
  | TransactionsCard
  | BudgetsCard
  | InsightsCard
  | ApprovalCard
  | TrackingCard
  | TaskCard
  | GoalCard
  | InboxDigestCard
  | ProceduresCard
  | FormCard
  | AgendaCard
  | TrackedItemCard
  | PriceAlertCard
  | OffersCard
  | PriceHistoryCard
  | CheckoutCard
  | OrdersCard
  | TrackedOrdersCard
  | ReturnCaseCard
  | UpgradeCard;

export type ChatMessageView = {
  id: string;
  role: "user" | "assistant";
  text: string;
  cards: AgentCard[];
  /** Respuestas rápidas sugeridas (se muestran bajo el último mensaje de Omni). */
  suggestions?: string[];
  createdAt: string;
};

/** Idea proactiva (tabla suggestions o sugerencia inicial). */
export type IdeaView = {
  id: string;
  module: ModuleKind;
  title: string;
  body: string;
  prompt: string;
  estimatedMonthlySavings: number | null;
  currency: string | null;
  /** Las ideas iniciales no se guardan en base de datos y no se pueden descartar. */
  starter: boolean;
};

export type TransactionView = {
  id: string;
  postedAt: string;
  amount: number;
  direction: "DEBIT" | "CREDIT";
  currency: string;
  merchantName: string | null;
  description: string;
  category: string | null;
  pending?: boolean;
  /** "Aurora Oro ••4417" */
  accountLabel?: string | null;
};

export type AccountView = {
  id: string;
  connectionId: string | null;
  institutionName: string;
  name: string;
  type: "CHECKING" | "SAVINGS" | "CREDIT_CARD" | "WALLET" | "OTHER";
  subtype: string | null;
  mask: string | null;
  currency: string;
  currentBalance: number | null;
  creditLimit: number | null;
  isSimulated: boolean;
};

export type BankConnectionView = {
  id: string;
  institutionName: string;
  provider: "sandbox" | "plaid";
  status: "ACTIVE" | "EXPIRED" | "REVOKED" | "ERROR";
  lastSyncedAt: string | null;
  accounts: AccountView[];
};

// ── Estados de cuenta importados (PDF o CSV) ──

export type StatementColumnRole = "date" | "description" | "amount" | "debit" | "credit" | "type" | "balance";

export type StatementRowView = {
  /** YYYY-MM-DD */
  date: string;
  description: string;
  merchantName: string;
  category: string;
  amount: number;
  direction: "DEBIT" | "CREDIT";
};

export type StatementSkippedView = { source: string; reason: string; text: string };

/** Lo que se importaría, antes de guardar nada. */
export type StatementPreviewView = {
  fileName: string;
  format: "csv" | "pdf";
  currency: string;
  periodStart: string | null;
  periodEnd: string | null;
  count: number;
  /** Ya importados antes en esa cuenta (null si la cuenta es nueva). */
  duplicates: number | null;
  /** Sin contar transferencias entre cuentas propias. */
  spending: number;
  income: number;
  detected: {
    dateOrder: "DMY" | "MDY" | "YMD";
    dateOrderAmbiguous: boolean;
    signConvention: "negative_is_debit" | "positive_is_debit" | null;
    columns: Partial<Record<StatementColumnRole, string>> | null;
    headers: string[] | null;
    /** CSV: primeras filas con datos, para mostrar un ejemplo de cada columna al elegirlas. */
    sample: string[][] | null;
    pages: number | null;
  };
  warnings: string[];
  sample: StatementRowView[];
  skippedCount: number;
  skipped: StatementSkippedView[];
};

export type StatementImportResultView = {
  importId: string | null;
  accountId: string;
  imported: number;
  duplicates: number;
  skipped: number;
  periodStart: string | null;
  periodEnd: string | null;
  warnings: string[];
};

export type StatementImportView = {
  id: string;
  fileName: string;
  status: "UPLOADED" | "PROCESSING" | "PARSED" | "FAILED";
  periodStart: string | null;
  periodEnd: string | null;
  rowsImported: number;
  error: string | null;
  createdAt: string;
};

/** Cuenta manual (sin conexión bancaria) con sus estados de cuenta importados. */
export type StatementAccountView = {
  account: AccountView;
  imports: StatementImportView[];
};

/** Institución que se puede conectar desde el diálogo (sandbox). */
export type LinkInstitutionView = {
  id: string;
  name: string;
  kind: "bank" | "card" | "wallet" | "coop";
  description: string;
  accounts: {
    id: string;
    name: string;
    type: AccountView["type"];
    subtype: string;
    mask: string;
    creditLimit: number | null;
  }[];
};

/** Sesión de conexión (equivale al link token de Plaid). */
export type LinkSessionView =
  | { provider: "sandbox"; linkToken: string; expiresAt: string; institutions: LinkInstitutionView[] }
  | { provider: "plaid"; linkToken: string; expiresAt: string };

/** Resultado de conectar una institución: cuántas cuentas y movimientos se importaron. */
export type LinkResultView = {
  connectionId: string;
  institution: { id: string; name: string };
  accounts: number;
  added: number;
  modified: number;
  removed: number;
};

/** Página de movimientos (GET /api/v1/finance/transactions). */
export type TransactionsPageView = {
  items: TransactionView[];
  nextOffset: number | null;
  totalSpent: number;
  totalIncome: number;
  count: number;
};
