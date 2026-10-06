"use client";

import { Bell, BellOff, Download, Loader, Smartphone } from "lucide-react";
import { useEffect, useState } from "react";
import { Panel, buttonClass } from "@/components/ui";
import { apiFetch, errorMessage } from "@/lib/api-client";
import { isNativeApp } from "@/lib/native";

// Instalar OmniAgent como app y activar las notificaciones en este teléfono o navegador.
// Android (Chrome): se instala con un toque. iPhone: «Compartir → Agregar a inicio»; las notificaciones funcionan
// abriendo la app desde ese ícono (iOS 16.4 o más).

type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };
type PushState = "checking" | "unsupported" | "needs-install" | "blocked" | "off" | "on";

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

function isIos(): boolean {
  return /iPhone|iPad|iPod/i.test(navigator.userAgent);
}

function isStandalone(): boolean {
  return window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

async function currentSubscription(): Promise<PushSubscription | null> {
  const registration = await navigator.serviceWorker.getRegistration("/");
  return (await registration?.pushManager.getSubscription()) ?? null;
}

export function AppAndNotifications() {
  const [installEvent, setInstallEvent] = useState<InstallPrompt | null>(null);
  const [installed, setInstalled] = useState(false);
  const [ios, setIos] = useState(false);
  const [push, setPush] = useState<PushState>("checking");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setIos(isIos());
    setInstalled(isStandalone());
    function onPrompt(event: Event) {
      event.preventDefault();
      setInstallEvent(event as InstallPrompt);
    }
    function onInstalled() {
      setInstalled(true);
      setInstallEvent(null);
    }
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);

    const supported = !isNativeApp() && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
    if (!supported) {
      // En iPhone, el navegador no ofrece push hasta que la app se abre desde la pantalla de inicio.
      setPush(isIos() && !isStandalone() ? "needs-install" : "unsupported");
    } else if (Notification.permission === "denied") {
      setPush("blocked");
    } else {
      void currentSubscription()
        .then((sub) => setPush(sub ? "on" : "off"))
        .catch(() => setPush("off"));
    }
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  async function install() {
    if (!installEvent) return;
    await installEvent.prompt();
    const choice = await installEvent.userChoice.catch(() => null);
    if (choice?.outcome === "accepted") setInstalled(true);
    setInstallEvent(null);
  }

  async function enable() {
    setMessage(null);
    setBusy(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setPush(permission === "denied" ? "blocked" : "off");
        return;
      }
      const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      await navigator.serviceWorker.ready;
      const { publicKey } = await apiFetch<{ publicKey: string }>("/api/v1/push/key");
      const subscription =
        (await registration.pushManager.getSubscription()) ??
        (await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) }));
      const json = subscription.toJSON();
      await apiFetch("/api/v1/push/subscriptions", { method: "POST", body: { endpoint: json.endpoint, keys: json.keys } });
      setPush("on");
      setMessage("Listo: este teléfono recibirá los avisos de Omni.");
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setMessage(null);
    setBusy(true);
    try {
      const subscription = await currentSubscription();
      if (subscription) {
        await apiFetch("/api/v1/push/subscriptions", { method: "DELETE", body: { endpoint: subscription.endpoint } }).catch(() => undefined);
        await subscription.unsubscribe();
      }
      setPush("off");
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setMessage(null);
    setBusy(true);
    try {
      const result = await apiFetch<{ sent: number }>("/api/v1/push/test", { method: "POST" });
      setMessage(result.sent > 0 ? "Te mandamos una notificación de prueba." : "No encontramos este aparato: vuelve a activar las notificaciones.");
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel>
      <div className="flex items-start gap-3 p-4">
        <Smartphone className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="font-medium text-ink">App en tu teléfono</p>
          {installed ? (
            <p className="mt-1 text-sm text-muted">Ya la abres como app, desde su ícono.</p>
          ) : installEvent ? (
            <>
              <p className="mt-1 text-sm text-muted">Instálala para abrirla desde su ícono, sin el navegador.</p>
              <button type="button" onClick={install} className={`${buttonClass("primary")} mt-3`}>
                <Download className="size-4" aria-hidden />
                Instalar OmniAgent
              </button>
            </>
          ) : ios ? (
            <p className="mt-1 text-sm text-muted">
              En iPhone: toca <b>Compartir</b> en Safari y luego <b>Agregar a inicio</b>. Abre OmniAgent desde ese ícono.
            </p>
          ) : (
            <p className="mt-1 text-sm text-muted">
              En Android: abre el menú de Chrome (⋮) y toca <b>Instalar app</b> o <b>Agregar a la pantalla principal</b>.
            </p>
          )}
        </div>
      </div>

      <div className="flex items-start gap-3 p-4">
        {push === "on" ? <Bell className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden /> : <BellOff className="mt-0.5 size-5 shrink-0 text-muted" aria-hidden />}
        <div className="min-w-0 flex-1">
          <p className="font-medium text-ink">Notificaciones</p>
          {push === "checking" ? <p className="mt-1 text-sm text-muted">Revisando…</p> : null}
          {push === "unsupported" ? (
            <p className="mt-1 text-sm text-muted">Este navegador no permite notificaciones. Abre OmniAgent en Chrome (Android) o Safari (iPhone).</p>
          ) : null}
          {push === "needs-install" ? (
            <p className="mt-1 text-sm text-muted">En iPhone, primero agrega OmniAgent a la pantalla de inicio y ábrelo desde ese ícono.</p>
          ) : null}
          {push === "blocked" ? (
            <p className="mt-1 text-sm text-muted">Las bloqueaste en este navegador. Actívalas en los ajustes del sitio y vuelve aquí.</p>
          ) : null}
          {push === "off" ? (
            <>
              <p className="mt-1 text-sm text-muted">Te avisamos cuando un precio baja, vence un trámite o algo espera tu visto bueno.</p>
              <button type="button" onClick={enable} disabled={busy} className={`${buttonClass("primary")} mt-3`}>
                {busy ? <Loader className="size-4 animate-spin" aria-hidden /> : <Bell className="size-4" aria-hidden />}
                Activar notificaciones
              </button>
            </>
          ) : null}
          {push === "on" ? (
            <>
              <p className="mt-1 text-sm text-muted">Activadas en este aparato.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" onClick={test} disabled={busy} className={buttonClass("secondary")}>
                  Enviar una de prueba
                </button>
                <button type="button" onClick={disable} disabled={busy} className={buttonClass("ghost")}>
                  Desactivar
                </button>
              </div>
            </>
          ) : null}
          {message ? (
            <p role="status" className="mt-2 text-sm text-muted">
              {message}
            </p>
          ) : null}
        </div>
      </div>
    </Panel>
  );
}
