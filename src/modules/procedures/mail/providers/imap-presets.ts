// Proveedores de correo que se conectan con IMAP (leer) y SMTP (enviar) usando una contraseña de aplicación.
// Sin "server-only": el diálogo de conexión usa esta lista para guiar a la persona. Microsoft (Outlook, Hotmail,
// Live) ya no acepta contraseñas en IMAP desde el 16 de septiembre de 2024: solo su inicio de sesión (OAuth).

export type MailServiceId = "gmail" | "yahoo" | "icloud" | "aol" | "zoho" | "custom";

export interface MailServer {
  host: string;
  port: number;
}

export interface MailServicePreset {
  id: Exclude<MailServiceId, "custom">;
  name: string;
  imap: MailServer;
  smtp: MailServer;
  /** Dónde se crea la contraseña de aplicación. */
  appPasswordUrl: string;
  /** Cómo crearla, en una o dos frases. */
  help: string;
}

export const MAIL_SERVICES: MailServicePreset[] = [
  {
    id: "gmail",
    name: "Gmail",
    imap: { host: "imap.gmail.com", port: 993 },
    smtp: { host: "smtp.gmail.com", port: 465 },
    appPasswordUrl: "https://myaccount.google.com/apppasswords",
    help: "Activa la verificación en dos pasos de tu cuenta de Google y crea una contraseña de aplicación: son 16 letras.",
  },
  {
    id: "yahoo",
    name: "Yahoo",
    imap: { host: "imap.mail.yahoo.com", port: 993 },
    smtp: { host: "smtp.mail.yahoo.com", port: 465 },
    appPasswordUrl: "https://login.yahoo.com/account/security",
    help: "En Seguridad de la cuenta, toca «Generar contraseña de aplicación» y cópiala aquí.",
  },
  {
    id: "icloud",
    name: "iCloud",
    imap: { host: "imap.mail.me.com", port: 993 },
    smtp: { host: "smtp.mail.me.com", port: 587 },
    appPasswordUrl: "https://account.apple.com",
    help: "En tu cuenta de Apple, entra a «Inicio de sesión y seguridad» → «Contraseñas específicas de app» y crea una.",
  },
  {
    id: "aol",
    name: "AOL",
    imap: { host: "imap.aol.com", port: 993 },
    smtp: { host: "smtp.aol.com", port: 465 },
    appPasswordUrl: "https://login.aol.com/account/security",
    help: "En Seguridad de la cuenta, toca «Generar contraseña de aplicación» y cópiala aquí.",
  },
  {
    id: "zoho",
    name: "Zoho Mail",
    imap: { host: "imap.zoho.com", port: 993 },
    smtp: { host: "smtp.zoho.com", port: 465 },
    appPasswordUrl: "https://accounts.zoho.com/home#security/app_password",
    help: "En Seguridad → Contraseñas específicas de aplicación, genera una nueva. Activa IMAP en la configuración de Zoho Mail.",
  },
];

const DOMAIN_SERVICE: [RegExp, Exclude<MailServiceId, "custom">][] = [
  [/^(gmail|googlemail)\.com$/, "gmail"],
  [/^(yahoo\.[a-z.]+|ymail\.com|rocketmail\.com)$/, "yahoo"],
  [/^(icloud|me|mac)\.com$/, "icloud"],
  [/^(aol\.[a-z.]+|aim\.com)$/, "aol"],
  [/^(zoho|zohomail)\.[a-z.]+$/, "zoho"],
];

const MICROSOFT_DOMAIN = /^(outlook|hotmail|live|msn|passport)\.[a-z.]+$/;

export const EMAIL_PATTERN = /^[^\s@]{1,64}@[a-z0-9-]+(\.[a-z0-9-]+)+$/i;

export function domainOf(email: string): string {
  return email.trim().toLowerCase().split("@")[1] ?? "";
}

/** Proveedor según el dominio del correo: el de la lista, «microsoft» (no se puede con contraseña) o null. */
export function detectMailService(email: string): Exclude<MailServiceId, "custom"> | "microsoft" | null {
  const domain = domainOf(email);
  if (!domain) return null;
  if (MICROSOFT_DOMAIN.test(domain)) return "microsoft";
  return DOMAIN_SERVICE.find(([pattern]) => pattern.test(domain))?.[1] ?? null;
}

export function mailService(id: MailServiceId): MailServicePreset | null {
  return MAIL_SERVICES.find((service) => service.id === id) ?? null;
}

/**
 * Las contraseñas de aplicación se muestran en grupos («abcd efgh ijkl mnop»): se quitan los espacios. En un
 * servidor propio la contraseña va tal cual (puede tener espacios a propósito).
 */
export function normalizeAppPassword(service: MailServiceId, password: string): string {
  return service === "custom" ? password : password.replace(/\s+/g, "");
}

export const MICROSOFT_NOTICE =
  "Outlook, Hotmail y Live ya no permiten conectar el correo con contraseña: Microsoft exige su propio inicio de sesión. " +
  "Mientras lo agregamos, reenvía esos correos a una cuenta de Gmail, Yahoo o iCloud y conecta esa.";
