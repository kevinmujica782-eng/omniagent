import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { archiveAssistant, createAssistant, listAssistants, updateAssistant } from "@/modules/assistants/assistants.service";
import { listKnowledge, setKnowledge } from "@/modules/knowledge/knowledge.service";

// Dots y conocimiento base contra un Postgres de verdad (lo levanta el job «Base de datos (Postgres)» de CI):
// ejercita el trigger de un solo Dot por defecto, las reglas del servicio y el upsert del conocimiento base.

const userId = randomUUID();

beforeAll(async () => {
  await prisma.profile.create({ data: { id: userId, email: `dots-${userId}@test.local` } });
});

afterAll(async () => {
  // El perfil borra en cascada sus Dots y conocimiento.
  await prisma.profile.delete({ where: { id: userId } }).catch(() => undefined);
});

describe("Dots contra Postgres", () => {
  it("el primer Dot queda por defecto solo; el segundo no", async () => {
    const a = await createAssistant(userId, { name: "Ahorrista", role: "Cuida el bolsillo", personality: "", instructions: "", modules: [], isDefault: false });
    const b = await createAssistant(userId, { name: "Cazador", role: "Busca ofertas", personality: "", instructions: "", modules: ["CONCIERGE"], isDefault: false });
    expect(a.isDefault).toBe(true);
    expect(b.isDefault).toBe(false);
  });

  it("marcar otro por defecto deja exactamente uno (lo hace el trigger)", async () => {
    const list = await listAssistants(userId);
    const cazador = list.find((d) => d.name === "Cazador")!;
    await updateAssistant(userId, cazador.id, { isDefault: true });
    const after = await listAssistants(userId);
    expect(after.filter((d) => d.isDefault).map((d) => d.name)).toEqual(["Cazador"]);
  });

  it("rechaza un nombre repetido para la misma persona", async () => {
    await expect(
      createAssistant(userId, { name: "Cazador", role: "otro", personality: "", instructions: "", modules: [], isDefault: false }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("no deja archivar el Dot por defecto", async () => {
    const list = await listAssistants(userId);
    const def = list.find((d) => d.isDefault)!;
    await expect(archiveAssistant(userId, def.id)).rejects.toBeInstanceOf(AppError);
  });

  it("archiva un Dot no predeterminado y deja de listarlo", async () => {
    const list = await listAssistants(userId);
    const other = list.find((d) => !d.isDefault)!;
    await archiveAssistant(userId, other.id);
    const after = await listAssistants(userId);
    expect(after.some((d) => d.id === other.id)).toBe(false);
  });
});

describe("Conocimiento base contra Postgres", () => {
  it("guarda líneas por categoría y sube la versión al reescribir", async () => {
    const first = await setKnowledge(userId, "FINANCES", ["cobro el día 30", "sin deudas"]);
    expect(first.items).toEqual(["cobro el día 30", "sin deudas"]);
    expect(first.version).toBe(1);

    const second = await setKnowledge(userId, "FINANCES", ["cobro el día 30"]);
    expect(second.items).toEqual(["cobro el día 30"]);
    expect(second.version).toBe(2);

    const all = await listKnowledge(userId);
    const finances = all.find((g) => g.category === "FINANCES")!;
    expect(finances.items).toEqual(["cobro el día 30"]);
    // Las demás categorías existen y están vacías.
    expect(all.find((g) => g.category === "GOALS")!.items).toEqual([]);
  });
});
