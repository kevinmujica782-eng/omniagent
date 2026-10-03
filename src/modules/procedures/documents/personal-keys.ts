// Catálogo de "Mis datos para formularios" y cómo reconocer cada dato en la etiqueta de un campo.
// Sin dependencias: lo usan el servidor (llenado por reglas) y la UI (formulario de datos).

export interface PersonalKeyDef {
  key: string;
  label: string;
  /** Para quién aplica normalmente: la persona que llena (yo) o un familiar. */
  scope: "self" | "member" | "any";
  placeholder?: string;
}

export const PERSONAL_KEYS: PersonalKeyDef[] = [
  { key: "full_name", label: "Nombre completo", scope: "any", placeholder: "Nombres y apellidos" },
  { key: "phone", label: "Teléfono", scope: "any", placeholder: "Con código de país" },
  { key: "email", label: "Correo", scope: "any" },
  { key: "address", label: "Dirección", scope: "any" },
  { key: "birth_date", label: "Fecha de nacimiento", scope: "any", placeholder: "dd/mm/aaaa" },
  { key: "id_number", label: "Documento de identidad", scope: "any" },
  { key: "school", label: "Colegio", scope: "member" },
  { key: "grade", label: "Grado y sección", scope: "member", placeholder: "3.º B" },
  { key: "allergies", label: "Alergias o condiciones médicas", scope: "any", placeholder: "Ninguna" },
  { key: "emergency_contact", label: "Contacto de emergencia", scope: "any", placeholder: "Nombre y teléfono" },
  { key: "doctor", label: "Médico o pediatra", scope: "any" },
  { key: "insurance_provider", label: "Aseguradora", scope: "any" },
  { key: "insurance_policy", label: "Número de póliza", scope: "any" },
  { key: "employer", label: "Empresa donde trabaja", scope: "any" },
];

export const PERSONAL_KEY_LABEL: Record<string, string> = Object.fromEntries(PERSONAL_KEYS.map((k) => [k.key, k.label]));

export const SELF = "yo";

/** Datos descifrados de una persona del hogar ("yo" o un familiar). */
export interface PersonalRecord {
  person: string;
  relation: string | null;
  values: Record<string, string>;
}

/** Qué dato del catálogo corresponde a una etiqueta, y si se refiere al familiar (estudiante, paciente) o a quien llena. */
export function matchPersonalKey(label: string): { key: string; who: "self" | "member" | "either" } | null {
  const l = label
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
  const member = /(estudiante|alumn|hij|nin|menor|paciente|beneficiari)/.test(l);
  const self = /(padre|madre|acudiente|tutor|representante|asegurado|titular|solicitante|responsable|firmante)/.test(l);
  const who: "self" | "member" | "either" = member ? "member" : self ? "self" : "either";

  if (/emergencia/.test(l)) return { key: "emergency_contact", who: "self" };
  if (/(alergi|condicion(es)? medica|medicamento)/.test(l)) return { key: "allergies", who: member ? "member" : "either" };
  if (/(poliza)/.test(l)) return { key: "insurance_policy", who: "self" };
  if (/(aseguradora|compania de seguros)/.test(l)) return { key: "insurance_provider", who: "self" };
  if (/(medico|pediatra|doctor|centro de salud)/.test(l)) return { key: "doctor", who: "either" };
  if (/(grado|curso|seccion|salon)/.test(l)) return { key: "grade", who: "member" };
  if (/(colegio|escuela|institucion educativa)/.test(l)) return { key: "school", who: "member" };
  if (/(nacimiento)/.test(l)) return { key: "birth_date", who };
  if (/(cedula|documento de identidad|dni|pasaporte n|numero de identificacion|\bid\b)/.test(l)) return { key: "id_number", who };
  if (/(telefono|celular|movil|whatsapp)/.test(l)) return { key: "phone", who: who === "either" ? "self" : who };
  if (/(correo|e-?mail)/.test(l)) return { key: "email", who: who === "either" ? "self" : who };
  if (/(direccion|domicilio)/.test(l)) return { key: "address", who: who === "either" ? "self" : who };
  if (/(empresa|empleador|lugar de trabajo)/.test(l)) return { key: "employer", who: "self" };
  if (/(nombre)/.test(l)) return { key: "full_name", who };
  return null;
}
