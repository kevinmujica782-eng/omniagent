// Ejecuta un archivo SQL contra DIRECT_URL. Uso: node scripts/db-sql.mjs prisma/sql/supabase-setup.sql
import { readFile } from "node:fs/promises";
import dotenv from "dotenv";
import pg from "pg";

dotenv.config({ path: [".env.local", ".env"], quiet: true });

const file = process.argv[2];
if (!file) {
  console.error("Indica el archivo SQL: node scripts/db-sql.mjs <archivo.sql>");
  process.exit(1);
}

const connectionString = process.env.DIRECT_URL;
if (!connectionString) {
  console.error("Falta DIRECT_URL en .env.local o .env");
  process.exit(1);
}

const sql = await readFile(file, "utf8");
const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });

try {
  await client.connect();
  await client.query(sql);
  console.log(`✔ ${file} aplicado correctamente`);
} catch (error) {
  console.error(`✖ Error aplicando ${file}:`, error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await client.end();
}
