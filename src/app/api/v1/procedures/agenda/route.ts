import { z } from "zod";
import { handle } from "@/lib/http";
import { listAgenda } from "@/modules/procedures/calendar/calendar.service";
import { userTimeZone } from "@/modules/procedures/plan";
import { addLocalDays, startOfLocalDay } from "@/modules/procedures/time/tz";

const querySchema = z.object({
  days: z.coerce.number().int().min(1).max(62).default(14),
  /** 1 = incluir lo ocupado del calendario conectado. */
  busy: z.enum(["0", "1"]).default("0"),
});

/** Agenda desde hoy (hora local): citas, bloques para hacer trámites, fechas límite y, si se pide, lo ocupado. */
export async function GET(request: Request) {
  return handle(request, async (auth) => {
    const query = querySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    const timeZone = await userTimeZone(auth.userId);
    const from = startOfLocalDay(new Date(), timeZone);
    const to = addLocalDays(from, query.days, timeZone);
    return listAgenda(auth.userId, from, to, { includeBusy: query.busy === "1" });
  });
}
