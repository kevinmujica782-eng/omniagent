// Sin "server-only": la página de conexiones y la vista previa usan estos tipos.
export type ConnectorIcon = "bank" | "card" | "wallet" | "mail" | "calendar" | "shopping" | "inbox";

export interface ConnectorView {
  id: string;
  name: string;
  description: string;
  icon: ConnectorIcon;
  status: "connected" | "available" | "soon";
  /** Detalle de la conexión activa, p. ej. "Cuenta nómina ••3689, Ahorros ••5120". */
  detail: string | null;
  /** Acción disponible desde la app. */
  action: "link_bank" | "link_mail" | "calendar_feed" | "concierge" | null;
  /** Dónde se administra una conexión activa (/finanzas, /tramites). */
  manageHref?: string;
  /** Datos simulados (bancos y bandeja de prueba). */
  sandbox?: boolean;
}

export const CONNECTOR_CATALOG: Omit<ConnectorView, "status" | "detail">[] = [
  {
    id: "bank_link",
    name: "Bancos y tarjetas",
    description: "Cuentas, ahorros y tarjetas de crédito con un conector tipo Plaid. Solo lectura.",
    icon: "bank",
    action: "link_bank",
  },
  {
    id: "mail_real",
    name: "Tu correo",
    description: "Gmail, Yahoo, iCloud, AOL, Zoho o tu propio servidor. Omni lee tu bandeja para detectar trámites y envía solo lo que apruebes.",
    icon: "mail",
    action: "link_mail",
  },
  {
    id: "mail_demo",
    name: "Correo de prueba",
    description: "Bandeja ficticia estilo Gmail u Outlook con permisos, citas y facturas para probar Trámites.",
    icon: "mail",
    action: "link_mail",
    sandbox: true,
  },
  {
    id: "calendar_feed",
    name: "Calendario del teléfono",
    description: "Suscribe Google Calendar, Apple Calendar u Outlook a tus trámites con un enlace privado.",
    icon: "calendar",
    action: "calendar_feed",
  },
  {
    id: "gmail",
    name: "Google Calendar",
    description: "Tus citas de Google Calendar dentro de Omni (inicio de sesión con Google). Mientras, usa el calendario del teléfono.",
    icon: "calendar",
    action: null,
  },
  {
    id: "outlook",
    name: "Outlook y Hotmail",
    description: "Microsoft exige su propio inicio de sesión para el correo. Mientras, reenvía tus correos a Gmail, Yahoo o iCloud.",
    icon: "inbox",
    action: null,
  },
  {
    id: "stores",
    name: "Tiendas, boletos y viajes",
    description: "Pega el enlace de un producto, unos boletos o un vuelo y Omni vigila su precio. Incluye tiendas de prueba.",
    icon: "shopping",
    action: "concierge",
  },
  {
    id: "payments",
    name: "Medio de pago real",
    description: "Tarjeta guardada en un proveedor de pagos (por ejemplo, Stripe) para compras reales. Hoy los pagos son simulados.",
    icon: "card",
    action: null,
  },
];
