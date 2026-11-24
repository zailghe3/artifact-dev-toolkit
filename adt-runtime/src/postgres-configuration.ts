import type { PoolConfig } from "pg";
import { secretValue } from "./protocol.js";

export function readRuntimePostgresConfiguration(env = process.env): { pool: PoolConfig; keyPath: string } {
  const { ADT_RUNTIME_DB_HOST: host, ADT_RUNTIME_DB_NAME: database, ADT_RUNTIME_DB_USER: user,
    ADT_RUNTIME_DB_PORT: portValue, ADT_RUNTIME_ROOT_KEY_FILE: keyPath } = env;
  const hasPassword = Boolean(env.ADT_RUNTIME_DB_PASSWORD || env.ADT_RUNTIME_DB_PASSWORD_FILE);
  if (!host && !database && !user && !portValue && !keyPath && !hasPassword) throw new Error("postgres_configuration_missing");
  const port = Number(portValue ?? "5432");
  if (!host?.trim() || !database?.trim() || !user?.trim() || !keyPath?.trim() || !hasPassword || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("postgres_configuration_invalid");
  }
  let password: string;
  try {
    password = secretValue("ADT_RUNTIME_DB_PASSWORD", env);
  } catch {
    throw new Error("postgres_configuration_invalid");
  }
  return { pool: { host, database, user, port, password }, keyPath };
}
