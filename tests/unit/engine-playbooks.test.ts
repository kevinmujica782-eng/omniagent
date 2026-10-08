import { describe, expect, it, vi } from "vitest";

// Los playbooks registrados: que cada uno esté bajo su id, que sus pasos quepan en una invocación del servidor y que
// validen lo que reciben. Sin base de datos (los servicios de los módulos no se llaman aquí).

vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@/generated/prisma/client", () => ({ Prisma: { DbNull: "DbNull" } }));

import { STEP_TIMEOUT_MAX_MS } from "@/modules/engine/engine.rules";
import { PLAYBOOKS, findPlaybook } from "@/modules/engine/playbooks";
import { PLAYBOOK_IDS } from "@/types/engine";

describe("motor: playbooks registrados", () => {
  it("cada id tiene su playbook", () => {
    for (const id of PLAYBOOK_IDS) expect(PLAYBOOKS[id].id).toBe(id);
    expect(findPlaybook("borrar.todo")).toBeUndefined();
  });

  it("cada paso cabe en una invocación, se puede reintentar y su llave no se repite", () => {
    for (const playbook of Object.values(PLAYBOOKS)) {
      const keys = playbook.steps.map((step) => step.key);
      expect(new Set(keys).size).toBe(keys.length);
      for (const step of playbook.steps) {
        expect(step.timeoutMs).toBeGreaterThan(0);
        expect(step.timeoutMs).toBeLessThanOrEqual(STEP_TIMEOUT_MAX_MS);
        expect(step.maxAttempts).toBeGreaterThanOrEqual(1);
        expect(step.title.length).toBeGreaterThan(3);
      }
    }
  });

  it("valida lo que recibe y le pone título", () => {
    const website = PLAYBOOKS["website.create"];
    expect(website.input.safeParse({ name: "Dulce Hogar" }).success).toBe(false);
    const brief = website.input.parse({ name: "Dulce Hogar", about: "Repostería casera en Caracas." });
    expect(website.title(brief)).toBe("Crear la página de Dulce Hogar");
    expect(website.activeKey(brief)).toBe("dulce-hogar");

    const update = PLAYBOOKS["website.update"];
    expect(update.input.safeParse({ site: "/s/dulce-hogar-k3x9qa" }).success).toBe(false);
    expect(update.activeKey(update.input.parse({ site: "https://omniagent-app.netlify.app/s/dulce-hogar-k3x9qa", changes: "Pon mi Instagram" }))).toBe(
      "dulce-hogar-k3x9qa",
    );

    expect(PLAYBOOKS["finance.analyze"].title({})).toBe("Analizar tus finanzas");
    expect(PLAYBOOKS["daily.sweep"].steps.map((step) => step.key)).toEqual([
      "finance.sync_accounts",
      "procedures.mail",
      "concierge.prices",
      "returns.orders",
      "summary.today",
    ]);
  });

  it("publicar una página pasa por una aprobación antes de recordarla", () => {
    for (const id of ["website.create", "website.update"] as const) {
      const keys = PLAYBOOKS[id].steps.map((step) => step.key);
      expect(keys.indexOf("sites.review")).toBeLessThan(keys.indexOf("sites.preview"));
      expect(keys.indexOf("sites.preview")).toBeLessThan(keys.indexOf("sites.publish"));
      expect(keys.indexOf("sites.publish")).toBeLessThan(keys.indexOf("sites.memory"));
    }
  });
});
