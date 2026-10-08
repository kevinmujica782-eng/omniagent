// Programa las tareas periódicas de OmniAgent dentro de Supabase (pg_cron + pg_net). Sirve con cualquier
// hosting y con el plan Hobby de Vercel, que solo permite crons diarios: el motor cada minuto; compras, trámites y
// devoluciones cada hora; finanzas cada día. Uso: npm run db:cron   ·   para quitarlas: npm run db:cron -- --remove
//
// Lee de .env.local / .env: DIRECT_URL, CRON_SECRET (el mismo de la app desplegada) y la URL pública
// (CRON_TARGET_URL o NEXT_PUBLIC_APP_URL). La URL y el secreto se guardan cifrados en Supabase Vault: el texto de
// los trabajos solo los nombra. Es idempotente: pg_cron reemplaza un trabajo que se vuelve a crear con su nombre.
import dotenv from "dotenv";
import pg from "pg";

dotenv.config({ path: [".env.local", ".env"], quiet: true });

const JOBS = [
  { name: "omniagent-compras", schedule: "5 * * * *", path: "/api/cron/concierge", what: "compras, cada hora" },
  { name: "omniagent-tramites", schedule: "35 * * * *", path: "/api/cron/procedures", what: "trámites, cada hora" },
  { name: "omniagent-finanzas", schedule: "0 11 * * *", path: "/api/cron/finance", what: "finanzas, cada día 11:00 UTC" },
  { name: "omniagent-devoluciones", schedule: "45 * * * *", path: "/api/cron/returns", what: "devoluciones, cada hora" },
  { name: "omniagent-cobros", schedule: "25 * * * *", path: "/api/cron/billing", what: "vencimientos y avisos de Binance Pay, cada hora" },
  // Motor en segundo plano: lo que quedó en cola, reintentos, aprobaciones vencidas y trabajos a medias.
  { name: "omniagent-motor", schedule: "* * * * *", path: "/api/cron/engine", what: "motor de ejecución autónoma, cada minuto" },
];
const URL_SECRET = "omniagent_app_url";
const CRON_SECRET_NAME = "omniagent_cron_secret";

function fail(message) {
  console.error(`✖ ${message}`);
  process.exit(1);
}

const remove = process.argv.includes("--remove");
const connectionString = process.env.DIRECT_URL;
const appUrl = (process.env.CRON_TARGET_URL || process.env.NEXT_PUBLIC_APP_URL || "").trim().replace(/\/+$/, "");
const secret = process.env.CRON_SECRET;

if (!connectionString) fail("Falta DIRECT_URL en .env.local o .env");
if (!remove) {
  if (!secret) fail("Falta CRON_SECRET: usa el mismo valor que tiene la app desplegada.");
  if (!appUrl.startsWith("https://") || /localhost|127\.0\.0\.1/.test(appUrl)) {
    fail("La URL debe ser la pública HTTPS de la app (CRON_TARGET_URL o NEXT_PUBLIC_APP_URL): Supabase no puede llamar a tu localhost.");
  }
}

/** Comando que corre cada trabajo: lee la URL y el secreto de Vault en el momento de llamar. */
function command(path) {
  return `select net.http_get(
  url := (select decrypted_secret from vault.decrypted_secrets where name = '${URL_SECRET}') || '${path}',
  headers := jsonb_build_object('Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = '${CRON_SECRET_NAME}')),
  timeout_milliseconds := 60000
);`;
}

async function upsertSecret(client, name, value, description) {
  const { rows } = await client.query("select id from vault.secrets where name = $1", [name]);
  if (rows.length) await client.query("select vault.update_secret($1, $2)", [rows[0].id, value]);
  else await client.query("select vault.create_secret($1, $2, $3)", [value, name, description]);
}

// Igual que scripts/db-sql.mjs. Para verificar el certificado de Supabase, añade a DIRECT_URL
// sslmode=verify-full&sslrootcert=<ruta al CA de Supabase>: los parámetros de la URL tienen prioridad.
const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });

try {
  await client.connect();

  if (remove) {
    const { rows } = await client.query(
      "select cron.unschedule(jobname) from cron.job where jobname = any($1::text[])",
      [JOBS.map((job) => job.name)],
    );
    console.log(`✔ Trabajos de OmniAgent quitados: ${rows.length}. Los secretos de Vault se pueden borrar desde el panel.`);
  } else {
    try {
      await client.query("create extension if not exists pg_cron with schema pg_catalog");
      await client.query("create extension if not exists pg_net with schema extensions");
    } catch (error) {
      fail(
        `No se pudieron activar pg_cron y pg_net (${error instanceof Error ? error.message : error}). ` +
          "Actívalas en Supabase → Database → Extensions y vuelve a correr npm run db:cron.",
      );
    }
    await upsertSecret(client, URL_SECRET, appUrl, "URL pública de OmniAgent para las tareas programadas");
    await upsertSecret(client, CRON_SECRET_NAME, secret, "CRON_SECRET de OmniAgent");
    for (const job of JOBS) {
      await client.query("select cron.schedule($1, $2, $3)", [job.name, job.schedule, command(job.path)]);
      console.log(`✔ ${job.name}: ${job.what} → ${appUrl}${job.path}`);
    }
    console.log("\nHistorial:  select * from cron.job_run_details order by start_time desc limit 10;");
    console.log("Respuestas: select status_code, content, created from net._http_response order by created desc limit 10;");
  }
} catch (error) {
  console.error(`✖ ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
} finally {
  await client.end();
}
