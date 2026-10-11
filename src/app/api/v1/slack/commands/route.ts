import { after, NextResponse } from "next/server";
import { log } from "@/lib/log";
import { runAgent } from "@/modules/agent/run-agent";
import {
  linkSlackUser,
  postToSlack,
  rememberSlackConversation,
  resolveSlackUser,
  slackConfigured,
  slackSigningSecret,
} from "@/modules/slack/slack.service";
import { verifySlackSignature } from "@/modules/slack/slack.verify";

// Comando de barra de Slack: «/omni <mensaje>». Verifica la firma de Slack, resuelve la cuenta de Omni enlazada y
// corre al agente en segundo plano (after), respondiendo por el response_url. Todo lo que gaste dinero o actúe en
// nombre de la persona sigue quedando pendiente en Aprobaciones dentro de la app: Slack no aprueba nada.
export const maxDuration = 60;

const ephemeral = (text: string) => NextResponse.json({ response_type: "ephemeral", text });

const HELP = [
  "Primero conecta tu cuenta:",
  "1. En Omni, entra a *Conexiones → Slack* y toca *Generar código*.",
  "2. Aquí en Slack escribe: `/omni vincular TU-CÓDIGO`.",
  "Después podrás escribirme como en la app, por ejemplo: `/omni ¿cuánto gasté este mes?`",
].join("\n");

export async function POST(request: Request) {
  if (!slackConfigured()) return ephemeral("La conexión con Slack no está configurada todavía.");

  const rawBody = await request.text();
  const ok = verifySlackSignature({
    signingSecret: slackSigningSecret(),
    timestamp: request.headers.get("x-slack-request-timestamp"),
    rawBody,
    signature: request.headers.get("x-slack-signature"),
  });
  if (!ok) {
    log.warn("slack.bad_signature");
    return new NextResponse("firma inválida", { status: 401 });
  }

  const params = new URLSearchParams(rawBody);
  if (params.get("ssl_check")) return new NextResponse("ok"); // comprobación de Slack al configurar la URL

  const text = (params.get("text") ?? "").trim();
  const teamId = params.get("team_id") ?? "";
  const slackUserId = params.get("user_id") ?? "";
  const responseUrl = params.get("response_url") ?? "";
  if (!teamId || !slackUserId) return ephemeral("No pude identificar tu usuario de Slack.");

  // Vincular: «/omni vincular CÓDIGO» (o "link CÓDIGO").
  const linkMatch = /^(?:vincular|link)\s+(\S+)/i.exec(text);
  if (linkMatch) {
    const result = await linkSlackUser(linkMatch[1], teamId, slackUserId);
    return ephemeral(
      result.linked
        ? "¡Listo! Tu Slack quedó conectado con Omni. Escríbeme lo que necesites, por ejemplo: `/omni ¿qué tengo pendiente?`"
        : `No pude conectar: ${result.reason ?? "intenta de nuevo"}. Genera un código nuevo en Omni → Conexiones → Slack.`,
    );
  }

  const linked = await resolveSlackUser(teamId, slackUserId);
  if (!linked) return ephemeral(HELP);

  if (!text) return ephemeral("Dime qué necesitas, por ejemplo: `/omni ¿cuánto gasté este mes?`");
  if (!responseUrl) return ephemeral("No pude responder por Slack. Inténtalo de nuevo.");

  // El agente puede tardar más que los 3 s que Slack espera: contestamos el acuse ya y seguimos en segundo plano.
  after(async () => {
    try {
      const result = await runAgent({ userId: linked.userId, message: text, conversationId: linked.conversationId ?? undefined });
      await rememberSlackConversation(linked.connectionId, teamId, slackUserId, result.conversationId);
      const cards = result.message.cards.length;
      const note = cards > 0 ? "\n\n_Dejé lo que requiere tu permiso en *Aprobaciones*, dentro de la app._" : "";
      await postToSlack(responseUrl, (result.message.text || "Listo.") + note, { inChannel: false });
    } catch (error) {
      log.error("slack.agent_failed", { error });
      await postToSlack(responseUrl, "Tuve un problema al responder. Inténtalo de nuevo en un momento.", { inChannel: false });
    }
  });

  return ephemeral("Omni lo está viendo… te respondo aquí en un momento.");
}
