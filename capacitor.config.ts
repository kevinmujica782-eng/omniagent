import type { CapacitorConfig } from "@capacitor/cli";
import dotenv from "dotenv";

dotenv.config({ path: [".env.local", ".env"], quiet: true });

/**
 * Empaquetado nativo (ver README, sección "App para Android").
 * - Modo hosted (MVP): la app abre la web desplegada (CAP_SERVER_URL), que ya trae SSR, API y sesión.
 *   `mobile/www` solo contiene la pantalla que se ve sin conexión.
 * - Modo bundled (fase 2): cliente estático en `mobile/www` que consume /api/v1 con Bearer JWT.
 */
const serverUrl = process.env.CAP_SERVER_URL;

const config: CapacitorConfig = {
  appId: "com.omniagent.app",
  appName: "OmniAgent",
  webDir: "mobile/www",
  server: serverUrl ? { url: serverUrl, cleartext: false } : undefined,
  android: {
    allowMixedContent: false,
  },
};

export default config;
