import { NextResponse, type NextRequest } from "next/server";
import { corsHeaders } from "@/lib/cors";
import { updateSession } from "@/lib/supabase/proxy";

// Next.js 16: "proxy" reemplaza a "middleware" y corre en el runtime de Node.
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith("/api/")) {
    const cors = corsHeaders(request.headers.get("origin"));
    if (request.method === "OPTIONS") {
      return new NextResponse(null, { status: 204, headers: cors });
    }
    // Webhooks, cron, el feed ICS (URL secreta) y las llamadas con Bearer (app nativa) no usan cookies de sesión.
    const skipSession =
      pathname.startsWith("/api/webhooks/") ||
      pathname.startsWith("/api/cron/") ||
      pathname.startsWith("/api/calendar/") ||
      pathname === "/api/health" ||
      /^bearer\s+/i.test(request.headers.get("authorization") ?? "");
    const response = skipSession ? NextResponse.next() : await updateSession(request, { protect: false });
    for (const [key, value] of Object.entries(cors)) response.headers.set(key, value);
    return response;
  }

  return updateSession(request, { protect: true });
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|brand/|icons/|descargas/|\\.well-known/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|apk)$).*)",
  ],
};
