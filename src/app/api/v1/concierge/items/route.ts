import { z } from "zod";
import { ensureProfile } from "@/lib/auth";
import { handle, readJson } from "@/lib/http";
import { listTrackedViews, trackLink } from "@/modules/concierge/tracking.service";

export const maxDuration = 30;

const schema = z.object({
  url: z.string().trim().min(4).max(2000),
  title: z.string().trim().min(2).max(160).nullable().optional(),
  targetPrice: z.number().positive().max(10_000_000).nullable().optional(),
  dropAlertPct: z.number().int().min(5).max(80).default(15),
  quantity: z.number().int().min(1).max(10).default(1),
  useAI: z.boolean().default(false),
});

export async function GET(request: Request) {
  return handle(request, (auth) => listTrackedViews(auth.userId));
}

/** Seguir un enlace. Si ya lo seguías, devuelve el mismo seguimiento (created: false). */
export async function POST(request: Request) {
  return handle(request, async (auth) => {
    const input = await readJson(request, schema);
    await ensureProfile(auth);
    return trackLink(auth.userId, input);
  });
}
