import "server-only";
import { prisma } from "./db";

// Preferencias de la persona: profiles.preferences es un JSON con una sección por módulo (ai, returns, concierge...).

/**
 * Mezcla `patch` en una sección de profiles.preferences con una sola sentencia, sin leer antes. Así dos cambios a la
 * vez no se pisan: por ejemplo, elegir el modelo en Cuenta mientras un turno del chat guarda el cursor de correo de
 * Devoluciones. Las claves de `patch` reemplazan las de la sección; el resto de la sección y las otras secciones
 * quedan como estaban. Si la sección (o todo el JSON) no es un objeto, se reemplaza por uno.
 */
export async function mergePreferences(userId: string, section: string, patch: Record<string, unknown>): Promise<void> {
  const value = JSON.stringify(patch);
  await prisma.$executeRaw`
    UPDATE profiles
    SET preferences = jsonb_set(
          CASE WHEN jsonb_typeof(preferences) = 'object' THEN preferences ELSE '{}'::jsonb END,
          ARRAY[${section}::text],
          (CASE WHEN jsonb_typeof(preferences -> ${section}::text) = 'object' THEN preferences -> ${section}::text ELSE '{}'::jsonb END)
            || ${value}::jsonb,
          true
        ),
        updated_at = now()
    WHERE id = ${userId}::uuid`;
}
