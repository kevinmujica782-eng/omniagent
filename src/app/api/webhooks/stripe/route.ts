import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { requireEnv } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { errorResponse, requestIdOf } from "@/lib/http";
import { log } from "@/lib/log";
import { claimEvent, markEventProcessed } from "@/modules/billing/events";
import { getStripe, notifyPaymentFailed, subscriptionIdOfInvoice, syncStripeSubscription } from "@/modules/billing/stripe";

/**
 * Webhook de Stripe: verifica la firma sobre el cuerpo crudo, procesa cada evento una sola vez (billing_events)
 * y sincroniza la suscripción. Responde 500 ante un error para que Stripe reintente.
 * Eventos a activar en el Dashboard: checkout.session.completed, customer.subscription.created/updated/deleted/
 * paused/resumed e invoice.payment_failed / invoice.paid.
 */
export async function POST(request: Request) {
  const requestId = requestIdOf(request);
  let event: Stripe.Event;
  try {
    const secret = requireEnv("STRIPE_WEBHOOK_SECRET", "El webhook de Stripe");
    const signature = request.headers.get("stripe-signature");
    if (!signature) return NextResponse.json({ error: "Falta la firma" }, { status: 400 });
    const payload = await request.text();
    event = getStripe().webhooks.constructEvent(payload, signature, secret);
  } catch (error) {
    if (error instanceof AppError) return errorResponse(error, { requestId, route: "POST /api/webhooks/stripe" });
    log.warn("stripe.webhook.bad_signature", { requestId });
    return NextResponse.json({ error: "Firma inválida" }, { status: 400 });
  }

  const logger = log.child({ requestId, eventId: event.id, type: event.type });
  try {
    const fresh = await claimEvent("STRIPE", event.id, event.type, event);
    if (!fresh) return NextResponse.json({ received: true, duplicate: true });

    let userId: string | null = null;
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.mode === "subscription" && session.subscription) {
          const subscriptionId = typeof session.subscription === "string" ? session.subscription : session.subscription.id;
          const subscription = await getStripe().subscriptions.retrieve(subscriptionId);
          userId = await syncStripeSubscription(subscription, session.client_reference_id ?? undefined);
        }
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
      case "customer.subscription.paused":
      case "customer.subscription.resumed":
        userId = await syncStripeSubscription(event.data.object as Stripe.Subscription);
        break;
      case "invoice.paid": {
        // Renovación cobrada: se relee la suscripción para tener el nuevo fin de periodo aunque el
        // evento customer.subscription.updated llegue más tarde o fuera de orden.
        const subscriptionId = subscriptionIdOfInvoice(event.data.object as Stripe.Invoice);
        if (subscriptionId) userId = await syncStripeSubscription(await getStripe().subscriptions.retrieve(subscriptionId));
        break;
      }
      case "invoice.payment_failed":
        userId = await notifyPaymentFailed(event.data.object as Stripe.Invoice);
        break;
      default:
        break;
    }

    await markEventProcessed("STRIPE", event.id, userId);
    logger.info("stripe.webhook.processed", { userId });
    return NextResponse.json({ received: true });
  } catch (error) {
    logger.error("stripe.webhook.failed", { error });
    return NextResponse.json({ error: "Error procesando el evento" }, { status: 500 });
  }
}
