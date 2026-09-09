import { createHash, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import {
  access, constants, copyFile, lstat, mkdir, mkdtemp, open, readFile,
  readdir, realpath, rename, rm, stat, writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import type { RunnerConfiguration } from "./configuration.js";
import { SafeError } from "./errors.js";

export const BACKUP_ID = /^b-[0-9]{8}T[0-9]{6}Z-[a-f0-9]{12}$/;
export const DATABASE_FILENAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.(?:sqlite|db)$/i;
const MANIFEST = "manifest.json";
const BOOTSTRAP_MARKER = ".adt-bootstrap-v1";
const BACKUP_SCHEMA = 1;
const MAX_DATABASES = 64;
const MAX_DATABASE_SIZE = 16 * 1024 * 1024 * 1024;

export type FilesystemClass = "local" | "network" | "unknown";
export type StorageFailure = "no_sqlite_databases" | "sqlite_backup_failed" | "backup_verification_failed";
export interface BackupMetadata {
  backupId: string;
  createdAt: string;
  runnerVersion: string;
  codexVersion: string;
  databases: { filename: string; size: number; sha256: string }[];
}
export interface SqliteStorageStatus {
  separateSqliteHomeConfigured: boolean;
  sqliteFilesystemClass: FilesystemClass;
  sqliteHomeReadable: boolean;
  sqliteHomeWritable: boolean;
  codexHomeFilesystemClass: FilesystemClass;
  backupDirectoryAvailable: boolean;
  backupDirectoryWritable: boolean;
  lastSuccessfulBackupAt?: string;
  lastBackupFailureCategory?: StorageFailure;
  latestBackupId?: string;
  retainedBackupCount: number;
  retention: number;
  operation: "idle" | "backup" | "restore";
  warning?: "network_filesystem_unsupported_for_sqlite" | "sqlite_home_not_separated";
}

type Mount = { mountPoint: string; filesystemType: string };
export function parseMountInfo(text: string): Mount[] {
  return text.split("\n").flatMap((line) => {
    const fields = line.split(" ");
    const separator = fields.indexOf("-");
    if (separator < 0 || !fields[4] || !fields[separator + 1]) return [];
    return [{ mountPoint: fields[4].replace(/\\040/g, " "), filesystemType: fields[separator + 1]! }];
  });
}
export function classifyFilesystem(path: string, mounts: Mount[]): FilesystemClass {
  const mount = mounts
    .filter((item) => path === item.mountPoint || path.startsWith(`${item.mountPoint.replace(/\/$/, "")}/`))
    .sort((a, b) => b.mountPoint.length - a.mountPoint.length)[0];
  if (!mount) return "unknown";
  return /^(nfs|nfs4|cifs|smb|smbfs|9p|ceph|glusterfs|fuse\.sshfs)$/i.test(mount.filesystemType) ? "network" : "local";
}

async function usable(path: string, mode: number) {
  try { await access(path, mode); return true; } catch { return false; }
}
async function databases(path: string) {
  try {
    return (await readdir(path, { withFileTypes: true }))
      .filter((item) => item.isFile() && DATABASE_FILENAME.test(item.name))
      .map((item) => item.name)
      .sort()
      .slice(0, MAX_DATABASES + 1);
  } catch { return []; }
}
async function checksum(path: string) {
  const handle = await open(path, "r");
  const hash = createHash("sha256");
  try { for await (const chunk of handle.readableWebStream()) hash.update(Buffer.from(chunk)); }
  finally { await handle.close(); }
  return hash.digest("hex");
}
async function sqliteBackup(source: string, destination: string) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn("sqlite3", [source, `.backup ${JSON.stringify(destination)}`], { stdio: ["ignore", "ignore", "ignore"] });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error("sqlite_backup_failed")));
  });
}
async function safeBackupDirectory(root: string, id: string) {
  if (!BACKUP_ID.test(id)) throw new SafeError("invalid_backup_id", 400);
  const rootReal = await realpath(root);
  const candidate = join(root, id);
  const entry = await lstat(candidate).catch(() => undefined);
  if (!entry?.isDirectory() || entry.isSymbolicLink()) throw new SafeError("backup_not_found", 404);
  const resolved = await realpath(candidate);
  if (dirname(resolved) !== rootReal) throw new SafeError("invalid_backup_id", 400);
  return resolved;
}
function exactKeys(value: Record<string, unknown>, required: string[], optional: string[] = []) {
  return required.every((key) => Object.hasOwn(value, key)) && Object.keys(value).every((key) => required.includes(key) || optional.includes(key));
}
function validTimestamp(value: unknown) { return typeof value === "string" && value.length <= 32 && Number.isFinite(Date.parse(value)); }
export function parseBackupMetadata(value: unknown, expectedId?: string): BackupMetadata {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid_backup");
  const item = value as Record<string, unknown>;
  if (!exactKeys(item, ["backupId", "createdAt", "runnerVersion", "codexVersion", "databases"], ["schemaVersion"]) ||
      !BACKUP_ID.test(String(item.backupId)) || (expectedId && item.backupId !== expectedId) || !validTimestamp(item.createdAt) ||
      typeof item.runnerVersion !== "string" || item.runnerVersion.length > 64 ||
      typeof item.codexVersion !== "string" || !/^\d+\.\d+\.\d+$/.test(item.codexVersion) ||
      !Array.isArray(item.databases) || item.databases.length < 1 || item.databases.length > MAX_DATABASES) throw new Error("invalid_backup");
  const seen = new Set<string>();
  const parsed = item.databases.map((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("invalid_backup");
    const database = raw as Record<string, unknown>;
    if (!exactKeys(database, ["filename", "size", "sha256"]) || !DATABASE_FILENAME.test(String(database.filename)) ||
        seen.has(String(database.filename)) || !Number.isSafeInteger(database.size) || Number(database.size) < 0 ||
        Number(database.size) > MAX_DATABASE_SIZE || typeof database.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(database.sha256)) throw new Error("invalid_backup");
    seen.add(String(database.filename));
    return { filename: String(database.filename), size: Number(database.size), sha256: database.sha256 };
  });
  return { backupId: String(item.backupId), createdAt: String(item.createdAt), runnerVersion: item.runnerVersion, codexVersion: item.codexVersion, databases: parsed };
}

export interface BootstrapOperations {
  copyFile: typeof copyFile;
  rename: typeof rename;
  writeFile: typeof writeFile;
}
const defaultBootstrapOperations: BootstrapOperations = { copyFile, rename, writeFile };

/** App Server from the previous deployment must be stopped before this copy begins. */
export async function bootstrapLegacySqlite(config: RunnerConfiguration, operations: BootstrapOperations = defaultBootstrapOperations) {
  if (!config.sqliteHome) return;
  await mkdir(config.sqliteHome, { recursive: true, mode: 0o700 });
  const marker = join(config.sqliteHome, BOOTSTRAP_MARKER);
  const existing = await databases(config.sqliteHome);
  if (existing.length) return;
  if (await readFile(marker, "utf8").then((value) => value === "legacy-copy-complete\n" || value === "empty\n", () => false)) return;
  const legacy = await databases(config.codexHome);
  if (legacy.length > MAX_DATABASES) throw new Error("sqlite_bootstrap_failed");
  if (!legacy.length) { await operations.writeFile(marker, "empty\n", { mode: 0o600, flag: "wx" }); return; }
  const stage = await mkdtemp(join(dirname(config.sqliteHome), ".adt-sqlite-bootstrap-"));
  const promoted: string[] = [];
  const stagedNames: string[] = [];
  try {
    for (const name of legacy) {
      for (const suffix of ["", "-wal", "-shm"]) {
        const source = join(config.codexHome, `${name}${suffix}`);
        if (await usable(source, constants.R_OK)) {
          const stagedName = `${name}${suffix}`;
          await operations.copyFile(source, join(stage, stagedName), constants.COPYFILE_EXCL);
          stagedNames.push(stagedName);
        }
      }
    }
    for (const name of stagedNames) {
      await operations.rename(join(stage, name), join(config.sqliteHome, name));
      promoted.push(name);
    }
    const stagedMarker = join(stage, BOOTSTRAP_MARKER);
    await operations.writeFile(stagedMarker, "legacy-copy-complete\n", { mode: 0o600, flag: "wx" });
    await operations.rename(stagedMarker, marker);
    promoted.push(BOOTSTRAP_MARKER);
  } catch {
    for (const name of promoted.reverse()) await rm(join(config.sqliteHome, name), { force: true }).catch(() => undefined);
    throw new Error("sqlite_bootstrap_failed");
  } finally { await rm(stage, { recursive: true, force: true }); }
}

export class SqliteStorageManager {
  private operation: SqliteStorageStatus["operation"] = "idle";
  private lastFailure?: StorageFailure;
  private timer?: NodeJS.Timeout;
  constructor(private readonly config: RunnerConfiguration, private readonly codexVersion: string) {}

  async initialize() {
    if (!this.config.sqliteHome) return;
    await mkdir(this.config.sqliteHome, { recursive: true, mode: 0o700 });
    const mounts = parseMountInfo(await readFile("/proc/self/mountinfo", "utf8").catch(() => ""));
    if (classifyFilesystem(this.config.sqliteHome, mounts) === "network") throw new Error("network_filesystem_unsupported_for_sqlite");
    await bootstrapLegacySqlite(this.config);
  }
  startScheduler() {
    if (!this.config.sqliteHome) return;
    this.timer = setInterval(() => void this.createBackup().catch(() => undefined), this.config.sqliteBackupIntervalMs);
    this.timer.unref();
  }
  stopScheduler() { if (this.timer) clearInterval(this.timer); }

  async list(): Promise<BackupMetadata[]> {
    await mkdir(this.config.sqliteBackupRoot, { recursive: true, mode: 0o700 });
    const entries = await readdir(this.config.sqliteBackupRoot, { withFileTypes: true });
    const result: BackupMetadata[] = [];
    for (const entry of entries.slice(0, 1_000)) {
      if (!entry.isDirectory() || !BACKUP_ID.test(entry.name)) continue;
      try {
        const directory = await safeBackupDirectory(this.config.sqliteBackupRoot, entry.name);
        const raw = JSON.parse(await readFile(join(directory, MANIFEST), "utf8"));
        if (raw.schemaVersion !== BACKUP_SCHEMA) continue;
        result.push(parseBackupMetadata(raw, entry.name));
      } catch { /* Incomplete and invalid sets are never advertised. */ }
    }
    return result.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 365);
  }
  async status(): Promise<SqliteStorageStatus> {
    const mounts = parseMountInfo(await readFile("/proc/self/mountinfo", "utf8").catch(() => ""));
    const sqlitePath = this.config.sqliteHome ?? this.config.codexHome;
    const sqliteFilesystemClass = classifyFilesystem(sqlitePath, mounts);
    const backups = await this.list().catch(() => []);
    return {
      separateSqliteHomeConfigured: Boolean(this.config.sqliteHome), sqliteFilesystemClass,
      sqliteHomeReadable: await usable(sqlitePath, constants.R_OK), sqliteHomeWritable: await usable(sqlitePath, constants.W_OK),
      codexHomeFilesystemClass: classifyFilesystem(this.config.codexHome, mounts),
      backupDirectoryAvailable: await usable(this.config.sqliteBackupRoot, constants.R_OK),
      backupDirectoryWritable: await usable(this.config.sqliteBackupRoot, constants.W_OK),
      ...(backups[0] ? { lastSuccessfulBackupAt: backups[0].createdAt, latestBackupId: backups[0].backupId } : {}),
      ...(this.lastFailure ? { lastBackupFailureCategory: this.lastFailure } : {}),
      retainedBackupCount: backups.length, retention: this.config.sqliteBackupRetention, operation: this.operation,
      ...(sqliteFilesystemClass === "network" ? { warning: "network_filesystem_unsupported_for_sqlite" as const } :
        !this.config.sqliteHome ? { warning: "sqlite_home_not_separated" as const } : {}),
    };
  }
  async createBackup(): Promise<BackupMetadata> {
    if (!this.config.sqliteHome) throw new SafeError("sqlite_home_not_configured", 409);
    if (this.operation !== "idle") throw new SafeError("runner_busy", 409);
    this.operation = "backup";
    let local: string | undefined;
    let durableStage: string | undefined;
    try {
      const names = await databases(this.config.sqliteHome);
      if (!names.length || names.length > MAX_DATABASES) throw new Error("no_sqlite_databases");
      local = await mkdtemp(join(tmpdir(), "adt-sqlite-backup-"));
      const createdAt = new Date().toISOString();
      const backupId = `b-${createdAt.replace(/[-:]/g, "").replace(/\.\d{3}/, "")}-${randomBytes(6).toString("hex")}`;
      for (const name of names) await sqliteBackup(join(this.config.sqliteHome, name), join(local, name));
      const records = [];
      for (const name of names) {
        const file = await stat(join(local, name));
        if (file.size > MAX_DATABASE_SIZE) throw new Error("sqlite_backup_failed");
        records.push({ filename: name, size: file.size, sha256: await checksum(join(local, name)) });
      }
      const manifest = { schemaVersion: BACKUP_SCHEMA, backupId, createdAt, runnerVersion: this.config.runnerVersion, codexVersion: this.codexVersion, databases: records };
      await mkdir(this.config.sqliteBackupRoot, { recursive: true, mode: 0o700 });
      durableStage = join(this.config.sqliteBackupRoot, `.staging-${backupId}`);
      await mkdir(durableStage, { mode: 0o700 });
      for (const record of records) {
        await copyFile(join(local, record.filename), join(durableStage, record.filename), constants.COPYFILE_EXCL);
        if (await checksum(join(durableStage, record.filename)) !== record.sha256) throw new Error("backup_verification_failed");
      }
      await writeFile(join(durableStage, MANIFEST), `${JSON.stringify(manifest)}\n`, { mode: 0o600, flag: "wx" });
      await rename(durableStage, join(this.config.sqliteBackupRoot, backupId));
      durableStage = undefined;
      this.lastFailure = undefined;
      await this.prune();
      return parseBackupMetadata(manifest, backupId);
    } catch (error) {
      const category = error instanceof Error && ["no_sqlite_databases", "sqlite_backup_failed", "backup_verification_failed"].includes(error.message) ? error.message as StorageFailure : "sqlite_backup_failed";
      this.lastFailure = category;
      throw new SafeError("sqlite_backup_failed", 503);
    } finally {
      if (local) await rm(local, { recursive: true, force: true });
      if (durableStage) await rm(durableStage, { recursive: true, force: true });
      this.operation = "idle";
    }
  }
  private async prune() {
    for (const backup of (await this.list()).slice(this.config.sqliteBackupRetention))
      await rm(await safeBackupDirectory(this.config.sqliteBackupRoot, backup.backupId), { recursive: true });
  }
  async restore(id: string | "latest", hooks: { closeAndWait: () => Promise<void>; ready: () => Promise<boolean> }) {
    if (!this.config.sqliteHome) throw new SafeError("sqlite_home_not_configured", 409);
    if (this.operation !== "idle") throw new SafeError("runner_busy", 409);
    this.operation = "restore";
    let safety: string | undefined;
    let stage: string | undefined;
    let movedCurrent = false;
    try {
      const selected = id === "latest" ? (await this.list())[0]?.backupId : id;
      if (!selected) throw new SafeError("backup_not_found", 404);
      const directory = await safeBackupDirectory(this.config.sqliteBackupRoot, selected);
      const raw = JSON.parse(await readFile(join(directory, MANIFEST), "utf8"));
      if (raw.schemaVersion !== BACKUP_SCHEMA) throw new SafeError("invalid_backup", 409);
      const manifest = parseBackupMetadata(raw, selected);
      for (const database of manifest.databases) {
        const source = join(directory, database.filename);
        if (await checksum(source) !== database.sha256 || (await stat(source)).size !== database.size) throw new SafeError("invalid_backup", 409);
      }
      stage = await mkdtemp(join(dirname(this.config.sqliteHome), ".adt-restore-"));
      for (const database of manifest.databases) await copyFile(join(directory, database.filename), join(stage, database.filename), constants.COPYFILE_EXCL);
      await hooks.closeAndWait();
      safety = await mkdtemp(join(dirname(this.config.sqliteHome), ".adt-pre-restore-"));
      for (const name of await readdir(this.config.sqliteHome)) {
        if (DATABASE_FILENAME.test(name) || name.endsWith("-wal") || name.endsWith("-shm")) await rename(join(this.config.sqliteHome, name), join(safety, name));
      }
      movedCurrent = true;
      for (const database of manifest.databases) await rename(join(stage, database.filename), join(this.config.sqliteHome, database.filename));
      if (!await hooks.ready()) throw new Error("restore_readiness_failed");
      return { backupId: selected, rollbackOccurred: false };
    } catch (error) {
      if (movedCurrent && safety) {
        await hooks.closeAndWait().catch(() => undefined);
        for (const name of await readdir(this.config.sqliteHome).catch(() => [])) {
          if (DATABASE_FILENAME.test(name) || name.endsWith("-wal") || name.endsWith("-shm")) await rm(join(this.config.sqliteHome, name), { force: true });
        }
        for (const name of await readdir(safety).catch(() => [])) await rename(join(safety, name), join(this.config.sqliteHome, name));
        await hooks.ready().catch(() => false);
        throw new SafeError("restore_failed_rolled_back", 503);
      }
      throw error;
    } finally {
      if (stage) await rm(stage, { recursive: true, force: true });
      if (safety) await rm(safety, { recursive: true, force: true });
      this.operation = "idle";
    }
  }
}
