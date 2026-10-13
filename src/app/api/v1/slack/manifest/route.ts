import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { slackConfigured } from "@/modules/slack/slack.service";
import { slackCommandUrl, slackCreateAppUrl, slackManifest } from "@/modules/slack/slack.manifest";

// Público: el manifiesto no tiene secretos (solo la URL del comando /omni de esta instalación).
export const dynamic = "force-dynamic";

/**
 * GET /api/v1/slack/manifest — el manifiesto de la app de Slack de Omni, la URL para crearla en un clic y si esta
 * instalación ya tiene el Signing Secret (SLACK_SIGNING_SECRET).
 */
export async function GET() {
  const appUrl = env().NEXT_PUBLIC_APP_URL;
  return NextResponse.json(
    {
      data: {
        configured: slackConfigured(),
        commandUrl: slackCommandUrl(appUrl),
        createAppUrl: slackCreateAppUrl(appUrl),
        manifest: slackManifest(appUrl),
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
