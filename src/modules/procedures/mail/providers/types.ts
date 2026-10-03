// Contrato de los conectores de correo y calendario. El sandbox lo implementa hoy; Gmail (Google APIs)
// y Outlook (Microsoft Graph) se suman implementando esta misma interfaz, sin tocar el resto del módulo.

export type MailProviderName = "sandbox";
export type MailFlavor = "gmail" | "outlook";

export interface MailAttachmentMeta {
  id: string;
  fileName: string;
  mimeType: string;
  size: number;
}

export interface MailMessageData {
  id: string;
  threadId: string | null;
  from: { name: string | null; email: string };
  to: string[];
  subject: string;
  bodyText: string;
  receivedAt: Date;
  labels: string[];
  attachments: MailAttachmentMeta[];
}

export interface MailSyncPage {
  messages: MailMessageData[];
  /** Ids que ya no existen en el servidor de correo. */
  deleted: string[];
  nextCursor: string;
  hasMore: boolean;
}

export interface OutgoingMail {
  to: string;
  subject: string;
  body: string;
  inReplyTo?: string | null;
  attachments?: { fileName: string; mimeType: string; bytes: Uint8Array }[];
}

export interface CalendarEventInput {
  title: string;
  description?: string | null;
  location?: string | null;
  startsAt: Date;
  endsAt: Date | null;
  allDay: boolean;
  reminderMinutes: number[];
}

export interface ExternalCalendarEvent {
  id: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  allDay: boolean;
}

export interface MailboxAccount {
  address: string;
  displayName: string;
  flavor: MailFlavor;
}

export interface MailProvider {
  name: MailProviderName;
  /** Conecta la bandeja (en Gmail/Outlook sería el canje del código OAuth). */
  connect(input: { userId: string; flavor: MailFlavor; firstName: string | null; timeZone: string }): Promise<{
    accessToken: string;
    account: MailboxAccount;
  }>;
  /** Sincronización incremental (historyId en Gmail, deltaLink en Graph). */
  syncMessages(accessToken: string, cursor: string | null): Promise<MailSyncPage>;
  getAttachment(accessToken: string, messageId: string, attachmentId: string): Promise<{ bytes: Uint8Array; mimeType: string; fileName: string }>;
  sendMessage(accessToken: string, mail: OutgoingMail): Promise<{ id: string; sentAt: Date }>;
  /** Calendario de la misma cuenta. */
  listCalendarEvents(accessToken: string, from: Date, to: Date): Promise<ExternalCalendarEvent[]>;
  createCalendarEvent(accessToken: string, event: CalendarEventInput): Promise<{ id: string }>;
  deleteCalendarEvent(accessToken: string, id: string): Promise<void>;
}
