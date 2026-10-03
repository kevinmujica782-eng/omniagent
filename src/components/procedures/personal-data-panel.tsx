"use client";

import { Loader, Lock, Pencil, Plus, Trash2, UserRound, Users } from "lucide-react";
import { useState, type ChangeEvent, type FormEvent } from "react";
import { Dialog } from "@/components/dialog";
import { IconTile, INPUT_CLASS, buttonClass } from "@/components/ui";
import { apiFetch, errorMessage, sleep } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { PERSONAL_KEYS, SELF } from "@/modules/procedures/documents/personal-keys";
import type { PersonalDataView } from "@/types/cards";

type Person = PersonalDataView["persons"][number];
type Editing = { person: string | null; relation: string | null; isSelf: boolean };

const RELATIONS = ["hija", "hijo", "pareja", "madre", "padre", "abuela", "abuelo", "hermana", "hermano"];

/**
 * "Mis datos para formularios": lo que Omni usa para prellenar permisos, reembolsos y solicitudes,
 * de quien llena y de su familia. Cada valor se guarda cifrado.
 */
export function PersonalDataPanel({ data: initial, demo = false }: { data: PersonalDataView; demo?: boolean }) {
  const [data, setData] = useState(initial);
  const [editing, setEditing] = useState<Editing | null>(null);
  const hasSelf = data.persons.some((p) => p.isSelf);

  return (
    <div className="space-y-3">
      {data.persons.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-line-strong px-4 py-5 text-sm leading-relaxed text-muted">
          Aún no hay datos. Agrega los tuyos y los de tu familia: Omni los usa para llenar formularios en segundos.
        </p>
      ) : null}

      <div className="grid grid-cols-1 items-start gap-3 md:grid-cols-2">
        {data.persons.map((person) => (
          <div key={person.person} className="overflow-hidden rounded-2xl border border-line bg-surface">
            <div className="flex items-center gap-3 px-4 py-3">
              <IconTile icon={person.isSelf ? UserRound : Users} size="sm" tone={person.isSelf ? "primary" : "neutral"} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-ink">{person.isSelf ? "Yo" : person.person}</p>
                <p className="text-xs text-muted">{person.isSelf ? "Quien llena y firma" : (person.relation ?? "Familiar")}</p>
              </div>
              <button
                type="button"
                onClick={() => setEditing({ person: person.person, relation: person.relation, isSelf: person.isSelf })}
                className={buttonClass("ghost", "sm")}
              >
                <Pencil className="size-4" aria-hidden />
                Editar
              </button>
            </div>
            <dl className="grid gap-x-4 gap-y-2 border-t border-line px-4 py-3 text-sm sm:grid-cols-2">
              {person.fields.map((field) => (
                <div key={field.id} className="min-w-0">
                  <dt className="text-xs text-muted">{field.label}</dt>
                  <dd className="break-words text-ink">{field.value}</dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        {!hasSelf ? (
          <button type="button" onClick={() => setEditing({ person: SELF, relation: null, isSelf: true })} className={buttonClass("secondary", "sm")}>
            <Plus className="size-4" aria-hidden />
            Agregar mis datos
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => setEditing({ person: null, relation: null, isSelf: false })}
          className={buttonClass("secondary", "sm")}
        >
          <Plus className="size-4" aria-hidden />
          Agregar familiar
        </button>
      </div>
      <p className="flex items-start gap-1.5 px-1 text-xs leading-relaxed text-muted">
        <Lock className="mt-px size-3.5 shrink-0" aria-hidden />
        Se guarda cifrado. Omni lo usa solo para prellenar formularios que tú revisas antes de enviar; nunca firma por ti.
      </p>

      {editing ? (
        <PersonDialog
          editing={editing}
          current={data.persons.find((p) => p.person === editing.person) ?? null}
          all={data}
          demo={demo}
          onClose={() => setEditing(null)}
          onSaved={(next) => {
            setData(next);
            setEditing(null);
          }}
        />
      ) : null}
    </div>
  );
}

/** Vista previa: aplica el cambio en memoria (sin API). */
function mergeLocal(all: PersonalDataView, person: string, relation: string | null, fields: { key: string; value: string }[], remove = false): PersonalDataView {
  if (remove) return { persons: all.persons.filter((p) => p.person !== person) };
  const existing = all.persons.find((p) => p.person === person);
  const base: Person = existing ?? { person, relation, isSelf: person === SELF, fields: [] };
  const byKey = new Map(base.fields.map((f) => [f.key, f]));
  for (const field of fields) {
    if (!field.value) byKey.delete(field.key);
    else {
      const label = PERSONAL_KEYS.find((k) => k.key === field.key)?.label ?? field.key;
      byKey.set(field.key, { id: byKey.get(field.key)?.id ?? `demo-${person}-${field.key}`, key: field.key, label, value: field.value, source: "user" });
    }
  }
  const updated: Person = { ...base, relation: person === SELF ? null : relation, fields: [...byKey.values()] };
  const persons = existing ? all.persons.map((p) => (p.person === person ? updated : p)) : [...all.persons, updated];
  return { persons };
}

function PersonDialog({
  editing,
  current,
  all,
  demo,
  onClose,
  onSaved,
}: {
  editing: Editing;
  current: Person | null;
  all: PersonalDataView;
  demo: boolean;
  onClose: () => void;
  onSaved: (data: PersonalDataView) => void;
}) {
  const isNew = editing.person === null;
  const keys = PERSONAL_KEYS.filter((k) => (editing.isSelf ? k.scope !== "member" : true));
  const initialValues = Object.fromEntries(keys.map((k) => [k.key, current?.fields.find((f) => f.key === k.key)?.value ?? ""]));
  const [name, setName] = useState(isNew ? "" : (editing.person ?? ""));
  const [relation, setRelation] = useState(editing.relation ?? "");
  const [values, setValues] = useState<Record<string, string>>(initialValues);
  const [busy, setBusy] = useState<"save" | "delete" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function save() {
    const person = editing.isSelf ? SELF : name.trim();
    if (!person) {
      setError("Escribe el nombre de tu familiar.");
      return;
    }
    const fields = keys
      .filter((k) => values[k.key] !== initialValues[k.key] || (isNew && values[k.key].trim()))
      .map((k) => ({ key: k.key, value: values[k.key].trim() }));
    if (fields.length === 0 && relation === (editing.relation ?? "")) {
      onClose();
      return;
    }
    setBusy("save");
    setError(null);
    try {
      if (demo) {
        await sleep(400);
        onSaved(mergeLocal(all, person, editing.isSelf ? null : relation.trim() || null, fields));
        return;
      }
      const body = {
        person,
        relation: editing.isSelf ? null : relation.trim() || null,
        // Si solo cambió el parentesco, se reenvía el nombre para que la llamada tenga al menos un dato.
        fields: fields.length > 0 ? fields : [{ key: "full_name", value: values.full_name?.trim() || person }],
      };
      onSaved(await apiFetch<PersonalDataView>("/api/v1/procedures/personal-data", { method: "PUT", body }));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (!editing.person) return;
    setBusy("delete");
    setError(null);
    try {
      if (demo) {
        await sleep(400);
        onSaved(mergeLocal(all, editing.person, null, [], true));
        return;
      }
      onSaved(
        await apiFetch<PersonalDataView>(`/api/v1/procedures/personal-data?person=${encodeURIComponent(editing.person)}`, {
          method: "DELETE",
        }),
      );
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  const title = editing.isSelf ? "Mis datos" : isNew ? "Nuevo familiar" : `Datos de ${editing.person}`;
  return (
    <Dialog title={title} onClose={onClose} closable={busy === null}>
      <form
        onSubmit={(event: FormEvent<HTMLFormElement>) => {
          event.preventDefault();
          void save();
        }}
        className="space-y-4"
      >
        {!editing.isSelf ? (
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-sm font-medium text-ink">Nombre</span>
              <input
                value={name}
                onChange={(event: ChangeEvent<HTMLInputElement>) => setName(event.target.value)}
                disabled={!isNew}
                maxLength={40}
                placeholder="Sofía"
                className={cn(INPUT_CLASS, "mt-1.5")}
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-ink">Parentesco</span>
              <input
                value={relation}
                onChange={(event: ChangeEvent<HTMLInputElement>) => setRelation(event.target.value)}
                list="omni-relations"
                maxLength={30}
                placeholder="hija"
                className={cn(INPUT_CLASS, "mt-1.5")}
              />
              <datalist id="omni-relations">
                {RELATIONS.map((r) => (
                  <option key={r} value={r} />
                ))}
              </datalist>
            </label>
          </div>
        ) : null}

        {keys.map((key) => (
          <label key={key.key} className="block">
            <span className="text-sm font-medium text-ink">{key.label}</span>
            <input
              value={values[key.key] ?? ""}
              onChange={(event: ChangeEvent<HTMLInputElement>) => setValues((prev) => ({ ...prev, [key.key]: event.target.value }))}
              maxLength={300}
              placeholder={key.placeholder}
              className={cn(INPUT_CLASS, "mt-1.5")}
            />
          </label>
        ))}

        {error ? (
          <p role="alert" className="rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">
            {error}
          </p>
        ) : null}

        <div className="flex flex-col gap-2 pt-2">
          <button type="submit" disabled={busy !== null} className={cn(buttonClass("primary", "lg"), "w-full")}>
            {busy === "save" ? <Loader className="size-4 animate-spin" aria-hidden /> : null}
            Guardar
          </button>
          {!isNew && !editing.isSelf ? (
            confirmDelete ? (
              <div className="flex items-center justify-center gap-3 text-sm">
                <button type="button" onClick={remove} disabled={busy !== null} className="font-semibold text-danger hover:underline">
                  {busy === "delete" ? "Borrando…" : `Sí, borrar a ${editing.person}`}
                </button>
                <button type="button" onClick={() => setConfirmDelete(false)} className="text-muted hover:text-ink">
                  Cancelar
                </button>
              </div>
            ) : (
              <button type="button" onClick={() => setConfirmDelete(true)} className={cn(buttonClass("ghost", "sm"), "mx-auto text-danger")}>
                <Trash2 className="size-4" aria-hidden />
                Borrar a {editing.person}
              </button>
            )
          ) : null}
        </div>
      </form>
    </Dialog>
  );
}
