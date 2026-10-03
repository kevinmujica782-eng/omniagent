import { z } from "zod";
import { ensureProfile } from "@/lib/auth";
import { Errors } from "@/lib/errors";
import { handle, readJson } from "@/lib/http";
import { activeProviderName } from "@/modules/finance/providers";
import { completeLink, listBankConnections } from "@/modules/finance/sync.service";

export const maxDuration = 60;

const bodySchema = z.discriminatedUnion("provider", [
  z.object({
    provider: z.literal("sandbox"),
    linkToken: z.string().min(10).max(2000),
    institutionId: z.string().min(3).max(40),
    accountIds: z.array(z.string().max(80)).max(10).default([]),
  }),
  z.object({
    provider: z.literal("plaid"),
    publicToken: z.string().min(10).max(500),
    accountIds: z.array(z.string().max(100)).max(20).optional(),
  }),
]);

export async function GET(request: Request) {
  return handle(request, (auth) => listBankConnections(auth.userId));
}

/** Termina la conexión (intercambia el token) e importa 90 días de movimientos. */
export async function POST(request: Request) {
  return handle(request, async (auth) => {
    const body = await readJson(request, bodySchema);
    if (body.provider !== activeProviderName()) throw Errors.badRequest("Ese conector no está activo en este entorno.");
    await ensureProfile(auth);
    return completeLink(auth.userId, body);
  });
}
