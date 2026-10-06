import { beforeEach, describe, expect, it, vi } from "vitest";

// Envío de notificaciones push: a quién se manda, qué se borra y qué se reintenta. Sin red ni base de datos.
const { sendNotification, prismaMock } = vi.hoisted(() => ({
  sendNotification: vi.fn(),
  prismaMock: {
    pushSubscription: {
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
      upsert: vi.fn(),
    },
    appNotification: { findUnique: vi.fn() },
    appSetting: { findUnique: vi.fn(), createMany: vi.fn(), findUniqueOrThrow: vi.fn() },
  },
}));

vi.mock("web-push", () => ({
  sendNotification,
  generateVAPIDKeys: () => ({ publicKey: "BPublicaGenerada", privateKey: "privadaGenerada" }),
}));
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/env", () => ({ env: () => ({ VAPID_PUBLIC_KEY: "BPublica", VAPID_PRIVATE_KEY: "privada" }) }));

import { pushAppNotification, saveSubscription, sendPushToUser, vapidKeys } from "@/modules/notifications/push.service";

function sub(id: string, failures = 0) {
  return { id, userId: "u1", endpoint: `https://push.example/${id}`, p256dh: "p256dh", auth: "auth", failures };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("notificaciones push", () => {
  it("sin aparatos no manda nada", async () => {
    prismaMock.pushSubscription.findMany.mockResolvedValue([]);
    await expect(sendPushToUser("u1", { title: "Hola" })).resolves.toEqual({ sent: 0, removed: 0 });
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it("usa las llaves VAPID de las variables de entorno", async () => {
    await expect(vapidKeys()).resolves.toEqual({ publicKey: "BPublica", privateKey: "privada" });
    expect(prismaMock.appSetting.findUnique).not.toHaveBeenCalled();
  });

  it("borra los aparatos que ya no existen y cuenta los fallos de los demás", async () => {
    prismaMock.pushSubscription.findMany.mockResolvedValue([sub("ok"), sub("gone"), sub("flaky"), sub("dead", 4)]);
    sendNotification.mockImplementation(async (subscription: { endpoint: string }) => {
      if (subscription.endpoint.endsWith("/gone")) throw Object.assign(new Error("Gone"), { statusCode: 410 });
      if (subscription.endpoint.endsWith("/flaky") || subscription.endpoint.endsWith("/dead")) {
        throw Object.assign(new Error("Server error"), { statusCode: 500 });
      }
      return { statusCode: 201 };
    });

    await expect(sendPushToUser("u1", { title: "Bajó el precio" })).resolves.toEqual({ sent: 1, removed: 2 });

    expect(prismaMock.pushSubscription.update).toHaveBeenCalledWith({
      where: { id: "ok" },
      data: { lastSuccessAt: expect.any(Date), failures: 0 },
    });
    expect(prismaMock.pushSubscription.deleteMany).toHaveBeenCalledWith({ where: { id: "gone" } });
    expect(prismaMock.pushSubscription.deleteMany).toHaveBeenCalledWith({ where: { id: "dead" } });
    expect(prismaMock.pushSubscription.updateMany).toHaveBeenCalledWith({ where: { id: "flaky" }, data: { failures: { increment: 1 } } });
  });

  it("recorta el texto, pone la pantalla de inicio por defecto y firma con VAPID", async () => {
    prismaMock.pushSubscription.findMany.mockResolvedValue([sub("ok")]);
    sendNotification.mockResolvedValue({ statusCode: 201 });

    await sendPushToUser("u1", { title: "T".repeat(300), body: "B".repeat(500) });

    const [subscription, payload, options] = sendNotification.mock.calls[0];
    expect(subscription).toEqual({ endpoint: "https://push.example/ok", keys: { p256dh: "p256dh", auth: "auth" } });
    const data = JSON.parse(payload as string);
    expect(data.title).toHaveLength(120);
    expect(data.body).toHaveLength(240);
    expect(data.url).toBe("/inicio");
    expect(options).toMatchObject({ TTL: 86400, vapidDetails: { publicKey: "BPublica", privateKey: "privada" } });
    expect((options as { vapidDetails: { subject: string } }).vapidDetails.subject).toMatch(/^mailto:/);
  });

  it("la notificación de la app llega con su pantalla y su id como etiqueta", async () => {
    prismaMock.appNotification.findUnique.mockResolvedValueOnce(null);
    await expect(pushAppNotification("n0")).resolves.toEqual({ sent: 0, removed: 0 });

    prismaMock.appNotification.findUnique.mockResolvedValueOnce({ id: "n1", userId: "u1", title: "Aprobación pendiente", body: "Revisa la compra", href: "/aprobaciones" });
    prismaMock.pushSubscription.findMany.mockResolvedValue([sub("ok")]);
    sendNotification.mockResolvedValue({ statusCode: 201 });
    await expect(pushAppNotification("n1")).resolves.toEqual({ sent: 1, removed: 0 });
    const data = JSON.parse(sendNotification.mock.calls[0][1] as string);
    expect(data).toEqual({ title: "Aprobación pendiente", body: "Revisa la compra", url: "/aprobaciones", tag: "n1" });
  });

  it("guardar un aparato deja como máximo 10 por persona", async () => {
    prismaMock.pushSubscription.findMany.mockResolvedValue([{ id: "viejo1" }, { id: "viejo2" }]);
    await saveSubscription("u1", { endpoint: "https://push.example/nuevo", keys: { p256dh: "p256dh", auth: "auth" } });
    expect(prismaMock.pushSubscription.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { endpoint: "https://push.example/nuevo" } }));
    expect(prismaMock.pushSubscription.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: "u1" }, skip: 10 }));
    expect(prismaMock.pushSubscription.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ["viejo1", "viejo2"] } } });
  });
});
