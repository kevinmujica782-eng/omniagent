import "server-only";
import { sandboxMailProvider } from "./sandbox";
import type { MailProvider, MailProviderName } from "./types";

// Conectores de correo y calendario disponibles. Gmail (Google APIs) y Outlook (Microsoft Graph)
// se agregan aquí implementando MailProvider; hasta entonces aparecen como "Pronto" en Conexiones.
const PROVIDERS: Record<MailProviderName, MailProvider> = {
  sandbox: sandboxMailProvider,
};

export function getMailProvider(name: MailProviderName = "sandbox"): MailProvider {
  return PROVIDERS[name] ?? sandboxMailProvider;
}
