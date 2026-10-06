import "server-only";
import { prisma } from "@/lib/db";
import { listBankConnections } from "@/modules/finance/sync.service";
import { listMailboxes } from "@/modules/procedures/mail/mail.service";
import { CONNECTOR_CATALOG, type ConnectorIcon, type ConnectorView } from "./catalog";

/** Conexiones del usuario agrupadas como en la pantalla de Conexiones. */
export async function listConnectorViews(userId: string): Promise<{ connected: ConnectorView[]; available: ConnectorView[] }> {
  const [banks, mailboxes, feed, others] = await Promise.all([
    listBankConnections(userId),
    listMailboxes(userId),
    prisma.calendarFeed.findUnique({ where: { userId }, select: { lastAccessedAt: true } }),
    prisma.integrationConnection.findMany({
      where: { userId, status: "ACTIVE", provider: { in: ["GOOGLE", "MICROSOFT"] } },
      select: { provider: true },
    }),
  ]);
  const active = new Set(others.map((c) => c.provider));

  const connected: ConnectorView[] = banks.map((bank) => {
    const types = new Set(bank.accounts.map((a) => a.type));
    const icon: ConnectorIcon = types.size === 1 && types.has("CREDIT_CARD") ? "card" : types.size === 1 && types.has("WALLET") ? "wallet" : "bank";
    return {
      id: bank.id,
      name: bank.institutionName,
      description: "Conexión bancaria de solo lectura.",
      icon,
      status: "connected",
      detail: bank.accounts.map((a) => `${a.name}${a.mask ? ` ••${a.mask}` : ""}`).join(", ") || null,
      action: null,
      manageHref: "/finanzas",
      sandbox: bank.provider === "sandbox",
    };
  });
  for (const mailbox of mailboxes) {
    const real = mailbox.provider === "imap";
    connected.push({
      id: mailbox.id,
      name: real ? `${mailbox.displayName} · tu correo` : mailbox.displayName,
      description: real ? "Correo real: lectura de la bandeja y envíos aprobados." : "Correo y calendario de prueba.",
      icon: mailbox.flavor === "outlook" ? "inbox" : "mail",
      status: "connected",
      detail: mailbox.status === "ACTIVE" ? `${mailbox.address} · ${mailbox.messageCount} correos` : `${mailbox.address} · vuelve a conectarlo`,
      action: null,
      manageHref: "/tramites",
      sandbox: !real,
    });
  }
  const hasDemoMail = mailboxes.some((m) => m.provider === "sandbox");
  const hasRealMail = mailboxes.some((m) => m.provider === "imap");
  if (feed) {
    connected.push({
      id: "calendar_feed",
      name: "Calendario del teléfono",
      description: "Enlace de suscripción a tus trámites.",
      icon: "calendar",
      status: "connected",
      detail: feed.lastAccessedAt ? "Enlace activo · tu calendario ya lo leyó" : "Enlace creado · aún no se ha leído",
      action: null,
      manageHref: "/tramites#calendario",
    });
  }

  const available: ConnectorView[] = [];
  for (const entry of CONNECTOR_CATALOG) {
    if (entry.id === "mail_demo" && (hasDemoMail || hasRealMail)) continue;
    if (entry.id === "mail_real" && hasRealMail) continue;
    if (entry.id === "calendar_feed" && feed) continue;
    if (entry.id === "gmail" && active.has("GOOGLE")) {
      connected.push({ ...entry, status: "connected", detail: null });
    } else if (entry.id === "outlook" && active.has("MICROSOFT")) {
      connected.push({ ...entry, status: "connected", detail: null });
    } else {
      available.push({ ...entry, status: entry.action ? "available" : "soon", detail: null });
    }
  }
  return { connected, available };
}
