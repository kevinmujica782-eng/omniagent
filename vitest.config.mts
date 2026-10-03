import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Pruebas unitarias de las reglas puras (sin base de datos ni red): planes, pagos, panel de Inicio, precios,
// errores y logs. `npm test` las corre una vez; `npm run test:watch` las repite al guardar.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // "server-only" falla fuera de Next a propósito; en las pruebas no hace falta.
      "server-only": fileURLToPath(new URL("./tests/support/server-only.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
    env: { TZ: "UTC" },
  },
});
