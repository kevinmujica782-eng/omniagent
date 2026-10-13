import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { slackCreateAppUrl } from "@/modules/slack/slack.manifest";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/slack/setup — abre «Create New App» de Slack con el manifiesto de Omni ya puesto (comando /omni con la
 * URL de esta instalación). Solo falta elegir el espacio de trabajo, crearla, instalarla y copiar el Signing Secret
 * a SLACK_SIGNING_SECRET.
 */
export function GET() {
  return NextResponse.redirect(slackCreateAppUrl(env().NEXT_PUBLIC_APP_URL), 302);
}
