import { CalendarCheck, FileText, Inbox, Mail, MessageCircle } from "lucide-react";
import { OmniMark } from "@/components/omni-mark";
import { AgendaList } from "@/components/procedures/agenda-list";
import { CalendarSyncPanel } from "@/components/procedures/calendar-sync-panel";
import { ConnectMailButton, MailboxBar } from "@/components/procedures/connect-mail";
import { FormsPanel, UploadFormButton } from "@/components/procedures/forms-panel";
import { PersonalDataPanel } from "@/components/procedures/personal-data-panel";
import { ProceduresBoard } from "@/components/procedures/procedures-board";
import { ButtonLink, IconTile, PageBody, PageHeader, Section } from "@/components/ui";
import type {
  AgendaItemView,
  CalendarSyncView,
  FormDocumentView,
  MailboxView,
  PersonalDataView,
  ProcedureView,
} from "@/types/cards";

export type ProceduresViewProps = {
  mailboxes: MailboxView[];
  suggested: ProcedureView[];
  active: ProcedureView[];
  done: ProcedureView[];
  agenda: AgendaItemView[];
  calendar: CalendarSyncView;
  forms: FormDocumentView[];
  personal: PersonalDataView;
  timeZone: string;
  /** Vista previa (/preview): sin API; `connectStep` abre el diálogo de conexión en ese paso. */
  preview?: { connectStep?: "intro" | "connecting" | "done" };
};

const FEATURES = [
  { icon: Inbox, title: "Detecta trámites", body: "Permisos, citas, reembolsos y facturas que llegan a tu correo." },
  { icon: FileText, title: "Llena formularios", body: "Lee el PDF con IA y lo completa con tus datos; tú firmas." },
  { icon: CalendarCheck, title: "Te avisa a tiempo", body: "Fechas sin choques con tu calendario. Confirmas con un toque." },
];

function ProceduresWelcome({ demo, connectStep }: { demo: boolean; connectStep?: "intro" | "connecting" | "done" }) {
  return (
    <section className="overflow-hidden rounded-3xl border border-line bg-surface">
      <div className="px-6 pb-7 pt-9 text-center sm:px-10">
        <OmniMark size={52} className="mx-auto" />
        <h2 className="mt-5 text-2xl font-semibold tracking-tight text-balance text-ink">Tus trámites, resueltos a tiempo</h2>
        <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted">
          Omni revisa tu correo, encuentra permisos, citas y fechas límite, llena los formularios con tus datos y te propone
          cuándo hacer cada cosa.
        </p>
        <div className="mx-auto mt-6 flex max-w-xs flex-col gap-3 sm:max-w-none sm:flex-row sm:items-start sm:justify-center">
          <ConnectMailButton size="lg" label="Conectar correo de prueba" className="w-full sm:w-auto" demo={demo} initialStep={connectStep} />
          <UploadFormButton size="lg" label="Subir un formulario" className="w-full sm:w-auto" demo={demo} />
        </div>
      </div>
      <ul className="grid gap-px border-t border-line bg-line sm:grid-cols-3">
        {FEATURES.map((feature) => (
          <li key={feature.title} className="flex items-start gap-3 bg-surface-2 px-5 py-4 sm:flex-col sm:gap-2.5">
            <IconTile icon={feature.icon} size="sm" />
            <div>
              <p className="text-sm font-semibold text-ink">{feature.title}</p>
              <p className="mt-0.5 text-xs leading-relaxed text-muted">{feature.body}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function ProceduresView({
  mailboxes,
  suggested,
  active,
  done,
  agenda,
  calendar,
  forms,
  personal,
  timeZone,
  preview,
}: ProceduresViewProps) {
  const demo = Boolean(preview);
  const empty = mailboxes.length === 0 && suggested.length === 0 && active.length === 0 && done.length === 0;

  return (
    <PageBody className="max-w-4xl">
      <PageHeader
        title="Trámites"
        description="Permisos, citas, reembolsos y fechas límite: Omni los encuentra, llena los formularios y te avisa a tiempo."
        action={
          <ButtonLink href={demo ? "/preview?screen=chat-tramites" : "/chat?modulo=tramites"} size="sm">
            <MessageCircle className="size-4" aria-hidden />
            Hablar con Omni
          </ButtonLink>
        }
      />

      {empty ? (
        <ProceduresWelcome demo={demo} connectStep={preview?.connectStep} />
      ) : (
        <>
          {mailboxes.length > 0 ? (
            <MailboxBar mailboxes={mailboxes} timeZone={timeZone} demo={demo} />
          ) : (
            <div className="mb-6 flex flex-col gap-3 rounded-2xl border border-line bg-surface px-4 py-4 sm:flex-row sm:items-center">
              <IconTile icon={Mail} size="sm" />
              <p className="flex-1 text-sm leading-relaxed text-muted">
                Conecta tu correo y Omni detectará solo los permisos, citas y fechas límite que te lleguen.
              </p>
              <ConnectMailButton size="sm" variant="secondary" demo={demo} />
            </div>
          )}
          <ProceduresBoard suggested={suggested} active={active} done={done} timeZone={timeZone} demo={demo} />
        </>
      )}

      <div className="mt-10 grid grid-cols-1 items-start gap-8 lg:grid-cols-2">
        <Section title="Esta semana">
          <AgendaList
            items={agenda}
            timeZone={timeZone}
            demo={demo}
            emptyText="Nada agendado esta semana. Lo que confirmes aparece aquí y en tu calendario."
          />
        </Section>
        <div id="calendario" className="scroll-mt-6">
          <Section title="Sincronizar calendario">
            <CalendarSyncPanel sync={calendar} demo={demo} />
          </Section>
        </div>
      </div>

      <Section title="Formularios" className="mt-10" action={forms.length > 0 ? <UploadFormButton demo={demo} /> : null}>
        <FormsPanel forms={forms} timeZone={timeZone} demo={demo} />
      </Section>

      <Section title="Mis datos para formularios" className="mt-10">
        <PersonalDataPanel data={personal} demo={demo} />
      </Section>
    </PageBody>
  );
}
