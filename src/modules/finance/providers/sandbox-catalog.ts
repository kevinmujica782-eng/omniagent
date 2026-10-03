// Instituciones del sandbox: ficticias y marcadas como "Sandbox" en la UI. Sin dependencias de servidor.
import type { LinkInstitutionView } from "@/types/cards";

export type SandboxProfile = "checking" | "savings" | "credit_card" | "wallet" | "savings_coop";
export type SandboxAccountType = "CHECKING" | "SAVINGS" | "CREDIT_CARD" | "WALLET";
export type InstitutionKind = "bank" | "card" | "wallet" | "coop";

export interface SandboxAccountTemplate {
  id: string;
  name: string;
  type: SandboxAccountType;
  subtype: string;
  profile: SandboxProfile;
  creditLimit?: number;
}

export interface SandboxInstitution {
  id: string;
  name: string;
  kind: InstitutionKind;
  description: string;
  accounts: SandboxAccountTemplate[];
}

export const SANDBOX_INSTITUTIONS: SandboxInstitution[] = [
  {
    id: "ins_ceiba",
    name: "Banco Ceiba",
    kind: "bank",
    description: "Cuenta nómina con tarjeta débito y ahorros",
    accounts: [
      { id: "nomina", name: "Cuenta nómina", type: "CHECKING", subtype: "Cuenta corriente", profile: "checking" },
      { id: "ahorros", name: "Ahorros", type: "SAVINGS", subtype: "Cuenta de ahorro", profile: "savings" },
    ],
  },
  {
    id: "ins_aurora",
    name: "Tarjeta Aurora",
    kind: "card",
    description: "Tarjeta de crédito",
    accounts: [
      { id: "oro", name: "Aurora Oro", type: "CREDIT_CARD", subtype: "Tarjeta de crédito", profile: "credit_card", creditLimit: 5000 },
    ],
  },
  {
    id: "ins_colibri",
    name: "Colibrí Digital",
    kind: "wallet",
    description: "Billetera digital y tarjeta prepagada",
    accounts: [{ id: "billetera", name: "Billetera Colibrí", type: "WALLET", subtype: "Billetera digital", profile: "wallet" }],
  },
  {
    id: "ins_arrayan",
    name: "Cooperativa Arrayán",
    kind: "coop",
    description: "Ahorro programado",
    accounts: [{ id: "programado", name: "Ahorro programado", type: "SAVINGS", subtype: "Cuenta de ahorro", profile: "savings_coop" }],
  },
];

/** Lo que conecta el botón "Probar con datos de ejemplo": cuenta nómina, ahorros y tarjeta de crédito. */
export const DEFAULT_DEMO_INSTITUTIONS = ["ins_ceiba", "ins_aurora"];

export function findSandboxInstitution(id: string): SandboxInstitution | undefined {
  return SANDBOX_INSTITUTIONS.find((institution) => institution.id === id);
}

export function sandboxAccountId(institutionId: string, templateId: string): string {
  return `sbx_${institutionId}_${templateId}`;
}

/** FNV-1a: hash pequeño y determinista para generar datos estables por usuario. */
export function fnvHash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function sandboxMask(userSeed: string, accountId: string): string {
  return String(1000 + (fnvHash(`${userSeed}:${accountId}:mask`) % 9000));
}

/** Instituciones y cuentas tal como las ve el usuario al conectar (con sus últimos 4 dígitos, estables por usuario). */
export function sandboxInstitutionViews(userSeed: string): LinkInstitutionView[] {
  return SANDBOX_INSTITUTIONS.map((institution) => ({
    id: institution.id,
    name: institution.name,
    kind: institution.kind,
    description: institution.description,
    accounts: institution.accounts.map((tpl) => {
      const id = sandboxAccountId(institution.id, tpl.id);
      return {
        id,
        name: tpl.name,
        type: tpl.type,
        subtype: tpl.subtype,
        mask: sandboxMask(userSeed, id),
        creditLimit: tpl.creditLimit ?? null,
      };
    }),
  }));
}
