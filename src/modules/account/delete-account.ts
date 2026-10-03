import "server-only";
import { prisma } from "@/lib/db";
import { AppError, Errors } from "@/lib/errors";
import { log } from "@/lib/log";
import { isEntitled } from "@/modules/billing/status";
import { getStripe } from "@/modules/billing/stripe";
import { revokeBankAccess } from "@/modules/finance/sync.service";
import { deleteStoredFiles } from "@/modules/procedures/documents/storage";

export type AccountDeletion = {
  /** Suscripciones web de Stripe canceladas en este momento. */
  stripeCanceled: number;
  /** Había una suscripción de Google Play vigente: solo el usuario puede cancelarla desde Google Play. */
  playSubscriptionActive: boolean;
  bankAccessRevoked: number;
  filesDeleted: number;
};

/**
 * El acceso se borra en la base con public.delete_auth_user (prisma/sql/supabase-setup.sql): una función
 * SECURITY DEFINER que solo puede ejecutar el rol de la app, así que no hace falta la llave secreta de Supabase.
 * Se comprueba antes de tocar nada: sin la función, ninguna parte de la cuenta se borra.
 */
async function assertAuthDeletionReady(): Promise<void> {
  const [row] = await prisma.$queryRaw<{ ready: boolean }[]>`
    select case
      when to_regprocedure('public.delete_auth_user(uuid)') is null then false
      else has_function_privilege(to_regprocedure('public.delete_auth_user(uuid)'), 'execute')
    end as ready`;
  if (!row?.ready) throw Errors.notConfigured("Eliminar la cuenta (función public.delete_auth_user: npm run db:security)");
}

/** Borra el usuario de Supabase Auth; su trigger borra el perfil y, en cascada, todos sus datos. */
async function deleteAuthUser(userId: string): Promise<void> {
  try {
    await prisma.$queryRaw`select public.delete_auth_user(${userId}::uuid)`;
  } catch (error) {
    log.error("account.auth_delete_failed", { userId, error });
    throw new AppError(502, "auth_provider_error", "No pudimos eliminar tu acceso en este momento. Inténtalo de nuevo en unos minutos.");
  }
}

async function cancelStripeSubscription(subscriptionId: string): Promise<boolean> {
  try {
    await getStripe().subscriptions.cancel(subscriptionId, {
      cancellation_details: { comment: "Cuenta eliminada por el usuario en OmniAgent" },
    });
    return true;
  } catch (error) {
    // Ya no existe en Stripe (se canceló por otro lado): no hay nada que cobrar.
    if ((error as { code?: string } | null)?.code === "resource_missing") return false;
    throw error;
  }
}

/**
 * Elimina la cuenta a pedido del usuario (Google Play exige poder hacerlo desde la app y desde la web).
 * El orden evita cobros huérfanos y cuentas a medio borrar:
 * 1. Cancela ya las suscripciones web de Stripe. Si Stripe falla, no se borra nada y el usuario puede reintentar.
 * 2. Revoca el acceso a los bancos (Plaid) y borra los archivos de Supabase Storage, sin frenar si algo falla.
 * 3. Borra el usuario de Supabase Auth: su trigger borra el perfil y, en cascada, todos sus datos.
 * 4. Borra su bitácora, vacía sus eventos de pago y borra también el perfil desde aquí, por si el trigger de
 *    prisma/sql/supabase-setup.sql no está instalado.
 * Una suscripción de Google Play no se puede cancelar desde el servidor: la pantalla lo avisa antes de confirmar.
 */
export async function deleteAccount(userId: string, now = new Date()): Promise<AccountDeletion> {
  await assertAuthDeletionReady();

  const subscriptions = await prisma.subscription.findMany({
    where: { userId, status: { notIn: ["CANCELED", "EXPIRED"] } },
  });
  let stripeCanceled = 0;
  for (const subscription of subscriptions.filter((s) => s.provider === "STRIPE")) {
    if (await cancelStripeSubscription(subscription.providerSubscriptionId)) stripeCanceled++;
  }
  const playSubscriptionActive = subscriptions.some((s) => s.provider === "REVENUECAT" && isEntitled(s, now));

  const bankAccessRevoked = await revokeBankAccess(userId);
  const stored = await prisma.userDocument.findMany({
    where: { userId, storageDriver: "supabase" },
    select: { storagePath: true },
  });
  const filesDeleted = await deleteStoredFiles(stored.map((d) => d.storagePath)).catch((error) => {
    log.warn("account.files_not_deleted", { userId, files: stored.length, error });
    return 0;
  });

  await deleteAuthUser(userId);
  // Lo que no cuelga del perfil en cascada: la bitácora (quedaría anónima) y los eventos de pago, de los que solo
  // se conserva el id (evita procesar dos veces un reintento de Stripe); el detalle queda en Stripe.
  await prisma.auditLog.deleteMany({ where: { userId } });
  await prisma.billingEvent.updateMany({ where: { userId }, data: { userId: null, payload: {} } });
  await prisma.profile.deleteMany({ where: { id: userId } });

  log.info("account.deleted", { userId, stripeCanceled, playSubscriptionActive, bankAccessRevoked, filesDeleted });
  return { stripeCanceled, playSubscriptionActive, bankAccessRevoked, filesDeleted };
}
