import { feedIcsForToken } from "@/modules/procedures/calendar/feed.service";

// Feed ICS público: la URL secreta ({id}.{secreto}.ics) es la credencial. Google Calendar, Apple Calendar
// y Outlook lo consultan periódicamente sin sesión. No se cachea en CDN: cada usuario ve lo suyo.
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ token: string }> };

export async function GET(_request: Request, { params }: Context) {
  const { token } = await params;
  const ics = await feedIcsForToken(decodeURIComponent(token)).catch((error) => {
    console.error("[calendar] error al generar el feed", error);
    return undefined;
  });
  if (ics === undefined) return new Response("No disponible", { status: 503 });
  if (ics === null) return new Response("No encontrado", { status: 404 });
  return new Response(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="omniagent.ics"',
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex",
    },
  });
}
