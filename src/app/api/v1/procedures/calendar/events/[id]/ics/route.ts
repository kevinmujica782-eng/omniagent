import { getAuthContext } from "@/lib/auth";
import { errorResponse } from "@/lib/http";
import { eventIcs } from "@/modules/procedures/calendar/calendar.service";
import { userTimeZone } from "@/modules/procedures/plan";

type Context = { params: Promise<{ id: string }> };

/** "Añadir a mi calendario": un evento como archivo .ics (el teléfono lo abre con su app de calendario). */
export async function GET(request: Request, { params }: Context) {
  try {
    const auth = await getAuthContext(request);
    const { id } = await params;
    const { fileName, ics } = await eventIcs(auth.userId, id, await userTimeZone(auth.userId));
    return new Response(ics, {
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
