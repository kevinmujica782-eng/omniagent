import dotenv from "dotenv";
import { defineConfig } from "prisma/config";

// Prisma 7 ya no carga .env por su cuenta. Next.js usa .env.local, así que leemos ambos.
dotenv.config({ path: [".env.local", ".env"], quiet: true });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: {
    // El CLI (migrate, studio) usa la conexión directa o el session pooler (puerto 5432).
    // La app usa DATABASE_URL (transaction pooler, 6543) mediante @prisma/adapter-pg en src/lib/db.ts.
    url: process.env.DIRECT_URL ?? "",
  },
});
