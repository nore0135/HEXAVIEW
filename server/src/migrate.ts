import {Pool} from "pg";
import {readFile,readdir} from "node:fs/promises";
import {resolve} from "node:path";
if(!process.env.DATABASE_URL)throw new Error("DATABASE_URL is required");
const pool=new Pool({connectionString:process.env.DATABASE_URL});const client=await pool.connect();
try {
 await client.query("SELECT pg_advisory_lock(7284831)");
 await client.query("CREATE TABLE IF NOT EXISTS schema_migrations(name text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now())");
 const directory=resolve(process.cwd(),"../db/migrations");
 for(const name of (await readdir(directory)).filter(n=>n.endsWith(".sql")).sort()) {
  if((await client.query("SELECT 1 FROM schema_migrations WHERE name=$1",[name])).rowCount)continue;
  await client.query("BEGIN");try {await client.query(await readFile(resolve(directory,name),"utf8"));await client.query("INSERT INTO schema_migrations(name) VALUES($1)",[name]);await client.query("COMMIT");console.log(`Applied ${name}`);}catch(e){await client.query("ROLLBACK");throw e;}
 }
} finally {await client.query("SELECT pg_advisory_unlock(7284831)");client.release();await pool.end();}
