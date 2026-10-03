// Datos de ejemplo para la landing y la galería /preview (sin base de datos).
import { dateTime, shortDate } from "@/lib/format";
import { CONNECTOR_CATALOG, type ConnectorView } from "@/modules/connections/catalog";
import type {
  AccountView,
  AntExpensesCard,
  ApprovalCard,
  BankConnectionView,
  BudgetView,
  ChatMessageView,
  FinanceSummaryCard,
  GoalCard,
  IdeaView,
  InsightsCard,
  MonthlyTrendCard,
  RecommendationView,
  SubscriptionsCard,
  TaskCard,
  TrackingCard,
  TransactionView,
  TransactionsCard,
  TransactionsPageView,
} from "@/types/cards";

const DAY = 86_400_000;
export const DEMO_TIME_ZONE = "America/New_York";

export function demoData(now: Date = new Date()) {
  const at = (days: number, hourUtc = 14, minute = 0) => {
    const d = new Date(now.getTime() + days * DAY);
    d.setUTCHours(hourUtc, minute, 0, 0);
    return d.toISOString();
  };
  const monthsAhead = (months: number) =>
    new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + months, 1)).toISOString().slice(0, 10);
  const created = now.toISOString();
  const sub = (
    id: string,
    merchant: string,
    amount: number,
    subcategory: string,
    status: "ACTIVE" | "UNUSED_SUSPECTED",
    lastUsedDaysAgo: number,
    nextInDays: number,
  ): SubscriptionsCard["items"][number] => ({
    id,
    merchant,
    amount,
    cadence: "MONTHLY",
    status,
    subcategory,
    lastUsedDaysAgo,
    usageSource: "signal",
    nextExpectedAt: at(nextInDays),
  });

  const financeSummary: FinanceSummaryCard = {
    kind: "finance_summary",
    sources: ["Cuenta nómina ••3689", "Ahorros ••5120", "Aurora Oro ••4417"],
    periodDays: 90,
    transactionCount: 268,
    currency: "USD",
    monthlyIncome: 4850,
    monthlySpending: 4212,
    monthlySaved: 638,
    savingsRate: 0.13,
    topCategories: [
      { name: "Vivienda", monthly: 1850, changePct: 0 },
      { name: "Supermercado", monthly: 712, changePct: -4 },
      { name: "Restaurantes", monthly: 386, changePct: 38 },
      { name: "Delivery", monthly: 322, changePct: 12 },
      { name: "Transporte", monthly: 301, changePct: -9 },
      { name: "Suscripciones", monthly: 90, changePct: 0 },
    ],
  };

  const subscriptions: SubscriptionsCard = {
    kind: "subscriptions",
    currency: "USD",
    monthlyTotal: 89.96,
    unusedMonthlyTotal: 23.98,
    items: [
      sub("s1", "GymFit", 39, "gimnasio", "ACTIVE", 6, 8),
      sub("s2", "StreamFlix", 15.99, "video", "ACTIVE", 2, 10),
      sub("s3", "Noticias Premium", 12, "noticias", "UNUSED_SUSPECTED", 126, 26),
      sub("s4", "MúsicaMax", 10.99, "musica", "ACTIVE", 1, 14),
      sub("s5", "CineClub+", 8.99, "video", "UNUSED_SUSPECTED", 104, 17),
      sub("s6", "NubeFotos 200 GB", 2.99, "almacenamiento", "UNUSED_SUSPECTED", 97, 21),
    ],
  };

  const ant: AntExpensesCard = {
    kind: "ant_expenses",
    currency: "USD",
    periodDays: 30,
    maxAmount: 15,
    monthlyProjection: 132.48,
    items: [
      { merchant: "Café Grano de Oro", count: 18, total: 80.3, averageTicket: 4.46, monthlyProjection: 80.3 },
      { merchant: "Tienda 24 h", count: 8, total: 52.18, averageTicket: 6.52, monthlyProjection: 52.18 },
    ],
  };

  const approval = (card: Omit<ApprovalCard, "kind" | "status" | "resultMessage" | "createdAt">): ApprovalCard => ({
    kind: "approval",
    status: "PENDING",
    resultMessage: null,
    createdAt: created,
    ...card,
  });

  const purchase = approval({
    actionId: "demo-purchase",
    type: "PURCHASE",
    title: "Audífonos inalámbricos Aura X2",
    summary: "Bajó 24% frente a lo normal ($327).",
    merchant: "SonidoMax",
    amount: 247,
    amountPeriod: null,
    currency: "USD",
    lines: [
      { label: "Precio", value: "$247.00" },
      { label: "Envío", value: "Gratis" },
    ],
  });

  const cancelCine = approval({
    actionId: "demo-cancel-cine",
    type: "CANCEL_SUBSCRIPTION",
    title: "CineClub+",
    summary: "Sin uso en 104 días.",
    merchant: "CineClub+",
    amount: 8.99,
    amountPeriod: "al mes",
    currency: "USD",
    lines: [{ label: "Próximo cobro", value: shortDate(at(17), DEMO_TIME_ZONE) }],
  });

  const cancelNews = approval({
    actionId: "demo-cancel-news",
    type: "CANCEL_SUBSCRIPTION",
    title: "Noticias Premium",
    summary: "Sin uso en 126 días.",
    merchant: "Noticias Premium",
    amount: 12,
    amountPeriod: "al mes",
    currency: "USD",
    lines: [{ label: "Próximo cobro", value: shortDate(at(26), DEMO_TIME_ZONE) }],
  });

  const calendar = approval({
    actionId: "demo-calendar",
    type: "CREATE_CALENDAR_EVENT",
    title: "Excursión al acuario",
    summary: null,
    merchant: null,
    amount: null,
    amountPeriod: null,
    currency: null,
    lines: [
      { label: "Cuándo", value: dateTime(at(4, 12, 15), DEMO_TIME_ZONE) },
      { label: "Dónde", value: "Acuario Municipal" },
    ],
  });

  const email = approval({
    actionId: "demo-email",
    type: "SEND_EMAIL",
    title: "Confirmo que puedo acompañar la excursión",
    summary: null,
    merchant: null,
    amount: null,
    amountPeriod: null,
    currency: null,
    lines: [
      { label: "Para", value: "maestra.rivera@escuela.edu" },
      { label: "Mensaje", value: "Hola, maestra Rivera: puedo acompañar al grupo en la excursión. Llego a las 8:00." },
    ],
  });

  const tracking: TrackingCard = {
    kind: "tracking",
    itemId: "demo-track-1",
    title: "Audífonos inalámbricos Aura X2",
    merchant: "SonidoMax",
    url: null,
    currency: "USD",
    currentPrice: 329,
    targetPrice: 260,
    lowestPrice: 299,
    dropAlertPct: 15,
  };

  const trackingList: TrackingCard[] = [
    { ...tracking, currentPrice: 247, lowestPrice: 247 },
    {
      kind: "tracking",
      itemId: "demo-track-2",
      title: "Vuelo Miami a Bogotá en diciembre",
      merchant: "Varias aerolíneas",
      url: null,
      currency: "USD",
      currentPrice: 312,
      targetPrice: 280,
      lowestPrice: 298,
      dropAlertPct: 10,
    },
    {
      kind: "tracking",
      itemId: "demo-track-3",
      title: "Entradas para Estéreo Sur",
      merchant: "BoletoYa",
      url: null,
      currency: "USD",
      currentPrice: 95,
      targetPrice: 80,
      lowestPrice: 95,
      dropAlertPct: 15,
    },
  ];

  const task: TaskCard = {
    kind: "task",
    taskId: "demo-task",
    title: "Permiso de la excursión al acuario",
    type: "FORM_FILL",
    notes: "Firmarlo y entregarlo en la escuela. Te aviso la noche anterior.",
    dueAt: at(3, 21),
    remindAt: null,
  };

  const goals: GoalCard[] = [
    {
      kind: "goal",
      goalId: "demo-goal-1",
      title: "Fondo para el carro",
      description: "Enganche para un carro usado.",
      category: "SAVINGS",
      currency: "USD",
      targetAmount: 5000,
      currentAmount: 1850,
      monthlyContribution: 210,
      targetDate: monthsAhead(15),
    },
    {
      kind: "goal",
      goalId: "demo-goal-2",
      title: "Viaje a Cartagena",
      description: "Una semana en familia.",
      category: "TRAVEL",
      currency: "USD",
      targetAmount: 2400,
      currentAmount: 900,
      monthlyContribution: 250,
      targetDate: monthsAhead(6),
    },
    {
      kind: "goal",
      goalId: "demo-goal-3",
      title: "Correr 10 km",
      description: "Tres salidas por semana, con recordatorios.",
      category: "HEALTH",
      currency: "USD",
      targetAmount: null,
      currentAmount: 0,
      monthlyContribution: null,
      targetDate: null,
    },
  ];

  const idea = (data: Omit<IdeaView, "starter" | "currency" | "estimatedMonthlySavings"> & Partial<IdeaView>): IdeaView => ({
    starter: false,
    currency: "USD",
    estimatedMonthlySavings: null,
    ...data,
  });

  const ideas: IdeaView[] = [
    idea({
      id: "demo-idea-1",
      module: "FINANCE",
      title: "Puedo darte de baja de 3 suscripciones",
      body: "Noticias Premium, CineClub+ y NubeFotos 200 GB llevan más de 60 días sin uso.",
      prompt: "¿Qué suscripciones estoy pagando y no uso? Propón cancelar las que no uso.",
      estimatedMonthlySavings: 23.98,
    }),
    idea({
      id: "demo-idea-2",
      module: "PROCEDURES",
      title: `El permiso de la excursión vence el ${shortDate(at(3, 21), DEMO_TIME_ZONE)}`,
      body: "Te recuerdo la noche anterior y agendo la salida en tu calendario.",
      prompt: "Ayúdame con el trámite “Permiso de la excursión al acuario”.",
    }),
    idea({
      id: "demo-idea-3",
      module: "CONCIERGE",
      title: "Los audífonos Aura X2 bajaron 24%",
      body: "Ahora cuestan $247 en SonidoMax, por debajo de tu objetivo de $260. ¿Preparo la compra?",
      prompt: "Prepara la compra de “Audífonos inalámbricos Aura X2” si sigue en $260 o menos.",
    }),
    idea({
      id: "demo-idea-4",
      module: "FINANCE",
      title: "Restaurantes subió 38% este mes",
      body: "Gastaste más que tu promedio en restaurantes. Te muestro de dónde viene y cómo bajarlo.",
      prompt: "¿Por qué subió mi gasto en Restaurantes y cómo lo bajo?",
    }),
    idea({
      id: "demo-idea-5",
      module: "GOALS",
      title: "Aparta $210 para “Fondo para el carro”",
      body: "Con ese aporte este mes sigues a tiempo para tu meta.",
      prompt: "¿Cómo voy con mi meta “Fondo para el carro”? Ayúdame a apartar lo de este mes.",
    }),
  ];

  const message = (id: string, role: "user" | "assistant", text: string, cards: ChatMessageView["cards"] = []) => ({
    id,
    role,
    text,
    cards,
    createdAt: created,
  });

  const conversation: ChatMessageView[] = [
    message("m1", "user", "¿A dónde se fue mi dinero los últimos 3 meses?"),
    message(
      "m2",
      "assistant",
      "Gastas en promedio $4,212 al mes y te quedan $638. Lo que más creció fue **Restaurantes (+38%)**. Además tienes 3 suscripciones sin uso que suman $23.98 al mes.",
      [financeSummary],
    ),
    message("m3", "user", "Cancela las que no uso"),
    message(
      "m4",
      "assistant",
      "Preparé las bajas. Si las apruebas, dejas de pagarlas desde el próximo cobro; si alguna vuelve a cobrarse, te aviso.",
      [cancelCine, cancelNews],
    ),
  ];

  // ── Finanzas: cuentas del sandbox, informe de Omni, presupuestos y movimientos ──
  const account = (
    id: string,
    connectionId: string,
    institutionName: string,
    name: string,
    type: AccountView["type"],
    subtype: string,
    mask: string,
    currentBalance: number,
    creditLimit: number | null = null,
  ): AccountView => ({
    id,
    connectionId,
    institutionName,
    name,
    type,
    subtype,
    mask,
    currency: "USD",
    currentBalance,
    creditLimit,
    isSimulated: true,
  });

  const nomina = account("demo-acc-nomina", "demo-conn-ceiba", "Banco Ceiba", "Cuenta nómina", "CHECKING", "Cuenta corriente", "3689", 3264.57);
  const ahorros = account("demo-acc-ahorros", "demo-conn-ceiba", "Banco Ceiba", "Ahorros", "SAVINGS", "Cuenta de ahorro", "5120", 2140);
  const oro = account("demo-acc-oro", "demo-conn-aurora", "Tarjeta Aurora", "Aurora Oro", "CREDIT_CARD", "Tarjeta de crédito", "4417", 1286.4, 5000);
  const accounts: AccountView[] = [nomina, ahorros, oro];

  const bankConnections: BankConnectionView[] = [
    { id: "demo-conn-ceiba", institutionName: "Banco Ceiba", provider: "sandbox", status: "ACTIVE", lastSyncedAt: created, accounts: [nomina, ahorros] },
    { id: "demo-conn-aurora", institutionName: "Tarjeta Aurora", provider: "sandbox", status: "ACTIVE", lastSyncedAt: created, accounts: [oro] },
  ];

  const label = (a: AccountView) => `${a.name} ••${a.mask}`;
  const tx = (
    id: string,
    daysAgo: number,
    merchantName: string,
    amount: number,
    category: string,
    from: AccountView,
    direction: "DEBIT" | "CREDIT" = "DEBIT",
    pending = false,
  ): TransactionView => ({
    id,
    postedAt: at(-daysAgo, 15),
    amount,
    direction,
    currency: "USD",
    merchantName,
    description: merchantName.toUpperCase(),
    category,
    pending,
    accountLabel: label(from),
  });

  const transactions: TransactionView[] = [
    tx("t1", 0, "Café Grano de Oro", 4.75, "Café y antojos", nomina, "DEBIT", true),
    tx("t2", 1, "EntregaYa", 27.4, "Delivery", oro),
    tx("t3", 1, "Supermercado La Canasta", 132.18, "Supermercado", nomina),
    tx("t4", 2, "StreamFlix", 15.99, "Suscripciones", oro),
    tx("t5", 3, "Sushi Nami", 58.9, "Restaurantes", oro),
    tx("t6", 3, "Gasolinera Ruta 9", 46.2, "Transporte", nomina),
    tx("t7", 4, "Tienda 24 h", 6.35, "Café y antojos", oro),
    tx("t8", 5, "Pago Tarjeta Aurora", 1245.3, "Transferencias", nomina),
    tx("t9", 5, "Pago recibido, gracias", 1245.3, "Transferencias", oro, "CREDIT"),
    tx("t10", 6, "ViajeYa", 14.8, "Transporte", oro),
    tx("t11", 7, "Café Grano de Oro", 5.1, "Café y antojos", nomina),
    tx("t12", 9, "Farmacia Salud+", 23.45, "Salud", nomina),
    tx("t13", 10, "Cargo por pago tardío", 25, "Comisiones e intereses", oro),
    tx("t14", 12, "Nómina Empresa Andina", 2425, "Ingresos", nomina, "CREDIT"),
  ];
  const sumBy = (direction: "DEBIT" | "CREDIT") =>
    Math.round(transactions.filter((t) => t.direction === direction).reduce((s, t) => s + t.amount, 0) * 100) / 100;
  const transactionsPage: TransactionsPageView = {
    items: transactions,
    nextOffset: null,
    totalSpent: sumBy("DEBIT"),
    totalIncome: sumBy("CREDIT"),
    count: transactions.length,
  };
  const categories = [
    "Café y antojos",
    "Comisiones e intereses",
    "Compras",
    "Delivery",
    "Ingresos",
    "Restaurantes",
    "Salud",
    "Servicios",
    "Supermercado",
    "Suscripciones",
    "Transferencias",
    "Transporte",
    "Vivienda",
  ];

  // Tres periodos de 30 días, como getMonthlyTrend.
  const windowLabel = (index: number) => {
    const to = new Date(now.getTime() - (2 - index) * 30 * DAY);
    const from = new Date(to.getTime() - 29 * DAY);
    return `${shortDate(from, DEMO_TIME_ZONE)} al ${shortDate(to, DEMO_TIME_ZONE)}`;
  };
  const trend: MonthlyTrendCard = {
    kind: "monthly_trend",
    currency: "USD",
    months: [
      { label: windowLabel(0), income: 4850, spending: 4020, net: 830 },
      { label: windowLabel(1), income: 4850, spending: 4180, net: 670 },
      { label: windowLabel(2), income: 4850, spending: 4436, net: 414 },
    ],
  };

  const budgets: BudgetView[] = [
    { id: "demo-bud-1", category: "Supermercado", currency: "USD", monthlyLimit: 750, spent: 512.4, pct: 68, state: "ok" },
    { id: "demo-bud-2", category: "Transporte", currency: "USD", monthlyLimit: 280, spent: 247.1, pct: 88, state: "alerta" },
    { id: "demo-bud-3", category: "Compras", currency: "USD", monthlyLimit: 200, spent: 236.5, pct: 118, state: "excedido" },
  ];

  const rec = (
    id: string,
    kind: RecommendationView["kind"],
    difficulty: RecommendationView["difficulty"],
    title: string,
    detail: string,
    estimatedMonthlySavings: number,
    targetLabel: string | null,
  ): RecommendationView => ({
    id,
    kind,
    status: "NEW",
    difficulty,
    title,
    detail,
    estimatedMonthlySavings,
    targetLabel,
    resultMessage: null,
  });

  const insights: InsightsCard = {
    kind: "insights",
    analysisId: "demo-analysis",
    source: "AI",
    health: "estable",
    headline: "Puedes liberar unos $214 al mes sin tocar lo esencial",
    summary:
      "Tus ingresos son estables y cubres tus gastos fijos sin problema. El margen se va en restaurantes, compras pequeñas y cargos de la tarjeta que se pueden evitar.",
    keyPoints: [
      "Te quedan $638 al mes (13% de lo que ganas); lo recomendable es apartar al menos 15%.",
      "Restaurantes subió 38% el último mes: $386 contra $280 de promedio.",
      "Pagaste $94 en intereses y comisiones de la Tarjeta Aurora en 3 meses.",
      "3 suscripciones llevan más de 90 días sin uso: $23.98 al mes.",
    ],
    currency: "USD",
    totalMonthlySavings: 214.29,
    periodLabel: `${shortDate(new Date(now.getTime() - 90 * DAY), DEMO_TIME_ZONE)} al ${shortDate(now, DEMO_TIME_ZONE)}`,
    createdAt: created,
    recommendations: [
      rec(
        "demo-rec-1",
        "CATEGORY_BUDGET",
        "MEDIUM",
        "Presupuesto de $280 al mes en restaurantes",
        "El último mes gastaste $386, 38% más que tu promedio. Volver a tu nivel anterior libera $106.",
        106,
        "Restaurantes",
      ),
      rec(
        "demo-rec-2",
        "REDUCE_ANT_EXPENSES",
        "MEDIUM",
        "Tope de $19 a la semana para antojos",
        "Café Grano de Oro y Tienda 24 h suman $132 al mes en compras de menos de $15. Con ese tope ahorras cerca de $53.",
        52.99,
        "Café y antojos",
      ),
      rec(
        "demo-rec-3",
        "AVOID_FEES",
        "EASY",
        "Deja de pagar intereses y comisiones",
        "Intereses, un cargo por pago tardío y la comisión de manejo te costaron $94 en 3 meses. Con débito automático del pago total desaparecen casi todos.",
        31.32,
        "Intereses de la tarjeta",
      ),
      rec("demo-rec-4", "CANCEL_SUBSCRIPTION", "EASY", "Cancela Noticias Premium", "No la abres hace 126 días y te cuesta $12.00 al mes.", 12, "Noticias Premium"),
      rec("demo-rec-5", "CANCEL_SUBSCRIPTION", "EASY", "Cancela CineClub+", "No la usas hace 104 días. Ya tienes StreamFlix para ver películas.", 8.99, "CineClub+"),
      rec("demo-rec-6", "CANCEL_SUBSCRIPTION", "EASY", "Cancela NubeFotos 200 GB", "No subes fotos hace 97 días y te cuesta $2.99 al mes.", 2.99, "NubeFotos 200 GB"),
    ],
  };

  const deliveryCard: TransactionsCard = {
    kind: "transactions",
    title: "Delivery, últimos 30 días",
    currency: "USD",
    count: 11,
    totalSpent: 322.4,
    totalIncome: 0,
    items: [
      tx("d1", 1, "EntregaYa", 27.4, "Delivery", oro),
      tx("d2", 4, "EntregaYa", 31.8, "Delivery", oro),
      tx("d3", 6, "EntregaYa", 24.9, "Delivery", oro),
      tx("d4", 9, "EntregaYa", 35.2, "Delivery", oro),
      tx("d5", 11, "EntregaYa", 29.6, "Delivery", oro),
    ],
  };

  const history: ApprovalCard[] = [
    {
      ...approval({
        actionId: "demo-history-1",
        type: "CANCEL_SUBSCRIPTION",
        title: "NubeFotos 200 GB",
        summary: null,
        merchant: "NubeFotos 200 GB",
        amount: 2.99,
        amountPeriod: "al mes",
        currency: "USD",
        lines: [],
      }),
      status: "EXECUTED",
      createdAt: at(-2),
    },
    {
      ...approval({
        actionId: "demo-history-2",
        type: "PURCHASE",
        title: "Silla ergonómica Flex",
        summary: null,
        merchant: "CasaOficina",
        amount: 189,
        amountPeriod: null,
        currency: "USD",
        lines: [],
      }),
      status: "REJECTED",
      createdAt: at(-6),
    },
  ];

  const connections: { connected: ConnectorView[]; available: ConnectorView[] } = {
    connected: [
      ...bankConnections.map((bank) => ({
        id: bank.id,
        name: bank.institutionName,
        description: "Conexión bancaria de solo lectura.",
        icon: bank.accounts.every((a) => a.type === "CREDIT_CARD") ? ("card" as const) : ("bank" as const),
        status: "connected" as const,
        detail: bank.accounts.map(label).join(", "),
        action: null,
        manageHref: "/finanzas",
        sandbox: true,
      })),
      {
        id: "demo-mailbox",
        name: "Correo de prueba (estilo Gmail)",
        description: "Correo y calendario de prueba.",
        icon: "mail" as const,
        status: "connected" as const,
        detail: "laura.demo@correo-demo.test · 9 correos",
        action: null,
        manageHref: "/tramites",
        sandbox: true,
      },
    ],
    available: CONNECTOR_CATALOG.filter((c) => c.id !== "mail_demo").map((c) => ({
      ...c,
      status: c.action ? ("available" as const) : ("soon" as const),
      detail: null,
    })),
  };

  // Conversación del asistente financiero: el informe sembrado y una pregunta de seguimiento.
  const analysisConversation: ChatMessageView[] = [
    message("a1", "user", "Analiza mis finanzas de los últimos 3 meses."),
    {
      ...message(
        "a2",
        "assistant",
        "Revisé tus 3 cuentas de los últimos 3 meses. Te quedan $638 al mes, pero hay **$214 al mes** que se van en cosas que puedes recortar sin tocar lo esencial: restaurantes, antojos pequeños, intereses de la tarjeta y 3 suscripciones que no usas. Con un toque aplico cada recomendación; las bajas quedan listas para que las apruebes.",
        [insights],
      ),
      suggestions: [
        "¿Por qué subió mi gasto en restaurantes?",
        "¿Cuánto gasté en delivery el último mes?",
        "¿Cómo evito los intereses de la tarjeta?",
      ],
    },
    message("a3", "user", "¿Cuánto gasté en delivery el último mes?"),
    {
      ...message(
        "a4",
        "assistant",
        "En los últimos 30 días pediste 11 veces a EntregaYa: **$322.40**, unos $29 por pedido. Si cambias 2 pedidos a la semana por comida en casa, ahorras cerca de $110 al mes.",
        [deliveryCard],
      ),
      suggestions: ["Ponme un presupuesto de $200 para delivery", "¿Qué más puedo recortar?"],
    },
  ];

  return {
    user: { name: "Laura Gómez", email: "laura@ejemplo.com" },
    status: "Vigilando 3 precios y 1 trámite",
    financeSummary,
    subscriptions,
    ant,
    purchase,
    cancelCine,
    cancelNews,
    calendar,
    email,
    tracking,
    trackingList,
    task,
    goals,
    ideas,
    conversation,
    analysisConversation,
    accounts,
    bankConnections,
    transactions,
    transactionsPage,
    categories,
    trend,
    budgets,
    insights,
    history,
    connections,
    recent: [
      { id: "demo-c1", title: "¿A dónde se fue mi dinero los últimos 3 meses?" },
      { id: "demo-c2", title: "Permiso de la excursión" },
      { id: "demo-c3", title: "Audífonos Aura X2" },
    ],
    message,
  };
}

export type DemoData = ReturnType<typeof demoData>;
