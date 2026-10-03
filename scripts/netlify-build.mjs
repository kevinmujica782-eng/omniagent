// Compilación en Netlify: `node scripts/netlify-build.mjs` (ver netlify.toml).
//
// Con DB_BOOTSTRAP=1 (variable de compilación), antes de compilar crea o actualiza las tablas en Supabase con
// `prisma db push`. Los poolers compartidos de Supabase tienen varios clústeres por región (aws-0, aws-1...) y un
// proyecto vive en uno solo: si el host de DIRECT_URL responde "Tenant or user not found", se prueban los otros.
// El resultado (host que funcionó y si se crearon las tablas, sin credenciales) queda en /omni-db-host.txt para
// corregir DATABASE_URL. Después de la primera vez, quita DB_BOOTSTRAP.
import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import pg from "pg";

const run = (command, env = {}) => execSync(command, { stdio: "inherit", env: { ...process.env, ...env } });

/** Mensaje de error sin usuario ni contraseña. */
const clean = (message) => String(message).replace(/postgres(?:ql)?:\/\/[^\s@]+@/gi, "postgresql://***@").split("\n")[0].slice(0, 300);

async function tryConnect(url) {
  const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 10_000 });
  try {
    await client.connect();
    await client.query("select 1");
    return null;
  } catch (error) {
    return clean(error instanceof Error ? error.message : error);
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function workingUrl(url) {
  const base = new URL(url);
  const match = /^aws-(\d+)-([a-z0-9-]+)\.pooler\.supabase\.com$/.exec(base.hostname);
  const hosts = match
    ? [base.hostname, ...["0", "1", "2"].filter((n) => n !== match[1]).map((n) => `aws-${n}-${match[2]}.pooler.supabase.com`)]
    : [base.hostname];
  for (const host of hosts) {
    const candidate = new URL(url);
    candidate.hostname = host;
    const error = await tryConnect(candidate.toString());
    console.log(`[omni] ${host}: ${error ?? "conecta"}`);
    if (!error) return candidate.toString();
  }
  return null;
}

if (process.env.DB_BOOTSTRAP === "1") {
  const report = [];
  const direct = process.env.DIRECT_URL ? await workingUrl(process.env.DIRECT_URL) : null;
  report.push(`host: ${direct ? new URL(direct).hostname : "sin conexion"}`);
  if (direct) {
    try {
      run("npx prisma db push", { DIRECT_URL: direct });
      report.push("tablas: ok");
    } catch (error) {
      report.push(`tablas: error ${clean(error instanceof Error ? error.message : error)}`);
    }
  }
  mkdirSync("public", { recursive: true });
  writeFileSync("public/omni-db-host.txt", `${report.join("\n")}\n`);
  console.log(`[omni] ${report.join(" · ")}`);
}

run("npm run build");
