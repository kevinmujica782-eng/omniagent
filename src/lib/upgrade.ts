// Hoja "Pásate a Pro" desde cualquier parte de la app: un límite del plan Gratis (402 plan_limit) o un botón.
// Sin dependencias de servidor: lo usan apiFetch, el chat, el Inicio y la cuenta.

export const UPGRADE_EVENT = "omni:upgrade";

export type UpgradeRequest = {
  /** El motivo que dio el servidor ("Tu plan permite seguir 3 precios a la vez..."). */
  reason: string | null;
  /** Función avanzada concreta, si la hubo (ver AgentFeatureId). */
  feature: string | null;
  /** El límite con el que chocó ("messages", "watchlist"…): la pantalla de Pro marca esa fila. */
  limit?: string | null;
};

export function requestUpgrade(detail: UpgradeRequest = { reason: null, feature: null }): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<UpgradeRequest>(UPGRADE_EVENT, { detail }));
}
