// Taxonomía de categorías de OmniAgent. Compartida por servidor, UI y conectores (sin dependencias de servidor).

export const INCOME_CATEGORY = "Ingresos";
export const TRANSFER_CATEGORY = "Transferencias";
export const FEES_CATEGORY = "Comisiones e intereses";
export const SUBSCRIPTIONS_CATEGORY = "Suscripciones";
export const ANT_CATEGORY = "Café y antojos";

/** No cuentan como ingreso ni como gasto: pagos de tarjeta y movimientos entre tus propias cuentas. */
export function isNeutralCategory(category: string | null | undefined): boolean {
  return category === TRANSFER_CATEGORY;
}

const SUBSCRIPTION_LIKE = new Set([SUBSCRIPTIONS_CATEGORY, "Entretenimiento", "Cuidado personal", "Software"]);

/** Categorías donde un cargo fijo y periódico suele ser una suscripción que se puede cancelar. */
export function isSubscriptionLike(category: string | null | undefined): boolean {
  return category ? SUBSCRIPTION_LIKE.has(category) : false;
}

/** Gastos que no son "hormiga" aunque sean pequeños y frecuentes. */
export function excludedFromAntExpenses(category: string | null | undefined): boolean {
  return (
    category === INCOME_CATEGORY ||
    category === TRANSFER_CATEGORY ||
    category === FEES_CATEGORY ||
    category === SUBSCRIPTIONS_CATEGORY ||
    category === "Vivienda" ||
    category === "Servicios"
  );
}

export const SUBSCRIPTION_KIND_LABEL: Record<string, string> = {
  video: "video",
  musica: "música",
  noticias: "noticias",
  almacenamiento: "almacenamiento en la nube",
  gimnasio: "gimnasio",
  software: "software",
};

/**
 * Traduce la categoría de Plaid (personal_finance_category) a la de OmniAgent.
 * https://plaid.com/docs/api/products/transactions/#transactions-sync-response-added-personal-finance-category
 */
export function categoryFromPlaid(
  primary: string | null | undefined,
  detailed: string | null | undefined,
): { category: string; subcategory: string | null } {
  const d = detailed ?? "";
  const is = (prefix: string) => d.startsWith(prefix);
  switch (primary) {
    case "INCOME":
      return { category: INCOME_CATEGORY, subcategory: null };
    case "TRANSFER_IN":
    case "TRANSFER_OUT":
    case "LOAN_PAYMENTS":
      return { category: TRANSFER_CATEGORY, subcategory: null };
    case "BANK_FEES":
      return { category: FEES_CATEGORY, subcategory: null };
    case "FOOD_AND_DRINK":
      if (is("FOOD_AND_DRINK_GROCERIES")) return { category: "Supermercado", subcategory: null };
      if (is("FOOD_AND_DRINK_COFFEE") || is("FOOD_AND_DRINK_VENDING")) return { category: ANT_CATEGORY, subcategory: null };
      return { category: "Restaurantes", subcategory: null };
    case "ENTERTAINMENT":
      if (is("ENTERTAINMENT_TV_AND_MOVIES")) return { category: "Entretenimiento", subcategory: "video" };
      if (is("ENTERTAINMENT_MUSIC_AND_AUDIO")) return { category: "Entretenimiento", subcategory: "musica" };
      return { category: "Entretenimiento", subcategory: null };
    case "GENERAL_MERCHANDISE":
      if (is("GENERAL_MERCHANDISE_CONVENIENCE_STORES")) return { category: ANT_CATEGORY, subcategory: null };
      return { category: "Compras", subcategory: null };
    case "PERSONAL_CARE":
      if (is("PERSONAL_CARE_GYMS")) return { category: "Cuidado personal", subcategory: "gimnasio" };
      return { category: "Cuidado personal", subcategory: null };
    case "MEDICAL":
      return { category: "Salud", subcategory: null };
    case "RENT_AND_UTILITIES":
      if (is("RENT_AND_UTILITIES_RENT")) return { category: "Vivienda", subcategory: null };
      return { category: "Servicios", subcategory: null };
    case "TRANSPORTATION":
      return { category: "Transporte", subcategory: null };
    case "TRAVEL":
      return { category: "Viajes", subcategory: null };
    case "HOME_IMPROVEMENT":
      return { category: "Hogar", subcategory: null };
    case "GENERAL_SERVICES":
      return { category: "Servicios", subcategory: null };
    case "GOVERNMENT_AND_NON_PROFIT":
      return { category: "Impuestos y donaciones", subcategory: null };
    default:
      return { category: "Otros", subcategory: null };
  }
}
