import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Pruebas de integración contra servicios de verdad que levanta CI (por ahora, un servidor de correo IMAP/SMTP).
// No corren con `npm test`: ver el job «Correo real» en .github/workflows/ci.yml.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(new URL("./tests/support/server-only.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/integration/**/*.int.test.ts"],
    env: { TZ: "UTC" },
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
