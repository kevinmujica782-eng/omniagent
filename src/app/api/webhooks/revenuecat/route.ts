import { NextResponse } from "next/server";
import { requireEnv } from "@/lib/env";
import { errorResponse, readJson, requestIdOf } from "@/lib/http";
import { claimEvent, markEventProcessed } from "@/modules/billing/events";
import { isAuthorizedRevenueCat, revenueCatWebhookSchema, syncRevenueCatEvent } from "@/modules/billing/revenuecat";

/** Webhook de RevenueCat (compras de Google Play en la app Android). */
export async function POST(request: Request) {
  const requestId = requestIdOf(request);
  try {
    const expected = requireEnv("REVENUECAT_WEBHOOK_AUTH", "El webhook de RevenueCat");
    if (!isAuthorizedRevenueCat(request.headers.get("authorization"), expected)) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    const body = await readJson(request, revenueCatWebhookSchema);
    const fresh = await claimEvent("REVENUECAT", body.event.id, body.event.type, body);
    if (!fresh) return NextResponse.json({ received: true, duplicate: true });

    const userId = await syncRevenueCatEvent(body.event);
    await markEventProcessed("REVENUECAT", body.event.id, userId);
    return NextResponse.json({ received: true });
  } catch (error) {
    return errorResponse(error, { requestId, route: "POST /api/webhooks/revenuecat" });
  }
}
