import "server-only";
import Stripe from "stripe";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { env, requireEnv } from "@/lib/env";
import { AppError, Errors } from "@/lib/errors";
import { log } from "@/lib/log";
import { getEntitlements } from "./entitlements";
import { applyPlanChange } from "./plan-change";
import { mapStripeStatus } from "./status";

let stripe: Stripe | undefined;

/**
 * Cliente de Stripe. La versión de la API la fija el SDK (package.json); los webhooks deben usar la misma
 * versión (Dashboard → Webhooks → versión del endpoint). Reintenta errores de red con backoff.
 */
export function getStripe(): Stripe {
  stripe ??= new Stripe(requireEnv("STRIPE_SECRET_KEY", "Stripe"), {
    maxNetworkRetries: 2,
    timeout: 20_000,
    appInfo: { name: "OmniAgent", url: env().NEXT_PUBLIC_APP_URL },
  });
  return stripe;
}

function customerIdOf(customer: string | Stripe.Customer | Stripe.DeletedCustomer): string {
  return typeof customer === "string" ? customer : customer.id;
}

export async function getOrCreateStripeCustomer(userId: string, email: string | null): Promise<string> {
  const profile = await prisma.profile.findUnique({
    where: { id: userId },
    select: { stripeCustomerId: true, fullName: true },
  });
  if (profile?.stripeCustomerId) return profile.stripeCustomerId;

  const customer = await getStripe().customers.create(
    { email: email ?? undefined, name: profile?.fullName ?? undefined, metadata: { userId } },
    { idempotencyKey: `omniagent-customer-${userId}` },
  );
  await prisma.profile.update({ where: { id: userId }, data: { stripeCustomerId: customer.id } });
  return customer.id;
}

/** Sesión de Checkout para Pro: en español latino, con el usuario atado a la sesión y a la suscripción. */
export async function createProCheckout(user: { userId: string; email: string | null }): Promise<string> {
  const price = requireEnv("STRIPE_PRICE_PRO_MONTHLY", "El plan Pro");
  const entitlements = await getEntitlements(user.userId);
  if (entitlements.plan === "PRO") throw Errors.conflict("Ya tienes el plan Pro.");

  const customer = await getOrCreateStripeCustomer(user.userId, user.email);
  const appUrl = env().NEXT_PUBLIC_APP_URL;
  const session = await getStripe().checkout.sessions.create({
    mode: "subscription",
    customer,
    client_reference_id: user.userId,
    line_items: [{ price, quantity: 1 }],
    subscription_data: { metadata: { userId: user.userId } },
    metadata: { userId: user.userId },
    allow_promotion_codes: true,
    locale: "es-419",
    // {CHECKOUT_SESSION_ID} lo reemplaza Stripe: al volver, la cuenta se sincroniza sin esperar al webhook.
    success_url: `${appUrl}/cuenta?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${appUrl}/cuenta?checkout=cancel`,
  });
  if (!session.url) throw new AppError(502, "stripe_error", "Stripe no devolvió la página de pago.");
  await audit({ userId: user.userId, actor: "user", action: "billing.checkout", entity: "checkout_session", entityId: session.id });
  return session.url;
}

/**
 * Al volver de Checkout: se lee la sesión en Stripe y se sincroniza la suscripción en el momento
 * (el webhook hace lo mismo; lo que llegue primero gana y el segundo no cambia nada).
 */
export async function syncCheckoutSession(userId: string, sessionId: string): Promise<{ plan: "FREE" | "PRO" }> {
  if (!/^cs_[A-Za-z0-9_]+$/.test(sessionId)) throw Errors.badRequest("La sesión de pago no es válida.");
  const session = await getStripe().checkout.sessions.retrieve(sessionId);
  if (session.client_reference_id !== userId) throw Errors.forbidden();
  if (session.mode === "subscription" && session.subscription && session.status === "complete") {
    const subscriptionId = typeof session.subscription === "string" ? session.subscription : session.subscription.id;
    const subscription = await getStripe().subscriptions.retrieve(subscriptionId);
    await syncStripeSubscription(subscription, userId);
  }
  return { plan: (await getEntitlements(userId)).plan };
}

export async function createPortalSession(userId: string): Promise<string> {
  const profile = await prisma.profile.findUnique({ where: { id: userId }, select: { stripeCustomerId: true } });
  if (!profile?.stripeCustomerId) throw Errors.badRequest("Aún no tienes una suscripción pagada en la web.");
  const session = await getStripe().billingPortal.sessions.create({
    customer: profile.stripeCustomerId,
    return_url: `${env().NEXT_PUBLIC_APP_URL}/cuenta`,
    locale: "es-419",
  });
  return session.url;
}

async function userIdForCustomer(customerId: string): Promise<string | null> {
  const profile = await prisma.profile.findUnique({ where: { stripeCustomerId: customerId }, select: { id: true } });
  return profile?.id ?? null;
}

/**
 * Copia el estado de una suscripción de Stripe a la tabla unificada y, si con eso cambia el plan efectivo,
 * ajusta los agentes (ver plan-change.ts). Devuelve el userId o null.
 */
export async function syncStripeSubscription(sub: Stripe.Subscription, userHint?: string): Promise<string | null> {
  const customerId = customerIdOf(sub.customer);
  const userId = sub.metadata?.userId || userHint || (await userIdForCustomer(customerId));
  if (!userId) {
    log.warn("stripe.subscription_without_user", { subscriptionId: sub.id });
    return null;
  }
  // Cuenta eliminada: Stripe avisa después la cancelación que hizo deleteAccount. No hay nada que guardar y un
  // error haría que Stripe reintente el evento durante días.
  const profile = await prisma.profile.findUnique({ where: { id: userId }, select: { id: true } });
  if (!profile) {
    log.info("stripe.subscription_for_deleted_account", { subscriptionId: sub.id, status: sub.status });
    return null;
  }

  const now = new Date();
  const before = (await getEntitlements(userId, now)).plan;

  // Desde la API 2025-03-31 (basil), el fin de periodo vive en cada item de la suscripción.
  const item = sub.items.data[0];
  const periodEnd = item?.current_period_end ? new Date(item.current_period_end * 1000) : null;
  const status = mapStripeStatus(sub.status);

  await prisma.subscription.upsert({
    where: { provider_providerSubscriptionId: { provider: "STRIPE", providerSubscriptionId: sub.id } },
    create: {
      userId,
      provider: "STRIPE",
      plan: "PRO",
      status,
      productId: item?.price.id ?? null,
      providerCustomerId: customerId,
      providerSubscriptionId: sub.id,
      currentPeriodEnd: periodEnd,
      cancelAtPeriodEnd: sub.cancel_at_period_end,
    },
    update: {
      status,
      productId: item?.price.id ?? null,
      currentPeriodEnd: periodEnd,
      cancelAtPeriodEnd: sub.cancel_at_period_end,
    },
  });
  await audit({ userId, actor: "webhook", action: "billing.stripe.sync", entity: "subscription", entityId: sub.id, metadata: { status } });

  const after = (await getEntitlements(userId, now)).plan;
  if (after !== before) await applyPlanChange(userId, before, after, now);
  return userId;
}

/** Suscripción de una factura (desde la API basil vive en invoice.parent.subscription_details). */
export function subscriptionIdOfInvoice(invoice: Stripe.Invoice): string | null {
  const details = invoice.parent?.type === "subscription_details" ? invoice.parent.subscription_details : null;
  const subscription = details?.subscription ?? null;
  if (!subscription) return null;
  return typeof subscription === "string" ? subscription : subscription.id;
}

/** Un cobro de renovación falló: se avisa al usuario (el estado past_due llega con customer.subscription.updated). */
export async function notifyPaymentFailed(invoice: Stripe.Invoice): Promise<string | null> {
  const customerId = invoice.customer ? customerIdOf(invoice.customer) : null;
  const userId = customerId ? await userIdForCustomer(customerId) : null;
  if (!userId) return null;
  await prisma.appNotification.create({
    data: {
      userId,
      type: "SYSTEM",
      title: "No pudimos cobrar tu plan Pro",
      body: "Tu banco rechazó el pago de la renovación. Mantienes Pro mientras Stripe reintenta; actualiza tu tarjeta en Cuenta → Administrar suscripción.",
      href: "/cuenta",
      data: { invoiceId: invoice.id ?? null, subscriptionId: subscriptionIdOfInvoice(invoice) },
    },
  });
  await audit({ userId, actor: "webhook", action: "billing.payment_failed", entity: "invoice", entityId: invoice.id });
  return userId;
}
