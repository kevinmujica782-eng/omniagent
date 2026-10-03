import { z } from "zod";
import { ensureProfile } from "@/lib/auth";
import { Errors } from "@/lib/errors";
import { handle, readJson } from "@/lib/http";
import { deletePerson, getPersonalDataView, upsertPersonalFields } from "@/modules/procedures/documents/personal-data.service";
import { PERSONAL_KEYS } from "@/modules/procedures/documents/personal-keys";

const KEYS = PERSONAL_KEYS.map((k) => k.key) as [string, ...string[]];

const putSchema = z.object({
  /** "yo" o el nombre del familiar. */
  person: z.string().trim().min(1).max(40),
  relation: z.string().trim().max(30).nullable().optional(),
  /** Un valor vacío borra ese dato. */
  fields: z.array(z.object({ key: z.enum(KEYS), value: z.string().max(300) })).min(1).max(20),
});

/** "Mis datos para formularios" (valores descifrados solo para su dueño). */
export async function GET(request: Request) {
  return handle(request, (auth) => getPersonalDataView(auth.userId));
}

export async function PUT(request: Request) {
  return handle(request, async (auth) => {
    const body = await readJson(request, putSchema);
    await ensureProfile(auth);
    await upsertPersonalFields(auth.userId, { person: body.person, relation: body.relation, fields: body.fields, source: "user" });
    return getPersonalDataView(auth.userId);
  });
}

/** DELETE ?person=Sofía borra todos los datos de esa persona. */
export async function DELETE(request: Request) {
  return handle(request, async (auth) => {
    const person = new URL(request.url).searchParams.get("person");
    if (!person) throw Errors.badRequest("Indica de quién borrar los datos.");
    await deletePerson(auth.userId, person);
    return getPersonalDataView(auth.userId);
  });
}
