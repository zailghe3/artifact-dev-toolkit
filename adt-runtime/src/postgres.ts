import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { Pool, type PoolClient, type PoolConfig } from "pg";
import { loadRuntimeRootKey, RuntimeKeyError } from "./runtime-key.js";

const SCHEMA = "adt_runtime";
const INITIALIZATION_LOCK = 1_104_528_373;
const MIGRATION_DIRECTORY = new URL("../migrations/", import.meta.url);

export class RuntimeDatabaseError extends Error {
  constructor(readonly code: "postgres_unavailable" | "postgres_migrations_invalid" | "postgres_installation_invalid") {
    super(code);
  }
}

export function runtimePostgresPool(config: PoolConfig) {
  const pool = new Pool({
    ...config,
    max: 10,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    statement_timeout: 15_000,
    idle_in_transaction_session_timeout: 15_000,
    options: `-c search_path=${SCHEMA}`,
  });
  // An idle connection can fail during a database restart. Subsequent checkouts
  // reconnect and readiness remains tied to a real database query.
  pool.on("error", () => undefined);
  return pool;
}

async function readMigrations(directory: URL) {
  const files = (await readdir(directory)).filter(name => /^\d{4}_[a-z0-9_]+\.sql$/.test(name)).sort();
  if (files.length === 0 || files.some((name, index) => Number(name.slice(0, 4)) !== index + 1)) {
    throw new RuntimeDatabaseError("postgres_migrations_invalid");
  }
  return Promise.all(files.map(async name => {
    const sql = await readFile(new URL(name, directory), "utf8");
    return { name, sql, checksum: createHash("sha256").update(sql).digest("hex") };
  }));
}

export async function inTransaction<T>(pool: Pool, execute: (client: PoolClient) => Promise<T>) {
  const client = await pool.connect();
  let discard = false;
  try {
    await client.query("BEGIN");
    const result = await execute(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      discard = true;
    }
    throw error;
  } finally {
    client.release(discard);
  }
}

export async function initializeRuntimeDatabase(pool: Pool, keyPath: string, directory = MIGRATION_DIRECTORY) {
  const migrations = await readMigrations(directory);
  return inTransaction(pool, async client => {
    await client.query("SELECT pg_advisory_xact_lock($1)", [INITIALIZATION_LOCK]);
    const { rows: [present] } = await client.query<{ present: boolean }>(
      "SELECT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = $1) AS present", [SCHEMA],
    );
    if (!present.present) {
      await client.query("CREATE SCHEMA adt_runtime");
      await client.query(`CREATE TABLE schema_migrations (
        name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now()
      )`);
    }
    const { rows: applied } = await client.query<{name: string; checksum: string}>(
      "SELECT name, checksum FROM schema_migrations ORDER BY name",
    );
    if (present.present && !applied.length) throw new RuntimeDatabaseError("postgres_installation_invalid");
    if (applied.some((value, index) => value.name !== migrations[index]?.name || value.checksum !== migrations[index]?.checksum)) {
      throw new RuntimeDatabaseError("postgres_migrations_invalid");
    }

    const fresh = applied.length === 0;
    const existing = fresh ? undefined : (await client.query<{ root_key_fingerprint: string; active_key_version: number }>(
      "SELECT root_key_fingerprint, active_key_version FROM installation WHERE singleton",
    )).rows[0];
    if (!fresh && !existing) throw new RuntimeDatabaseError("postgres_installation_invalid");
    const rootKey = await loadRuntimeRootKey(keyPath, fresh);
    const fingerprint = rootKey.fingerprint();
    if (existing && existing.root_key_fingerprint !== fingerprint) throw new RuntimeKeyError("root_key_mismatch");

    for (const migration of migrations.slice(applied.length)) {
      await client.query(migration.sql);
      await client.query("INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)", [migration.name, migration.checksum]);
    }
    if (fresh) {
      await client.query("INSERT INTO installation (root_key_fingerprint, active_key_version) VALUES ($1, 1)", [fingerprint]);
    }
    return { rootKey };
  });
}
