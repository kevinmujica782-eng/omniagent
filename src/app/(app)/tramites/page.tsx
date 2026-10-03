import type { Metadata } from "next";
import { ProceduresView } from "@/components/views/procedures-view";
import { requireUser } from "@/lib/auth";
import { calendarSyncView, listAgenda } from "@/modules/procedures/calendar/calendar.service";
import { getFeedUrl } from "@/modules/procedures/calendar/feed.service";
import { listFormDocuments } from "@/modules/procedures/documents/documents.service";
import { getPersonalDataView } from "@/modules/procedures/documents/personal-data.service";
import { listMailboxes } from "@/modules/procedures/mail/mail.service";
import { listProcedures, userTimeZone } from "@/modules/procedures/plan";
import { addLocalDays, startOfLocalDay } from "@/modules/procedures/time/tz";

export const metadata: Metadata = { title: "Trámites" };

export default async function ProceduresPage() {
  const user = await requireUser();
  const timeZone = await userTimeZone(user.userId);
  const from = startOfLocalDay(new Date(), timeZone);
  const to = addLocalDays(from, 7, timeZone);

  const [mailboxes, suggested, active, done, agenda, feedUrl, forms, personal] = await Promise.all([
    listMailboxes(user.userId),
    listProcedures(user.userId, "suggested"),
    listProcedures(user.userId, "active"),
    listProcedures(user.userId, "done", 5),
    listAgenda(user.userId, from, to, { includeBusy: true }),
    getFeedUrl(user.userId),
    listFormDocuments(user.userId),
    getPersonalDataView(user.userId),
  ]);
  const calendar = await calendarSyncView(user.userId, feedUrl);

  return (
    <ProceduresView
      mailboxes={mailboxes}
      suggested={suggested}
      active={active}
      done={done}
      agenda={agenda}
      calendar={calendar}
      forms={forms}
      personal={personal}
      timeZone={timeZone}
    />
  );
}
