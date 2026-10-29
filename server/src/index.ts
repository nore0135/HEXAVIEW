import { Pool } from "pg";
import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createApp } from "./app.js";
import { AlertWorker } from "./alert-worker.js";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
if (!process.env.ALLOWED_ORIGINS) throw new Error("ALLOWED_ORIGINS is required");

const origins = process.env.ALLOWED_ORIGINS.split(",")
  .map((value) => value.trim())
  .filter(Boolean)
  .map((value) => (value === "*" ? "*" : new URL(value).origin));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 30000,
  statement_timeout: 10000,
});

async function runAutoMigrations(dbPool: Pool) {
  const candidates = [
    resolve(process.cwd(), "..", "db/migrations"),
    resolve(process.cwd(), "db/migrations"),
  ];
  const directory = candidates.find((dir) => existsSync(dir));
  if (!directory) return;

  const client = await dbPool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(7284831)");
    await client.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations(name text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now())",
    );
    const files = (await readdir(directory)).filter((n) => n.endsWith(".sql")).sort();
    for (const name of files) {
      if (name.includes("timeseries") && process.env.SKIP_TIMESCALE === "true") continue;
      if ((await client.query("SELECT 1 FROM schema_migrations WHERE name=$1", [name])).rowCount)
        continue;
      await client.query("BEGIN");
      try {
        await client.query(await readFile(resolve(directory, name), "utf8"));
        await client.query("INSERT INTO schema_migrations(name) VALUES($1)", [name]);
        await client.query("COMMIT");
        console.log(`Applied migration: ${name}`);
      } catch (e) {
        await client.query("ROLLBACK");
        if (name.includes("timeseries")) {
          console.warn(`Skipping optional TimescaleDB migration (${name}) on standard PostgreSQL.`);
          continue;
        }
        throw e;
      }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock(7284831)");
    client.release();
  }
}

if (process.env.AUTO_MIGRATE !== "false") {
  await runAutoMigrations(pool);
}

const worker = new AlertWorker(pool);
const app = await createApp(pool, origins, worker);

if (process.env.DISABLE_ALERT_WORKER !== "true") {
  await worker.start();
}

app.addHook("onClose", async () => {
  worker.stop();
  await pool.end();
});

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, () => {
    void app.close();
  });
}

const defaultHost =
  process.env.RENDER || process.env.RAILWAY_ENVIRONMENT || process.env.DOCKER_CONTAINER
    ? "0.0.0.0"
    : "127.0.0.1";

await app.listen({
  port: Number(process.env.PORT ?? 4000),
  host: process.env.HOST ?? defaultHost,
});
