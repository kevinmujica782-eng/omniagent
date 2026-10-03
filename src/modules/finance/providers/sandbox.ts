import "server-only";
import { signPayload, verifyPayload } from "@/lib/crypto";
import { AppError, Errors } from "@/lib/errors";
import { DAY_MS } from "../analyzers";
import { sandboxUsageSignals, simulateAccount, simulateBalance } from "../bank-simulator";
import { findSandboxInstitution, sandboxAccountId, sandboxMask, type SandboxInstitution } from "./sandbox-catalog";
import type { FinancialProvider, ProviderAccount, ProviderTransaction, SyncPage } from "./types";

// Conector sandbox con el mismo contrato que Plaid. Los tokens van firmados (HMAC) y no guardan estado:
// el access token dice qué usuario, institución y cuentas se conectaron.

const LINK_TTL_MS = 30 * 60_000;
const PAGE_SIZE = 250;
const HISTORY_DAYS = 90;

type LinkPayload = { t: "link"; uid: string; exp: number };
type PublicPayload = { t: "public"; uid: string; ins: string; acc: string[]; exp: number };
type AccessPayload = { t: "access"; uid: string; ins: string; acc: string[]; item: string };
type Cursor = { through: string | null; page?: { from: string; to: string; offset: number; modifiedDay: string | null } };

const isoDay = (date: Date) => date.toISOString().slice(0, 10);
const dayStart = (iso: string) => new Date(`${iso}T00:00:00Z`);

function readAccess(token: string): { payload: AccessPayload; institution: SandboxInstitution } {
  const payload = verifyPayload<AccessPayload>(token);
  const institution = payload?.t === "access" ? findSandboxInstitution(payload.ins) : undefined;
  if (!payload || !institution) throw new AppError(401, "invalid_access_token", "El acceso a esta cuenta ya no es válido.");
  return { payload, institution };
}

function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

function decodeCursor(cursor: string | null): Cursor {
  if (!cursor) return { through: null };
  try {
    return JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as Cursor;
  } catch {
    return { through: null };
  }
}

function templatesFor(institution: SandboxInstitution, accountIds: string[]) {
  return institution.accounts.filter((tpl) => accountIds.includes(sandboxAccountId(institution.id, tpl.id)));
}

function generate(payload: AccessPayload, institution: SandboxInstitution, from: string, to: string, now: Date) {
  const all: ProviderTransaction[] = [];
  for (const tpl of templatesFor(institution, payload.acc)) {
    const accountId = sandboxAccountId(institution.id, tpl.id);
    for (const tx of simulateAccount({
      userSeed: payload.uid,
      accountId,
      profile: tpl.profile,
      from: dayStart(from),
      to: dayStart(to),
      now,
    })) {
      all.push({
        id: tx.externalId,
        accountId,
        postedAt: tx.postedAt,
        amount: tx.amount,
        direction: tx.direction,
        currency: "USD",
        merchantName: tx.merchantName,
        description: tx.description,
        category: tx.category,
        subcategory: tx.subcategory,
        pending: tx.pending,
      });
    }
  }
  return all.sort((a, b) => a.postedAt.getTime() - b.postedAt.getTime() || a.id.localeCompare(b.id));
}

/** Paso intermedio del sandbox: la UI de conexión propia hace lo que Plaid Link hace del lado del banco. */
export function createSandboxPublicToken(
  userId: string,
  linkToken: string,
  institutionId: string,
  accountIds: string[],
): string {
  const link = verifyPayload<LinkPayload>(linkToken);
  if (!link || link.t !== "link" || link.uid !== userId || link.exp < Date.now()) {
    throw Errors.badRequest("La sesión de conexión venció. Vuelve a intentarlo.");
  }
  const institution = findSandboxInstitution(institutionId);
  if (!institution) throw Errors.notFound("La institución");
  const valid = institution.accounts.map((tpl) => sandboxAccountId(institution.id, tpl.id));
  const selected = accountIds.length ? accountIds.filter((id) => valid.includes(id)) : valid;
  if (selected.length === 0) throw Errors.badRequest("Elige al menos una cuenta.");
  return signPayload({ t: "public", uid: userId, ins: institution.id, acc: selected, exp: Date.now() + LINK_TTL_MS });
}

export const sandboxProvider: FinancialProvider = {
  name: "sandbox",

  async createLinkToken(userId) {
    const exp = Date.now() + LINK_TTL_MS;
    return { linkToken: signPayload({ t: "link", uid: userId, exp }), expiresAt: new Date(exp).toISOString() };
  },

  async exchangePublicToken(userId, publicToken) {
    const payload = verifyPayload<PublicPayload>(publicToken);
    if (!payload || payload.t !== "public" || payload.uid !== userId || payload.exp < Date.now()) {
      throw Errors.badRequest("El token de conexión no es válido o venció.");
    }
    const institution = findSandboxInstitution(payload.ins);
    if (!institution) throw Errors.notFound("La institución");
    const item = `sbx_item_${institution.id}`;
    const accessToken = signPayload({ t: "access", uid: userId, ins: institution.id, acc: payload.acc, item });
    return { accessToken, itemId: item, institution: { id: institution.id, name: institution.name } };
  },

  async getAccounts(accessToken) {
    const { payload, institution } = readAccess(accessToken);
    return templatesFor(institution, payload.acc).map((tpl): ProviderAccount => {
      const id = sandboxAccountId(institution.id, tpl.id);
      return {
        id,
        name: tpl.name,
        officialName: `${institution.name} ${tpl.name}`,
        type: tpl.type,
        subtype: tpl.subtype,
        mask: sandboxMask(payload.uid, id),
        currency: "USD",
        currentBalance: simulateBalance(payload.uid, id, tpl.profile),
        creditLimit: tpl.creditLimit ?? null,
      };
    });
  },

  async syncTransactions(accessToken, rawCursor): Promise<SyncPage> {
    const { payload, institution } = readAccess(accessToken);
    const now = new Date();
    const today = isoDay(now);
    const state = decodeCursor(rawCursor);

    let page = state.page;
    if (!page) {
      if (state.through === today) {
        return { added: [], modified: [], removed: [], nextCursor: encodeCursor({ through: today }), hasMore: false };
      }
      const from = state.through
        ? isoDay(new Date(dayStart(state.through).getTime() + DAY_MS))
        : isoDay(new Date(dayStart(today).getTime() - (HISTORY_DAYS - 1) * DAY_MS));
      // El último día sincronizado tenía movimientos pendientes: ahora vuelven como "modified" ya contabilizados.
      page = { from, to: today, offset: 0, modifiedDay: state.through };
    }

    const all = generate(payload, institution, page.from, page.to, now);
    const added = all.slice(page.offset, page.offset + PAGE_SIZE);
    const modified =
      page.offset === 0 && page.modifiedDay ? generate(payload, institution, page.modifiedDay, page.modifiedDay, now) : [];
    const hasMore = page.offset + PAGE_SIZE < all.length;

    return {
      added,
      modified,
      removed: [],
      hasMore,
      nextCursor: encodeCursor(
        hasMore ? { through: state.through, page: { ...page, offset: page.offset + PAGE_SIZE, modifiedDay: null } } : { through: today },
      ),
    };
  },

  async getUsageSignals(accessToken) {
    const { institution } = readAccess(accessToken);
    // La señal simulada de uso viene con la tarjeta, que es donde se cobran las suscripciones.
    return institution.accounts.some((tpl) => tpl.profile === "credit_card") ? sandboxUsageSignals() : {};
  },
};
