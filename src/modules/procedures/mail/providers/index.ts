import "server-only";
import { imapMailProvider } from "./imap";
import { sandboxMailProvider } from "./sandbox";
import type { MailProvider, MailProviderName } from "./types";

// Conectores de correo y calendario disponibles: la bandeja de prueba y el correo real por IMAP/SMTP.
// Gmail (Google APIs) y Outlook (Microsoft Graph) con OAuth se agregan aquí implementando MailProvider.
const PROVIDERS: Record<MailProviderName, MailProvider> = {
  sandbox: sandboxMailProvider,
  imap: imapMailProvider,
};

export function getMailProvider(name: MailProviderName = "sandbox"): MailProvider {
  return PROVIDERS[name] ?? sandboxMailProvider;
}
