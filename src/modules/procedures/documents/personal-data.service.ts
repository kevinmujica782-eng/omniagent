import "server-only";
import { audit } from "@/lib/audit";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { prisma } from "@/lib/db";
import { Errors } from "@/lib/errors";
import { isUuid } from "@/lib/validation";
import type { PersonalDataView } from "@/types/cards";
import { PERSONAL_KEY_LABEL, SELF, type PersonalRecord } from "./personal-keys";

// "Mis datos para formularios": lo que Omni usa para rellenar permisos y solicitudes.
// Cada valor se guarda cifrado (AES-256-GCM); solo el servidor lo descifra al mostrarlo o al rellenar.

function normalizePerson(person: string): string {
  const trimmed = person.trim().replace(/\s+/g, " ");
  return !trimmed || /^(yo|mi|m[ií]|self|titular)$/i.test(trimmed) ? SELF : trimmed.slice(0, 40);
}

/** Datos descifrados por persona (para el llenado y para el prompt). */
export async function loadPersonalRecords(userId: string): Promise<PersonalRecord[]> {
  const rows = await prisma.personalField.findMany({ where: { userId }, orderBy: [{ person: "asc" }, { createdAt: "asc" }] });
  const byPerson = new Map<string, PersonalRecord>();
  for (const row of rows) {
    let value: string;
    try {
      value = decryptSecret(row.valueEncrypted);
    } catch {
      continue; // clave rotada o dato dañado: se ignora
    }
    const record = byPerson.get(row.person) ?? { person: row.person, relation: row.relation, values: {} };
    record.values[row.fieldKey] = value;
    record.relation ??= row.relation;
    byPerson.set(row.person, record);
  }
  // "yo" primero
  return [...byPerson.values()].sort((a, b) => (a.person === SELF ? -1 : b.person === SELF ? 1 : a.person.localeCompare(b.person)));
}

export async function getPersonalDataView(userId: string): Promise<PersonalDataView> {
  const rows = await prisma.personalField.findMany({ where: { userId }, orderBy: [{ person: "asc" }, { createdAt: "asc" }] });
  const persons = new Map<string, PersonalDataView["persons"][number]>();
  for (const row of rows) {
    let value: string;
    try {
      value = decryptSecret(row.valueEncrypted);
    } catch {
      continue;
    }
    const entry = persons.get(row.person) ?? { person: row.person, relation: row.relation, isSelf: row.person === SELF, fields: [] };
    entry.fields.push({ id: row.id, key: row.fieldKey, label: row.label, value, source: row.source });
    persons.set(row.person, entry);
  }
  return {
    persons: [...persons.values()].sort((a, b) => (a.isSelf ? -1 : b.isSelf ? 1 : a.person.localeCompare(b.person))),
  };
}

export async function upsertPersonalFields(
  userId: string,
  input: { person: string; relation?: string | null; fields: { key: string; value: string; label?: string }[]; source?: "user" | "form" | "demo" },
): Promise<number> {
  const person = normalizePerson(input.person);
  let saved = 0;
  for (const field of input.fields) {
    const key = field.key.trim().toLowerCase().replace(/[^a-z0-9_]/g, "_").slice(0, 40);
    const value = field.value.trim().slice(0, 300);
    if (!key) continue;
    if (!value) {
      await prisma.personalField.deleteMany({ where: { userId, person, fieldKey: key } });
      continue;
    }
    const label = (field.label ?? PERSONAL_KEY_LABEL[key] ?? key).slice(0, 80);
    await prisma.personalField.upsert({
      where: { userId_person_fieldKey: { userId, person, fieldKey: key } },
      create: {
        userId,
        person,
        relation: input.relation ?? null,
        fieldKey: key,
        label,
        valueEncrypted: encryptSecret(value),
        source: input.source ?? "user",
      },
      update: {
        label,
        valueEncrypted: encryptSecret(value),
        source: input.source ?? "user",
        ...(input.relation !== undefined ? { relation: input.relation } : {}),
      },
    });
    saved++;
  }
  if (input.relation !== undefined && person !== SELF) {
    await prisma.personalField.updateMany({ where: { userId, person }, data: { relation: input.relation } });
  }
  await audit({ userId, actor: "user", action: "personal_data.updated", metadata: { person: person === SELF ? SELF : "familiar", fields: saved } });
  return saved;
}

export async function deletePersonalField(userId: string, id: string) {
  if (!isUuid(id)) throw Errors.notFound("El dato");
  const removed = await prisma.personalField.deleteMany({ where: { id, userId } });
  if (removed.count === 0) throw Errors.notFound("El dato");
  return { removed: true };
}

export async function deletePerson(userId: string, person: string) {
  const removed = await prisma.personalField.deleteMany({ where: { userId, person: normalizePerson(person) } });
  return { removed: removed.count };
}

/** Datos de ejemplo para la bandeja de prueba (solo si el usuario no tiene datos guardados). */
export async function seedDemoPersonalData(userId: string, fullName: string | null, email: string | null) {
  const existing = await prisma.personalField.count({ where: { userId } });
  if (existing > 0) return false;
  await upsertPersonalFields(userId, {
    person: SELF,
    source: "demo",
    fields: [
      { key: "full_name", value: fullName ?? "Laura Gómez Rivas" },
      { key: "phone", value: "+1 305 555 0142" },
      { key: "email", value: email ?? "laura@ejemplo.com" },
      { key: "address", value: "Calle Los Cedros 118, apto. 4B" },
      { key: "emergency_contact", value: "Andrés Gómez · +1 305 555 0178" },
      { key: "insurance_provider", value: "Seguros Horizonte" },
      { key: "insurance_policy", value: "SH-2026-004417" },
    ],
  });
  await upsertPersonalFields(userId, {
    person: "Sofía",
    relation: "hija",
    source: "demo",
    fields: [
      { key: "full_name", value: "Sofía Gómez Rivas" },
      { key: "school", value: "Colegio Los Pinos" },
      { key: "grade", value: "3.º B" },
      { key: "allergies", value: "Ninguna" },
      { key: "birth_date", value: "14/03/2018" },
      { key: "doctor", value: "Dr. Tomás Ibarra (pediatra)" },
    ],
  });
  return true;
}
