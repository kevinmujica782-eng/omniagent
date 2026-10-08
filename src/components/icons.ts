import {
  BedDouble,
  Briefcase,
  Coffee,
  CalendarDays,
  Clock,
  CreditCard,
  FileText,
  Flag,
  Globe,
  HandCoins,
  HeartPulse,
  House,
  Inbox,
  Landmark,
  Mail,
  PackagePlus,
  PackageX,
  PhoneCall,
  PiggyBank,
  Plane,
  Receipt,
  Repeat,
  ShoppingBag,
  Sparkles,
  Stethoscope,
  Tag,
  Target,
  Ticket,
  Timer,
  TrendingDown,
  Truck,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import type { ConnectorIcon } from "@/modules/connections/catalog";
import type { InstitutionKind } from "@/modules/finance/providers/sandbox-catalog";
import type { ActionKind, AgendaItemView, MailCategoryKind, ModuleKind, RecommendationKindId, WatchKindId } from "@/types/cards";

// Iconografía: línea fina de Lucide dentro de mosaicos suaves (sin logos de marcas ni ilustraciones 3D).

export const MODULE_ICON: Record<ModuleKind, LucideIcon> = {
  GENERAL: Sparkles,
  FINANCE: PiggyBank,
  PROCEDURES: FileText,
  CONCIERGE: Tag,
  GOALS: Target,
};

export const GOAL_ICON: Record<string, LucideIcon> = {
  SAVINGS: PiggyBank,
  HEALTH: HeartPulse,
  FAMILY: Users,
  HOME: House,
  TRAVEL: Plane,
  CAREER: Briefcase,
  OTHER: Target,
};

export const CONNECTOR_ICON: Record<ConnectorIcon, LucideIcon> = {
  bank: Landmark,
  card: CreditCard,
  wallet: Wallet,
  mail: Mail,
  calendar: CalendarDays,
  shopping: ShoppingBag,
  inbox: Inbox,
};

export const ACTION_ICON: Record<ActionKind, LucideIcon> = {
  PURCHASE: ShoppingBag,
  CANCEL_SUBSCRIPTION: Repeat,
  SEND_EMAIL: Mail,
  CREATE_CALENDAR_EVENT: CalendarDays,
  SUBMIT_FORM: FileText,
  PUBLISH_SITE: Globe,
};

export const TASK_ICON: Record<string, LucideIcon> = {
  FORM_FILL: FileText,
  EMAIL: Mail,
  APPOINTMENT: CalendarDays,
  REMINDER: Clock,
  DOCUMENT: FileText,
  OTHER: FileText,
};

/** Íconos de las sugerencias del chat vacío, en el mismo orden que CHAT_STARTERS. */
export const STARTER_ICONS: LucideIcon[] = [Wallet, Repeat, FileText, Tag];

export const RECOMMENDATION_ICON: Record<RecommendationKindId, LucideIcon> = {
  CANCEL_SUBSCRIPTION: Repeat,
  REDUCE_ANT_EXPENSES: Coffee,
  CATEGORY_BUDGET: Wallet,
  AVOID_FEES: Receipt,
  NEGOTIATE_BILL: PhoneCall,
  SAVINGS_GOAL: PiggyBank,
  OTHER: Sparkles,
};

export const INSTITUTION_ICON: Record<InstitutionKind, LucideIcon> = {
  bank: Landmark,
  card: CreditCard,
  wallet: Wallet,
  coop: PiggyBank,
};

export const ACCOUNT_ICON: Record<string, LucideIcon> = {
  CHECKING: Landmark,
  SAVINGS: PiggyBank,
  CREDIT_CARD: CreditCard,
  WALLET: Wallet,
  OTHER: Landmark,
};

/** Íconos de las sugerencias del asistente financiero (mismo orden que FINANCE_STARTERS). */
export const FINANCE_STARTER_ICONS: LucideIcon[] = [Sparkles, Wallet, ShoppingBag, PiggyBank];

/** Íconos de las sugerencias del asistente de trámites (mismo orden que PROCEDURES_STARTERS). */
export const PROCEDURES_STARTER_ICONS: LucideIcon[] = [Inbox, FileText, CalendarDays, Clock];

/** Categoría del correo que originó el trámite. */
export const MAIL_CATEGORY_ICON: Record<MailCategoryKind, LucideIcon> = {
  FORM: FileText,
  APPOINTMENT: Stethoscope,
  REIMBURSEMENT: HandCoins,
  BILL: Receipt,
  DEADLINE: Clock,
  EVENT: Users,
  INFO: Inbox,
  PROMO: Tag,
};

export const MAIL_CATEGORY_LABEL: Record<MailCategoryKind, string> = {
  FORM: "Formulario",
  APPOINTMENT: "Cita",
  REIMBURSEMENT: "Reembolso",
  BILL: "Factura",
  DEADLINE: "Fecha límite",
  EVENT: "Evento",
  INFO: "Aviso",
  PROMO: "Publicidad",
};

/** Qué se vigila: producto, boletos, vuelo u hotel. */
export const WATCH_KIND_ICON: Record<WatchKindId, LucideIcon> = {
  PRODUCT: ShoppingBag,
  EVENT_TICKET: Ticket,
  FLIGHT: Plane,
  HOTEL: BedDouble,
  OTHER: Tag,
};

/** Íconos de las sugerencias del concierge de compras (mismo orden que CONCIERGE_STARTERS). */
export const CONCIERGE_STARTER_ICONS: LucideIcon[] = [ShoppingBag, Ticket, Plane, TrendingDown];

/** Íconos de las sugerencias de pedidos y devoluciones (mismo orden que RETURNS_STARTERS). */
export const RETURNS_STARTER_ICONS: LucideIcon[] = [Truck, Clock, PackageX, PackagePlus];

/** Tipos de elementos de la agenda. */
export const AGENDA_ICON: Record<AgendaItemView["kind"], LucideIcon> = {
  EVENT: CalendarDays,
  DEADLINE: Flag,
  FOCUS: Timer,
  DUE: Flag,
  BUSY: Clock,
};
