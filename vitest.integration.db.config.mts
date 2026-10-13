import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Pruebas de integración contra un Postgres de verdad que levanta CI (job «Base de datos (Postgres)»).
// No corren con `npm test`. Los servicios importan "server-only": se sustituye por un módulo vacío.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(new URL("./tests/support/server-only.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/integration/db/**/*.int.test.ts"],
    // La lectura con IA exige un proveedor configurado; las pruebas usan un lector falso y nunca llaman a la red.
    env: { TZ: "UTC", ANTHROPIC_API_KEY: "sk-ant-solo-pruebas" },
    testTimeout: 60_000,
    hookTimeout: 60_000,
    fileParallelism: false, // comparten la base; sin paralelismo entre archivos
  },
});
