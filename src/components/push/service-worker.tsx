"use client";

import { useEffect } from "react";
import { isNativeApp } from "@/lib/native";

/** Registra el service worker (/sw.js) que muestra las notificaciones push. Dentro de la app vieja de Capacitor no aplica. */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (isNativeApp() || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => undefined);
  }, []);
  return null;
}
