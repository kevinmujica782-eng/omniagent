import { handle } from "@/lib/http";
import { calendarSyncView } from "@/modules/procedures/calendar/calendar.service";
import { getFeedUrl, revokeFeed, rotateFeed } from "@/modules/procedures/calendar/feed.service";

/** Estado de la sincronización: calendario conectado y enlace de suscripción ICS. */
export async function GET(request: Request) {
  return handle(request, async (auth) => calendarSyncView(auth.userId, await getFeedUrl(auth.userId)));
}

/** Crea el enlace privado o lo cambia por uno nuevo (el anterior deja de funcionar). */
export async function POST(request: Request) {
  return handle(request, async (auth) => calendarSyncView(auth.userId, await rotateFeed(auth.userId)));
}

export async function DELETE(request: Request) {
  return handle(request, async (auth) => {
    await revokeFeed(auth.userId);
    return calendarSyncView(auth.userId, null);
  });
}
