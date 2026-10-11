import { ensureProfile } from "@/lib/auth";
import { handle } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { createSlackLinkCode, slackConfigured } from "@/modules/slack/slack.service";
import { Errors } from "@/lib/errors";

/** Genera un código para conectar Slack: la persona lo escribe en Slack con «/omni vincular CÓDIGO». */
export async function POST(request: Request) {
  return handle(request, async (auth) => {
    if (!slackConfigured()) throw Errors.notConfigured("Slack");
    await rateLimit(auth.userId, "slack.link", { limit: 10, windowSeconds: 3600 });
    await ensureProfile(auth);
    return createSlackLinkCode(auth.userId);
  });
}
